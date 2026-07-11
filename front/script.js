const API_URL = window.BRYX_CONFIG?.API_URL || "/api";

let servers = [];
let tables = [];
let invoices = [];
let products = [];
let invoiceLogs = [];
let serviceLogs = [];
let serviceAutoRefreshTimer = null;
let serviceRefreshInFlight = false;
let serviceConnectionState = "online";
let serviceRealtimeSocket = null;
let serviceRealtimeReconnectTimer = null;
let serviceRealtimeRefreshTimer = null;

let selectedInvoiceId =
  Number(localStorage.getItem("bryx_selected_invoice_backend")) || null;

let contextServerId = null;
let pendingConfirmAction = null;
let toastTimeout = null;

function lockActionButtons(scope = document) {
  scope.querySelectorAll("button:not([type])").forEach((button) => {
    button.type = "button";
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------- CURRENT USER -------------------- */

function currentUser() {
  if (typeof getCurrentUser === "function") {
    return getCurrentUser();
  }

  try {
    return JSON.parse(localStorage.getItem("bryx_current_user"));
  } catch {
    return null;
  }
}

function currentUserId() {
  const user = currentUser();
  return user ? user.id : null;
}

function currentUserRole() {
  const user = currentUser();
  return user ? user.role : null;
}

function ensureConnected() {
  const user = currentUser();

  if (!user) {
    window.location.href = "login.html";
    return null;
  }

  return user;
}

/* -------------------- API -------------------- */

function isNetworkError(error) {
  const message = String(error?.message || error || "");
  return (
    error instanceof TypeError ||
    message === "Failed to fetch" ||
    message.includes("NetworkError") ||
    message.includes("Load failed")
  );
}

async function apiRequest(path, options = {}) {
  const method = options.method || "GET";
  const canRetry = options.retry ?? (method === "GET" || method === "PATCH");
  const attempts = canRetry ? 2 : 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(typeof getAuthHeaders === "function" ? getAuthHeaders() : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      setServiceConnectionState("online");
      return res.status === 204 ? null : res.json();
    } catch (error) {
      if (attempt < attempts && isNetworkError(error)) {
        setServiceConnectionState("offline", "Connexion instable - nouvelle tentative...");
        await wait(650);
        continue;
      }

      if (isNetworkError(error)) {
        setServiceConnectionState("offline", "Impossible de joindre le serveur pour le moment.");
      }

      throw error;
    }
  }
}

async function apiGet(path) {
  return apiRequest(path);
}

async function apiPost(path, body) {
  return apiRequest(path, { method: "POST", body, retry: false });
}

async function apiPatch(path, body) {
  return apiRequest(path, { method: "PATCH", body, retry: true });
}

async function apiDelete(path, body = {}) {
  return apiRequest(path, { method: "DELETE", body, retry: false });
}

/* -------------------- LOAD DATA -------------------- */

async function loadServiceData() {
  servers = await apiGet("/users");
  tables = await apiGet("/tables");
  invoices = await apiGet("/invoices");
  products = await apiGet("/products");
}

async function loadServiceLogs() {
  serviceLogs = await apiGet("/activity-logs");
}

function isServicePageActive() {
  return Boolean(document.getElementById("serviceGrid"));
}

function isEditingServiceInput() {
  const active = document.activeElement;
  if (!active) return false;

  return ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
}

function startServiceAutoRefresh() {
  if (serviceAutoRefreshTimer || !isServicePageActive()) return;

  serviceAutoRefreshTimer = setInterval(refreshServiceDataSilently, 3000);
  startServiceRealtime();
}

function getRealtimeUrl() {
  const token = typeof getAuthToken === "function" ? getAuthToken() : "";
  const encodedToken = encodeURIComponent(token || "");

  if (/^https?:\/\//.test(API_URL)) {
    const url = new URL(API_URL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = `token=${encodedToken}`;
    return url.toString();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws?token=${encodedToken}`;
}

function startServiceRealtime() {
  if (!isServicePageActive() || serviceRealtimeSocket) return;

  const token = typeof getAuthToken === "function" ? getAuthToken() : "";
  if (!token || !("WebSocket" in window)) return;

  try {
    serviceRealtimeSocket = new WebSocket(getRealtimeUrl());

    serviceRealtimeSocket.addEventListener("open", () => {
      setServiceConnectionState("online");
    });

    serviceRealtimeSocket.addEventListener("message", (event) => {
      handleRealtimeMessage(event.data);
    });

    serviceRealtimeSocket.addEventListener("close", () => {
      serviceRealtimeSocket = null;
      scheduleRealtimeReconnect();
    });

    serviceRealtimeSocket.addEventListener("error", () => {
      setServiceConnectionState("offline", "Temps reel indisponible - fallback actif");
    });
  } catch (error) {
    console.error(error);
    serviceRealtimeSocket = null;
    scheduleRealtimeReconnect();
  }
}

function scheduleRealtimeReconnect() {
  if (serviceRealtimeReconnectTimer || !isServicePageActive()) return;

  serviceRealtimeReconnectTimer = setTimeout(() => {
    serviceRealtimeReconnectTimer = null;
    startServiceRealtime();
  }, 4000);
}

function handleRealtimeMessage(rawMessage) {
  let message = null;

  try {
    message = JSON.parse(rawMessage);
  } catch {
    return;
  }

  if (!message?.type || message.type === "realtime.connected") return;

  clearTimeout(serviceRealtimeRefreshTimer);
  serviceRealtimeRefreshTimer = setTimeout(() => {
    refreshServiceDataSilently();
  }, 180);
}

async function refreshServiceDataSilently() {
  if (!isServicePageActive() || serviceRefreshInFlight) return;

  const user = currentUser();
  if (!user) return;

  serviceRefreshInFlight = true;

  try {
    await loadServiceData();
    tables = tables.filter((table) => table.status !== "CANCELLED" && table.status !== "CLOSED");
    invoices = invoices.filter((invoice) => invoice.status !== "CANCELLED");
    clearSelectedInvoiceIfMissing();
    setServiceConnectionState("online");

    if (isEditingServiceInput()) return;

    if (user.role === "SERVER") {
      renderServerPhonePage(user, getVisibleServersForCurrentUser());
      return;
    }

    await renderServicePage({ skipLoad: true });
  } catch (error) {
    console.error(error);
    setServiceConnectionState("offline", "Connexion perdue - tentative de reconnexion...");
  } finally {
    serviceRefreshInFlight = false;
  }
}

/* -------------------- HELPERS -------------------- */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeJsString(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'");
}

function formatMoney(value) {
  return `${Number(value || 0).toFixed(2)} €`;
}

function formatTime(iso) {
  if (!iso) return "--:--";

  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(iso) {
  if (!iso) return "--";

  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getServerIdFromTable(table) {
  return table.responsibleUserId;
}

function getServerIdFromInvoice(invoice) {
  return invoice.responsibleUserId;
}

function getInvoiceTotal(invoice) {
  return (invoice.items || []).reduce((sum, item) => {
    return sum + Number(item.quantity || 0) * Number(item.unitPrice || 0);
  }, 0);
}

function getInvoiceCashPaid(invoice) {
  return Math.max(0, Number(invoice.cashPaid) || 0);
}

function getInvoiceCardPaid(invoice) {
  return Math.max(0, Number(invoice.cardPaid) || 0);
}

function getInvoicePaidTotal(invoice) {
  return getInvoiceCashPaid(invoice) + getInvoiceCardPaid(invoice);
}

function getInvoiceRemaining(invoice) {
  return Math.max(0, getInvoiceTotal(invoice) - getInvoicePaidTotal(invoice));
}

function getInvoicePaymentStatus(invoice) {
  const total = getInvoiceTotal(invoice);
  const paid = getInvoicePaidTotal(invoice);

  if (invoice.paymentValidated === true || invoice.status === "PAID") {
    return "paid";
  }

  if (total > 0 && paid >= total) {
    return "ready";
  }

  if (paid > 0) {
    return "partial";
  }

  return "unpaid";
}

function getPaymentStatusLabel(invoice) {
  const status = getInvoicePaymentStatus(invoice);

  if (status === "paid") return "Réglée";
  if (status === "ready") return "À valider";
  if (status === "partial") return "Partiel";

  return "En cours";
}

function getPaymentClass(invoice) {
  return getInvoicePaymentStatus(invoice);
}

function isInvoiceLocked(invoice) {
  return getInvoicePaymentStatus(invoice) === "paid";
}

function getInvoiceName(invoice) {
  return invoice.name || `Facture #${invoice.id}`;
}

function getTableNameById(tableId) {
  if (!tableId) return "Facture volante";

  const table = tables.find((t) => t.id === tableId);
  return table ? table.name : "Table supprimée";
}

function getInvoiceTableLabel(invoice) {
  if (!invoice?.tableId) return "Facture volante";
  return invoice.table?.name || getTableNameById(invoice.tableId);
}

function isInvoiceOnOpenTable(invoice) {
  if (!invoice?.tableId) return false;
  return tables.some((table) => table.id === invoice.tableId);
}

function shouldShowInvoiceInClosedSection(invoice, serverId) {
  return (
    getServerIdFromInvoice(invoice) === serverId &&
    getInvoicePaymentStatus(invoice) === "paid" &&
    (invoice.tableId === null || !isInvoiceOnOpenTable(invoice))
  );
}

function getItemsPreview(invoice) {
  const items = invoice.items || [];

  if (!items.length) return "Aucun article";

  return items
    .slice(0, 3)
    .map((item) => `${item.name} x${item.quantity}`)
    .join(", ");
}

function getServerTotal(serverId) {
  return invoices
    .filter((invoice) => getServerIdFromInvoice(invoice) === serverId)
    .reduce((sum, invoice) => sum + getInvoiceTotal(invoice), 0);
}

function getTableTotal(tableId) {
  return invoices
    .filter((invoice) => invoice.tableId === tableId)
    .reduce((sum, invoice) => sum + getInvoiceTotal(invoice), 0);
}

function getServerPaymentStats(serverId) {
  const serverInvoices = invoices.filter((invoice) => {
    return getServerIdFromInvoice(invoice) === serverId;
  });

  return serverInvoices.reduce(
    (stats, invoice) => {
      stats.total += getInvoiceTotal(invoice);
      stats.cash += getInvoiceCashPaid(invoice);
      stats.card += getInvoiceCardPaid(invoice);
      stats.paid += getInvoicePaidTotal(invoice);
      stats.remaining += getInvoiceRemaining(invoice);

      if (getInvoicePaymentStatus(invoice) === "paid") {
        stats.paidCount += 1;
      } else {
        stats.openCount += 1;
      }

      return stats;
    },
    {
      total: 0,
      cash: 0,
      card: 0,
      paid: 0,
      remaining: 0,
      paidCount: 0,
      openCount: 0,
    }
  );
}

function getServerOptionsHtml(currentServerId) {
  return servers
    .filter((server) => {
      const active = server.active !== false && server.blocked !== true;
      const roleOk = server.role === "SERVER" || server.role === "MANAGER";
      return active && roleOk;
    })
    .map((server) => {
      const isCurrent = Number(server.id) === Number(currentServerId);

      return `
        <option value="${server.id}" ${isCurrent ? "disabled" : ""}>
          ${escapeHtml(server.name)}${isCurrent ? " — actuel" : ""}
        </option>
      `;
    })
    .join("");
}

function getTableOptionsHtml(currentTableId, currentServerId) {
  const availableTables = tables.filter((table) => {
    return getServerIdFromTable(table) === currentServerId;
  });

  return availableTables
    .map((table) => {
      const isCurrent = Number(table.id) === Number(currentTableId);

      return `
        <option value="${table.id}" ${isCurrent ? "disabled" : ""}>
          ${escapeHtml(table.name)}${isCurrent ? " — actuelle" : ""}
        </option>
      `;
    })
    .join("");
}

function getActionLabel(action) {
  const labels = {
    CREATE_TABLE: "Table créée",
    UPDATE_TABLE: "Table modifiée",
    MOVE_TABLE: "Table transférée",
    CREATE_INVOICE: "Facture créée",
    UPDATE_INVOICE: "Facture modifiée",
    MOVE_INVOICE: "Facture déplacée",
    REQUEST_PAYMENT: "Règlement demandé",
    UPDATE_PAYMENT: "Règlement modifié",
    VALIDATE_PAYMENT: "Facture clôturée",
    ADD_ITEM: "Article ajouté",
    UPDATE_ITEM: "Article modifié",
    DELETE_ITEM: "Article supprimé",
    CANCEL_INVOICE: "Facture annulée",
    APPLY_DISCOUNT: "Remise appliquée",
    DEFER_PAYMENT: "Paiement différé",
    CREATE_PRODUCT: "Produit créé",
    UPDATE_PRODUCT: "Produit modifié",
    DISABLE_PRODUCT: "Produit désactivé",
  };

  return labels[action] || action || "Action";
}

/* -------------------- PRODUCTS -------------------- */

function canOverrideInvoiceItemPrice() {
  const role = currentUserRole();

  return role === "ADMIN" || role === "MANAGER" || role === "CAISSE";
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function phoneticProductKey(value) {
  return normalizeText(value)
    .replace(/œ/g, "oe")
    .replace(/ph/g, "f")
    .replace(/ch/g, "sh")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/[ckq]/g, "k")
    .replace(/g(?=[eiy])/g, "j")
    .replace(/ou/g, "u")
    .replace(/eau/g, "o")
    .replace(/au/g, "o")
    .replace(/ai|ei|ay|ey/g, "e")
    .replace(/an|am|en|em/g, "an")
    .replace(/in|im|ain|aim|ein|eim|yn|ym/g, "in")
    .replace(/on|om/g, "on")
    .replace(/s(?=[aeiouy])/g, "z")
    .replace(/[^a-z0-9]/g, "")
    .replace(/(.)\1+/g, "$1");
}

function findProductByName(name) {
  const clean = normalizeText(name);
  const phonetic = phoneticProductKey(name);

  const exact = products.find((product) => {
    return normalizeText(product.name) === clean;
  });

  if (exact) return exact;

  const phoneticMatch = products.find((product) => {
    return phoneticProductKey(product.name) === phonetic;
  });

  if (phoneticMatch) return phoneticMatch;

  return products.find((product) => {
    const productClean = normalizeText(product.name);
    const productPhonetic = phoneticProductKey(product.name);
    return (
      clean.length >= 3 &&
      (productClean.includes(clean) ||
        clean.includes(productClean) ||
        productPhonetic.includes(phonetic) ||
        phonetic.includes(productPhonetic))
    );
  });
}

function renderProductsDatalist(invoiceId) {
  return `
    <datalist id="products-list-${invoiceId}">
      ${products
      .map((product) => {
        return `
            <option
              value="${escapeHtml(product.name)}"
              label="${formatMoney(product.price)}"
            ></option>
          `;
      })
      .join("")}
    </datalist>
  `;
}

function fillProductPrice(invoiceId) {
  const nameInput = document.getElementById(`item-name-${invoiceId}`);
  const priceInput = document.getElementById(`item-price-${invoiceId}`);

  if (!nameInput || !priceInput) return;

  const product = findProductByName(nameInput.value);

  if (product) {
    priceInput.value = product.price;
    return;
  }

  if (!canOverrideInvoiceItemPrice()) {
    priceInput.value = "";
  }
}

/* -------------------- SERVER VIEW -------------------- */

function getVisibleServersForCurrentUser() {
  const user = currentUser();

  const serviceServers = servers.filter((server) => {
    const active = server.active !== false && server.blocked !== true;
    const roleOk = server.role === "SERVER" || server.role === "MANAGER";

    return active && roleOk;
  });

  if (!user) return serviceServers;

  if (user.role !== "SERVER") {
    return serviceServers;
  }

  const own = serviceServers.filter((server) => server.id === user.id);
  const others = serviceServers.filter((server) => server.id !== user.id);

  return [...own, ...others];
}

/*
  IMPORTANT :
  Le serveur peut intervenir sur les tables/factures des autres.
  Ce sont seulement les permissions sensibles qui bloquent certaines actions.
*/

function canCurrentUserActOnServer(serverId) {
  const user = currentUser();
  if (!user) return false;

  return ["ADMIN", "MANAGER", "CAISSE", "SERVER"].includes(user.role);
}

function canActOnInvoice(invoice) {
  const user = currentUser();
  if (!user || !invoice) return false;

  return ["ADMIN", "MANAGER", "CAISSE", "SERVER"].includes(user.role);
}

function canActOnTable(table) {
  const user = currentUser();
  if (!user || !table) return false;

  return ["ADMIN", "MANAGER", "CAISSE", "SERVER"].includes(user.role);
}

/* -------------------- FILTERS -------------------- */

function getActiveFilter(serverId) {
  return localStorage.getItem(`bryx_server_filter_${serverId}`) || "all";
}

function setServerFilter(serverId, filter) {
  localStorage.setItem(`bryx_server_filter_${serverId}`, filter);
  renderServicePage();
}

function getServiceServerViewMode() {
  return localStorage.getItem("bryx_service_server_view_mode") || "all";
}

function getFocusedServiceServerId(visibleServers) {
  const saved = Number(localStorage.getItem("bryx_service_focused_server"));
  const savedServer = visibleServers.find((server) => server.id === saved);

  return savedServer?.id || visibleServers[0]?.id || null;
}

function getDisplayedServiceServers(visibleServers) {
  if (getServiceServerViewMode() !== "single") return visibleServers;

  const focusedServerId = getFocusedServiceServerId(visibleServers);
  return visibleServers.filter((server) => server.id === focusedServerId);
}

function setServiceServerViewMode(mode) {
  localStorage.setItem("bryx_service_server_view_mode", mode === "single" ? "single" : "all");
  renderServicePage();
}

function setFocusedServiceServer(serverId) {
  localStorage.setItem("bryx_service_server_view_mode", "single");
  localStorage.setItem("bryx_service_focused_server", String(serverId));
  renderServicePage();
}

function renderServiceViewBar(visibleServers) {
  const bar = document.getElementById("serviceViewBar");
  if (!bar) return;

  if (!visibleServers.length || currentUser()?.role === "SERVER") {
    bar.innerHTML = "";
    return;
  }

  const mode = getServiceServerViewMode();
  const focusedServerId = getFocusedServiceServerId(visibleServers);

  bar.innerHTML = `
    <div class="service-view-tabs">
      <button
        type="button"
        class="service-view-btn ${mode === "all" ? "active" : ""}"
        onclick="setServiceServerViewMode('all')"
      >Tous</button>
      <button
        type="button"
        class="service-view-btn ${mode === "single" ? "active" : ""}"
        onclick="setServiceServerViewMode('single')"
      >Un serveur</button>
    </div>

    <label class="service-view-select">
      <span>Serveur</span>
      <select onchange="setFocusedServiceServer(Number(this.value))" ${mode === "all" ? "disabled" : ""}>
        ${visibleServers
      .map((server) => {
        return `<option value="${server.id}" ${server.id === focusedServerId ? "selected" : ""}>${escapeHtml(server.name)}</option>`;
      })
      .join("")}
      </select>
    </label>
  `;
}

function getServerPhoneViewId(user, visibleServers) {
  const saved = Number(localStorage.getItem("bryx_server_phone_view"));
  const savedExists = visibleServers.some((server) => server.id === saved);

  if (savedExists) return saved;

  const ownExists = visibleServers.some((server) => server.id === user.id);
  return ownExists ? user.id : visibleServers[0]?.id || null;
}

function setServerPhoneView(serverId) {
  localStorage.setItem("bryx_server_phone_view", String(serverId));
  localStorage.removeItem("bryx_server_phone_open_table");
  localStorage.removeItem("bryx_server_phone_open_invoice");
  selectedInvoiceId = null;
  localStorage.removeItem("bryx_selected_invoice_backend");
  renderServicePage();
}

function getOpenServerPhoneTable() {
  return localStorage.getItem("bryx_server_phone_open_table");
}

function getOpenServerPhoneInvoiceId() {
  return Number(localStorage.getItem("bryx_server_phone_open_invoice")) || null;
}

function toggleServerPhoneTable(tableKey) {
  const current = getOpenServerPhoneTable();

  if (current === String(tableKey)) {
    localStorage.removeItem("bryx_server_phone_open_table");
    localStorage.removeItem("bryx_server_phone_open_invoice");
    selectedInvoiceId = null;
    localStorage.removeItem("bryx_selected_invoice_backend");
  } else {
    localStorage.setItem("bryx_server_phone_open_table", String(tableKey));
    localStorage.removeItem("bryx_server_phone_open_invoice");
    selectedInvoiceId = null;
    localStorage.removeItem("bryx_selected_invoice_backend");
  }

  renderServicePage();
}

function isServerPhoneModeActive() {
  return currentUserRole() === "SERVER";
}

function renderServerPhonePageFromState() {
  const user = currentUser();
  const grid = document.getElementById("serviceGrid");

  if (!user || !grid) return false;

  const visibleServers = getVisibleServersForCurrentUser();
  document.body.classList.add("server-phone-mode");
  document.body.classList.toggle("has-selected-invoice", Boolean(selectedInvoiceId));
  renderServerPhonePage(user, visibleServers);
  lockActionButtons(grid);

  return true;
}

function renderServerPhoneInvoiceFromState(invoiceId, options = {}) {
  const invoice = invoices.find((inv) => inv.id === invoiceId);
  const node = document.getElementById(`server-phone-invoice-${invoiceId}`);

  if (!invoice || !node) {
    return renderServerPhonePageFromState();
  }

  node.classList.toggle("selected", getOpenServerPhoneInvoiceId() === invoice.id);

  const total = document.getElementById(`server-phone-invoice-total-${invoiceId}`);
  if (total) total.textContent = formatMoney(getInvoiceTotal(invoice));

  const count = document.getElementById(`server-phone-invoice-count-${invoiceId}`);
  if (count) count.textContent = `${(invoice.items || []).length} article(s)`;

  const status = document.getElementById(`server-phone-invoice-status-${invoiceId}`);
  if (status) {
    status.className = `server-phone-status ${getPaymentClass(invoice)}`;
    status.textContent = getPaymentStatusLabel(invoice);
  }

  const articleTotal = document.getElementById(`server-phone-article-total-${invoiceId}`);
  if (articleTotal) articleTotal.textContent = formatMoney(getInvoiceTotal(invoice));

  const remaining = document.getElementById(`server-phone-remaining-${invoiceId}`);
  if (remaining) remaining.textContent = `Reste ${formatMoney(getInvoiceRemaining(invoice))}`;

  const paymentSummary = document.getElementById(`server-phone-payment-summary-${invoiceId}`);
  if (paymentSummary) {
    paymentSummary.innerHTML = `
      <span>CB ${formatMoney(getInvoiceCardPaid(invoice))}</span>
      <span>Espèces ${formatMoney(getInvoiceCashPaid(invoice))}</span>
    `;
  }

  if (options.syncPaymentInputs) {
    const cardInput = document.getElementById(`card-paid-${invoiceId}`);
    if (cardInput) cardInput.value = getInvoiceCardPaid(invoice);

    const cashInput = document.getElementById(`cash-paid-${invoiceId}`);
    if (cashInput) cashInput.value = getInvoiceCashPaid(invoice);
  }

  const items = document.getElementById(`server-phone-items-${invoiceId}`);
  if (items) items.innerHTML = renderServerPhoneItemsHtml(invoice);

  lockActionButtons(node);

  return true;
}

function mergeItemIntoLocalInvoice(invoiceId, item) {
  const invoice = invoices.find((inv) => inv.id === invoiceId);
  if (!invoice || !item) return;

  invoice.items = invoice.items || [];

  const index = invoice.items.findIndex((existing) => existing.id === item.id);

  if (index >= 0) {
    invoice.items[index] = {
      ...invoice.items[index],
      ...item,
    };
    return;
  }

  invoice.items.push(item);
}

function mergeInvoiceIntoLocalState(updatedInvoice) {
  if (!updatedInvoice) return;

  const index = invoices.findIndex((invoice) => invoice.id === updatedInvoice.id);

  if (index >= 0) {
    invoices[index] = {
      ...invoices[index],
      ...updatedInvoice,
    };
  }
}

function removeItemFromLocalInvoice(invoiceId, itemId) {
  const invoice = invoices.find((inv) => inv.id === invoiceId);
  if (!invoice || !invoice.items) return;

  invoice.items = invoice.items.filter((item) => item.id !== itemId);
}

function getServerPhoneCategory(invoiceId) {
  return localStorage.getItem(`bryx_server_phone_category_${invoiceId}`) || "all";
}

function setServerPhoneCategory(invoiceId, category) {
  localStorage.setItem(`bryx_server_phone_category_${invoiceId}`, category);
  renderServerPhonePageFromState();
}

function getProductCategories() {
  const categories = products
    .map((product) => product.category || "Sans catégorie")
    .filter((category, index, list) => list.indexOf(category) === index);

  return ["all", ...categories];
}

function getProductCategory(product) {
  return product.category || "Sans categorie";
}

async function quickAddProductToInvoice(invoiceId, productId) {
  const invoice = invoices.find((inv) => inv.id === invoiceId);
  const product = products.find((item) => item.id === productId);

  if (!invoice || !product) return;

  if (!canAddItem() || !canActOnInvoice(invoice) || isInvoiceLocked(invoice)) {
    showToast("Tu ne peux pas ajouter d'article sur cette facture.", "error");
    return;
  }

  try {
    const item = await apiPost(`/invoices/${invoiceId}/items`, {
      productId,
      quantity: 1,
      addedByUserId: currentUserId(),
      actorUserId: currentUserId(),
    });

    mergeItemIntoLocalInvoice(invoiceId, item);
    renderServerPhoneInvoiceFromState(invoiceId);
    showToast(`${product.name} ajouté.`);
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

function toggleServerPhoneInvoice(invoiceId, tableKey) {
  const current = getOpenServerPhoneInvoiceId();

  localStorage.setItem("bryx_server_phone_open_table", String(tableKey));

  if (current === Number(invoiceId)) {
    localStorage.removeItem("bryx_server_phone_open_invoice");
    selectedInvoiceId = null;
    localStorage.removeItem("bryx_selected_invoice_backend");
  } else {
    localStorage.setItem("bryx_server_phone_open_invoice", String(invoiceId));
    selectedInvoiceId = invoiceId;
    localStorage.setItem("bryx_selected_invoice_backend", String(invoiceId));
  }

  renderServicePage();
}

function shouldShowInvoiceForServer(invoice, serverId) {
  const filter = getActiveFilter(serverId);
  const status = getInvoicePaymentStatus(invoice);

  if (getServerIdFromInvoice(invoice) !== serverId) return false;

  if (filter === "all") return true;
  if (filter === "open") return status !== "paid";
  if (filter === "paid") return status === "paid";

  return true;
}

function selectInvoice(invoiceId) {
  selectedInvoiceId = invoiceId;
  localStorage.setItem("bryx_selected_invoice_backend", String(invoiceId));
  renderServicePage();
}

function clearSelectedInvoiceIfMissing() {
  if (!selectedInvoiceId) return;

  const exists = invoices.some((invoice) => invoice.id === selectedInvoiceId);

  if (!exists) {
    selectedInvoiceId = null;
    localStorage.removeItem("bryx_selected_invoice_backend");
  }
}

/* -------------------- TOAST -------------------- */

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;

  clearTimeout(toastTimeout);

  toast.textContent = message;
  toast.className = `toast show ${type}`;

  toastTimeout = setTimeout(() => {
    toast.className = "toast";
  }, 2400);
}

function showError(error) {
  console.error(error);

  let message = "Impossible de terminer l'action.";

  try {
    const parsed = JSON.parse(error.message);
    message = parsed.message || message;
  } catch {
    message = error.message || message;
  }

  if (
    isNetworkError(error) ||
    message === "Failed to fetch" ||
    message.includes("NetworkError") ||
    message.includes("Load failed")
  ) {
    message = "Connexion perdue - les donnees vont se resynchroniser.";
  }

  if (
    message.includes("introuvable") ||
    message.includes("not found") ||
    message.includes("404")
  ) {
    message = "Cette ligne a change ailleurs. Je resynchronise la facture.";
  }

  showToast(message, "error");
}

async function recoverServiceAfterActionError(error) {
  showError(error);

  if (!isServicePageActive()) return;

  try {
    await loadServiceData();
    tables = tables.filter((table) => table.status !== "CANCELLED" && table.status !== "CLOSED");
    invoices = invoices.filter((invoice) => invoice.status !== "CANCELLED");
    clearSelectedInvoiceIfMissing();

    if (!isEditingServiceInput()) {
      const user = currentUser();
      if (user?.role === "SERVER") {
        renderServerPhonePage(user, getVisibleServersForCurrentUser());
      } else {
        await renderServicePage({ skipLoad: true });
      }
    }
  } catch (refreshError) {
    console.error(refreshError);
  }
}

function setServiceConnectionState(state, message = "") {
  serviceConnectionState = state;

  const badge = document.getElementById("serviceConnectionBadge");
  if (!badge) return;

  badge.className = `service-connection-badge ${state === "online" ? "" : "visible"} ${state}`;
  badge.textContent = message || (state === "online" ? "" : "Reconnexion...");
}

/* -------------------- CONFIRM -------------------- */

function openConfirmModal({ title, text, confirmText = "Confirmer", onConfirm }) {
  const overlay = document.getElementById("confirmOverlay");
  const titleEl = document.getElementById("confirmTitle");
  const textEl = document.getElementById("confirmText");
  const button = document.getElementById("confirmButton");

  if (!overlay || !titleEl || !textEl || !button) return;

  pendingConfirmAction = onConfirm;

  titleEl.textContent = title;
  textEl.textContent = text;
  button.textContent = confirmText;

  overlay.classList.add("active");
}

function closeConfirmModal() {
  const overlay = document.getElementById("confirmOverlay");
  if (!overlay) return;

  overlay.classList.remove("active");
  pendingConfirmAction = null;
}

async function confirmAction() {
  if (typeof pendingConfirmAction === "function") {
    await pendingConfirmAction();
  }

  closeConfirmModal();
}

/* -------------------- GLOBAL EVENTS -------------------- */

document.addEventListener(
  "click",
  (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (!button.getAttribute("type")) {
      button.type = "button";
      event.preventDefault();
    }
  },
  true
);

document.addEventListener("submit", (event) => {
  event.preventDefault();
});

document.addEventListener("click", (event) => {
  const confirmButton = document.getElementById("confirmButton");
  const confirmOverlay = document.getElementById("confirmOverlay");
  const historyOverlay = document.getElementById("historyOverlay");
  const menu = document.getElementById("serverContextMenu");

  if (confirmButton && event.target === confirmButton) {
    confirmAction();
  }

  if (confirmOverlay && event.target === confirmOverlay) {
    closeConfirmModal();
  }

  if (historyOverlay && event.target === historyOverlay) {
    closeServiceHistory();
  }

  if (menu && !menu.contains(event.target)) {
    closeServerContextMenu();
  }

  if (!event.target.closest(".action-menu")) {
    closeAllActionMenus();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeConfirmModal();
    closeServiceHistory();
    closeServerContextMenu();
    closeAllActionMenus();
    closeAllInlineForms();
  }
});

/* -------------------- CONTEXT MENU -------------------- */

function openServerContextMenu(event, serverId) {
  event.preventDefault();

  if (!canCurrentUserActOnServer(serverId)) {
    showToast("Tu peux voir cette colonne, mais pas intervenir dessus.", "error");
    return;
  }

  const menu = document.getElementById("serverContextMenu");
  if (!menu) return;

  contextServerId = serverId;

  let left = event.clientX;
  let top = event.clientY;

  if (left + 230 > window.innerWidth) left = window.innerWidth - 240;
  if (top + 150 > window.innerHeight) top = window.innerHeight - 160;

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.classList.add("active");
}

function closeServerContextMenu() {
  const menu = document.getElementById("serverContextMenu");
  if (!menu) return;

  menu.classList.remove("active");
}

function contextAddFloatingInvoice() {
  if (!contextServerId) return;
  addFloatingInvoice(contextServerId);
  closeServerContextMenu();
}

function contextAddTable() {
  if (!contextServerId) return;
  showCreateTableForm(contextServerId);
  closeServerContextMenu();
}

/* -------------------- TABLES -------------------- */

function closeAllInlineForms() {
  document
    .querySelectorAll(".server-create-table.active, .invoice-create-inline.active, .server-keep-create.active, .table-move-inline.active, .invoice-side-action.active")
    .forEach((el) => el.classList.remove("active"));
}

function getActionMenuHtml(menuId, items) {
  const visibleItems = items.filter(Boolean);
  if (!visibleItems.length) return "";

  return `
    <div class="action-menu">
      <button
        type="button"
        class="icon-action"
        title="Actions"
        aria-label="Actions"
        onclick="toggleActionMenu('${menuId}', event)"
      >...</button>
      <div id="${menuId}" class="action-menu-panel">
        ${visibleItems
      .map((item) => {
        return `
          <button type="button" class="${item.danger ? "danger" : ""}" onclick="${item.onclick}; closeAllActionMenus();">
            ${escapeHtml(item.label)}
          </button>
        `;
      })
      .join("")}
      </div>
    </div>
  `;
}

function toggleActionMenu(menuId, event) {
  event?.stopPropagation();
  const menu = document.getElementById(menuId);
  if (!menu) return;

  const wasOpen = menu.classList.contains("active");
  closeAllActionMenus();

  if (!wasOpen) {
    menu.classList.add("active");
  }
}

function closeAllActionMenus() {
  document
    .querySelectorAll(".action-menu-panel.active")
    .forEach((menu) => menu.classList.remove("active"));
}

function toggleTableMoveForm(tableId) {
  closeAllActionMenus();
  const form = document.getElementById(`move-table-form-${tableId}`);
  if (!form) return;

  const shouldOpen = !form.classList.contains("active");
  closeAllInlineForms();

  if (shouldOpen) {
    form.classList.add("active");
    document.getElementById(`move-table-server-${tableId}`)?.focus();
  }
}

function toggleInvoiceSideAction(actionId) {
  closeAllActionMenus();
  const form = document.getElementById(actionId);
  if (!form) return;

  const shouldOpen = !form.classList.contains("active");
  closeAllInlineForms();

  if (shouldOpen) {
    form.classList.add("active");
    form.querySelector("select, input, button")?.focus();
  }
}

function showCreateTableForm(serverId) {
  if (!canOpenTable() || !canCurrentUserActOnServer(serverId)) {
    showToast("Tu ne peux pas ouvrir une table.", "error");
    return;
  }

  closeAllInlineForms();

  const form = document.getElementById(`create-table-${serverId}`);
  const input = document.getElementById(`new-table-name-${serverId}`);

  if (!form || !input) return;

  form.classList.add("active");
  input.value = "";
  input.focus();
}

function closeCreateTableForm(serverId) {
  const form = document.getElementById(`create-table-${serverId}`);
  if (!form) return;

  form.classList.remove("active");
}

async function addTable(serverId) {
  if (!canOpenTable() || !canCurrentUserActOnServer(serverId)) {
    showToast("Tu n’as pas le droit d’ouvrir une table ici.", "error");
    return;
  }

  const input = document.getElementById(`new-table-name-${serverId}`);
  if (!input) return;

  const name = input.value.trim();

  if (!name) {
    showToast("Entre le nom de la table.", "error");
    input.focus();
    return;
  }

  try {
    await apiPost("/tables", {
      name,
      responsibleUserId: serverId,
      createdByUserId: currentUserId(),
      actorUserId: currentUserId(),
    });

    await renderServicePage();
    showToast(`Table "${name}" ouverte.`);
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

async function renameTable(tableId) {
  if (!canRenameTable()) {
    showToast("Renommer une table est réservé au manager ou à l’admin.", "error");
    return;
  }

  const table = tables.find((t) => t.id === tableId);
  const input = document.getElementById(`table-name-${tableId}`);

  if (!table || !input) return;

  const name = input.value.trim();

  if (!name) {
    showToast("Le nom de table est obligatoire.", "error");
    input.value = table.name;
    return;
  }

  if (name === table.name) return;

  try {
    await apiPatch(`/tables/${tableId}`, {
      name,
      actorUserId: currentUserId(),
    });

    await renderServicePage();
    showToast("Table renommée.");
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

function askDeleteTable(tableId) {
  if (!canCloseTable()) {
    showToast("Action réservée à la caisse, au manager ou à l’admin.", "error");
    return;
  }

  const table = tables.find((t) => t.id === tableId);
  if (!table) return;

  openConfirmModal({
    title: `Fermer ${table.name} ?`,
    text:
      `La table ne sera pas supprimée physiquement.\n\n` +
      `Elle sera marquée comme fermée.`,
    confirmText: "Fermer table",
    onConfirm: () => closeTable(tableId),
  });
}

async function closeTable(tableId) {
  try {
    await apiPatch(`/tables/${tableId}`, {
      status: "CLOSED",
      actorUserId: currentUserId(),
    });

    await renderServicePage();
    showToast("Table fermée.");
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

async function moveTableToServer(tableId) {
  if (!canMoveTable()) {
    showToast("Transfert de table réservé au manager ou à l’admin.", "error");
    return;
  }

  const table = tables.find((t) => t.id === tableId);
  if (!table) return;

  const select = document.getElementById(`move-table-server-${tableId}`);
  if (!select) return;

  const responsibleUserId = Number(select.value);

  if (!responsibleUserId) {
    showToast("Choisis le nouveau serveur.", "error");
    return;
  }

  if (responsibleUserId === table.responsibleUserId) {
    showToast("Cette table est déjà chez ce serveur.", "error");
    return;
  }

  try {
    await apiPatch(`/tables/${tableId}/move`, {
      responsibleUserId,
      actorUserId: currentUserId(),
    });

    await renderServicePage();
    showToast("Table transférée.");
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

/* -------------------- INVOICES -------------------- */

async function addFloatingInvoice(serverId) {
  if (!canCreateInvoice() || !canCurrentUserActOnServer(serverId)) {
    showToast("Tu n’as pas le droit de créer une facture ici.", "error");
    return;
  }

  await createInvoice({
    responsibleUserId: serverId,
    tableId: null,
    name: "",
  });
}

function showCreateInvoiceForm(tableId) {
  const table = tables.find((t) => t.id === tableId);

  if (!table || !canCreateInvoice() || !canActOnTable(table)) {
    showToast("Tu ne peux pas créer une facture sur cette table.", "error");
    return;
  }

  closeAllInlineForms();

  const form = document.getElementById(`create-invoice-${tableId}`);
  const input = document.getElementById(`new-invoice-name-${tableId}`);

  if (!form || !input) return;

  form.classList.add("active");
  input.value = "";
  input.focus();
}

function closeCreateInvoiceForm(tableId) {
  const form = document.getElementById(`create-invoice-${tableId}`);
  if (!form) return;

  form.classList.remove("active");
}

async function addInvoiceToTable(tableId) {
  const table = tables.find((t) => t.id === tableId);

  if (!table || !canCreateInvoice() || !canActOnTable(table)) {
    showToast("Tu n’as pas le droit de créer une facture sur cette table.", "error");
    return;
  }

  const input = document.getElementById(`new-invoice-name-${tableId}`);
  const name = input ? input.value.trim() : "";

  await createInvoice({
    tableId,
    responsibleUserId: table.responsibleUserId,
    name,
  });
}

async function createInvoice({ responsibleUserId, tableId, name }) {
  try {
    const invoice = await apiPost("/invoices", {
      name: name || null,
      tableId: tableId || null,
      responsibleUserId: responsibleUserId || null,
      createdByUserId: currentUserId(),
      actorUserId: currentUserId(),
    });

    selectedInvoiceId = invoice.id;
    localStorage.setItem("bryx_selected_invoice_backend", String(invoice.id));

    await renderServicePage();

    showToast(tableId ? "Nouvelle facture ajoutée à la table." : "Facture volante créée.");
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

async function attachFloatingInvoiceToTable(invoiceId) {
  if (!canAttachFloatingInvoiceToTable()) {
    showToast("Tu n’as pas le droit de rattacher cette facture.", "error");
    return;
  }

  const invoice = invoices.find((inv) => inv.id === invoiceId);
  const select = document.getElementById(`attach-table-${invoiceId}`);

  if (!invoice || !select) return;

  if (!canActOnInvoice(invoice)) {
    showToast("Tu ne peux pas intervenir sur cette facture.", "error");
    return;
  }

  if (isInvoiceLocked(invoice)) {
    showToast("Facture réglée : déplacement bloqué.", "error");
    return;
  }

  const tableId = Number(select.value);

  if (!tableId) {
    showToast("Choisis une table.", "error");
    return;
  }

  try {
    await apiPatch(`/invoices/${invoiceId}/move-table`, {
      tableId,
      actorUserId: currentUserId(),
    });

    await renderServicePage();
    showToast("Facture ajoutée à la table.");
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

async function moveInvoiceToTable(invoiceId) {
  const invoice = invoices.find((inv) => inv.id === invoiceId);
  const select = document.getElementById(`move-invoice-table-${invoiceId}`);

  if (!invoice || !select) return;

  if (!canActOnInvoice(invoice)) {
    showToast("Tu ne peux pas intervenir sur cette facture.", "error");
    return;
  }

  if (!canMoveInvoice() && invoice.responsibleUserId !== currentUserId()) {
    showToast("Transfert réservé à la caisse, au manager ou à l’admin.", "error");
    return;
  }

  if (isInvoiceLocked(invoice)) {
    showToast("Facture réglée : déplacement bloqué.", "error");
    return;
  }

  const rawValue = select.value;
  const tableId = rawValue === "floating" ? null : Number(rawValue);

  if (rawValue !== "floating" && !tableId) {
    showToast("Choisis une destination.", "error");
    return;
  }

  if (invoice.tableId === tableId) {
    showToast("La facture est déjà à cet emplacement.", "error");
    return;
  }

  try {
    await apiPatch(`/invoices/${invoiceId}/move-table`, {
      tableId,
      actorUserId: currentUserId(),
    });

    await renderServicePage();

    showToast(tableId ? "Facture déplacée vers la table." : "Facture rendue volante.");
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

async function moveInvoiceToServer(invoiceId) {
  if (!canMoveInvoice()) {
    showToast("Transfert de facture réservé à la caisse, au manager ou à l’admin.", "error");
    return;
  }

  const invoice = invoices.find((inv) => inv.id === invoiceId);
  if (!invoice) return;

  if (isInvoiceLocked(invoice)) {
    showToast("Facture réglée : transfert bloqué.", "error");
    return;
  }

  const select = document.getElementById(`move-invoice-server-${invoiceId}`);
  if (!select) return;

  const responsibleUserId = Number(select.value);

  if (!responsibleUserId) {
    showToast("Choisis le nouveau serveur.", "error");
    return;
  }

  if (responsibleUserId === invoice.responsibleUserId) {
    showToast("Cette facture est déjà chez ce serveur.", "error");
    return;
  }

  try {
    await apiPatch(`/invoices/${invoiceId}/move-user`, {
      responsibleUserId,
      actorUserId: currentUserId(),
    });

    await renderServicePage();
    showToast("Facture transférée.");
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

function askDeleteInvoice(invoiceId) {
  if (!canCancelInvoice()) {
    showToast("Action réservée à la caisse, au manager ou à l’admin.", "error");
    return;
  }

  const invoice = invoices.find((inv) => inv.id === invoiceId);
  if (!invoice) return;

  if (isInvoiceLocked(invoice)) {
    showToast("Facture réglée : annulation bloquée.", "error");
    return;
  }

  openConfirmModal({
    title: `Annuler ${getInvoiceName(invoice)} ?`,
    text:
      `On ne supprime pas vraiment la facture.\n\n` +
      `Elle sera marquée comme annulée pour garder une trace.`,
    confirmText: "Annuler facture",
    onConfirm: () => cancelInvoice(invoiceId),
  });
}

async function cancelInvoice(invoiceId) {
  try {
    await apiPatch(`/invoices/${invoiceId}`, {
      status: "CANCELLED",
      actorUserId: currentUserId(),
    });

    selectedInvoiceId = null;
    localStorage.removeItem("bryx_selected_invoice_backend");

    await renderServicePage();
    showToast("Facture annulée.");
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

async function renameInvoice(invoiceId, value) {
  if (!canRenameInvoice()) {
    showToast("Tu n’as pas le droit de renommer une facture.", "error");
    return;
  }

  const invoice = invoices.find((inv) => inv.id === invoiceId);
  if (!invoice) return;

  if (!canActOnInvoice(invoice)) {
    showToast("Tu ne peux pas intervenir sur cette facture.", "error");
    await renderServicePage();
    return;
  }

  if (isInvoiceLocked(invoice)) {
    showToast("Facture réglée : modification bloquée.", "error");
    await renderServicePage();
    return;
  }

  try {
    await apiPatch(`/invoices/${invoiceId}`, {
      name: value.trim(),
      actorUserId: currentUserId(),
    });

    await renderServicePage();
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

/* -------------------- ITEMS -------------------- */

async function addItem(invoiceId) {
  const invoice = invoices.find((inv) => inv.id === invoiceId);

  if (!invoice || !canAddItem() || !canActOnInvoice(invoice)) {
    showToast("Tu ne peux pas ajouter d’article sur cette facture.", "error");
    return;
  }

  const nameInput = document.getElementById(`item-name-${invoiceId}`);
  const priceInput = document.getElementById(`item-price-${invoiceId}`);

  if (!nameInput || !priceInput) return;

  const typedName = nameInput.value.trim();
  const product = findProductByName(typedName);

  if (!typedName) {
    showToast("Choisis ou tape un article.", "error");
    nameInput.focus();
    return;
  }

  if (!product && !canAddFreeItem()) {
    showToast("Article introuvable. Le serveur doit choisir un article du catalogue.", "error");
    nameInput.focus();
    return;
  }

  const body = {
    quantity: 1,
    addedByUserId: currentUserId(),
    actorUserId: currentUserId(),
  };

  if (product) {
    body.productId = product.id;

    if (canOverrideInvoiceItemPrice()) {
      const customPrice = Math.max(0, parseFloat(priceInput.value) || product.price);
      body.unitPrice = customPrice;
    }
  } else {
    body.name = typedName;
    body.unitPrice = Math.max(0, parseFloat(priceInput.value) || 0);
  }

  try {
    const item = await apiPost(`/invoices/${invoiceId}/items`, body);

    nameInput.value = "";
    priceInput.value = "";
    if (isServerPhoneModeActive()) {
      mergeItemIntoLocalInvoice(invoiceId, item);
      renderServerPhoneInvoiceFromState(invoiceId, { syncPaymentInputs: true });

      const nextNameInput = document.getElementById(`item-name-${invoiceId}`);
      if (nextNameInput) nextNameInput.focus();
    } else {
      await renderServicePage();
      nameInput.focus();
    }
    showToast(product ? `${product.name} ajouté.` : "Article libre ajouté.");
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

async function updateItem(invoiceId, itemId, field, value) {
  const invoice = invoices.find((inv) => inv.id === invoiceId);

  if (!invoice || !canActOnInvoice(invoice)) {
    showToast("Tu ne peux pas modifier les articles de cette facture.", "error");
    await renderServicePage();
    return;
  }

  if (field === "name" && !canEditItemName()) return;
  if (field === "quantity" && !canEditItemQuantity()) return;
  if (field === "unitPrice" && !canEditItemPrice()) return;

  const body = {
    updatedByUserId: currentUserId(),
    actorUserId: currentUserId(),
  };

  if (field === "name") body.name = value.trim() || "Article";
  if (field === "quantity") body.quantity = Math.max(1, parseInt(value, 10) || 1);
  if (field === "unitPrice") body.unitPrice = Math.max(0, parseFloat(value) || 0);

  try {
    const item = await apiPatch(`/items/${itemId}`, body);

    if (isServerPhoneModeActive()) {
      mergeItemIntoLocalInvoice(invoiceId, item);
      renderServerPhoneInvoiceFromState(invoiceId);
    } else {
      await renderServicePage();
    }
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

async function changeItemQuantity(invoiceId, itemId, delta) {
  if (!canEditItemQuantity()) {
    showToast("Tu n’as pas le droit de modifier la quantité.", "error");
    return;
  }

  const invoice = invoices.find((inv) => inv.id === invoiceId);
  if (!invoice) return;

  const item = (invoice.items || []).find((it) => it.id === itemId);
  if (!item) return;

  const nextQuantity = Number(item.quantity) + delta;

  if (nextQuantity <= 0) {
    openConfirmModal({
      title: `Supprimer ${item.name} ?`,
      text: "La quantité va passer à zéro, l'article sera retiré de la facture.",
      confirmText: "Supprimer",
      onConfirm: () => deleteItem(invoiceId, itemId),
    });
    return;
  }

  await updateItem(invoiceId, itemId, "quantity", nextQuantity);
}

async function deleteItem(invoiceId, itemId) {
  const invoice = invoices.find((inv) => inv.id === invoiceId);

  if (!invoice || !canDeleteItem() || !canActOnInvoice(invoice)) {
    showToast("Tu ne peux pas supprimer cet article.", "error");
    return;
  }

  try {
    await apiDelete(`/items/${itemId}`, {
      actorUserId: currentUserId(),
    });

    if (isServerPhoneModeActive()) {
      removeItemFromLocalInvoice(invoiceId, itemId);
      renderServerPhoneInvoiceFromState(invoiceId);
    } else {
      await renderServicePage();
    }
    showToast("Article supprimé.");
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

/* -------------------- PAYMENT -------------------- */

async function setInvoicePayment(invoiceId) {
  const invoice = invoices.find((inv) => inv.id === invoiceId);

  if (!invoice || !canSetPayment() || !canActOnInvoice(invoice)) {
    showToast("Tu ne peux pas modifier le règlement.", "error");
    return;
  }

  const cashInput = document.getElementById(`cash-paid-${invoiceId}`);
  const cardInput = document.getElementById(`card-paid-${invoiceId}`);

  const cashPaid = Math.max(0, parseFloat(cashInput ? cashInput.value : 0) || 0);
  const cardPaid = Math.max(0, parseFloat(cardInput ? cardInput.value : 0) || 0);

  try {
    const updatedInvoice = await apiPatch(`/invoices/${invoiceId}/payment`, {
      cashPaid,
      cardPaid,
      actorUserId: currentUserId(),
    });

    if (isServerPhoneModeActive()) {
      mergeInvoiceIntoLocalState(updatedInvoice);
      renderServerPhoneInvoiceFromState(invoiceId, { syncPaymentInputs: true });
    } else {
      await renderServicePage();
    }
    showToast("Mode de règlement mis à jour.");
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

async function markInvoicePaidByCard(invoiceId) {
  const invoice = invoices.find((inv) => inv.id === invoiceId);

  if (!invoice || !canSetFullCardPayment() || !canActOnInvoice(invoice)) {
    showToast("Tu ne peux pas modifier le règlement.", "error");
    return;
  }

  try {
    const updatedInvoice = await apiPatch(`/invoices/${invoiceId}/payment`, {
      cashPaid: 0,
      cardPaid: getInvoiceTotal(invoice),
      actorUserId: currentUserId(),
    });

    if (isServerPhoneModeActive()) {
      mergeInvoiceIntoLocalState(updatedInvoice);
      renderServerPhoneInvoiceFromState(invoiceId, { syncPaymentInputs: true });
    } else {
      await renderServicePage();
    }
    showToast("Montant CB enregistré.");
  } catch (error) {
    await recoverServiceAfterActionError(error);
  }
}

async function markInvoicePaidByCash(invoiceId) {
  const invoice = invoices.find((inv) => inv.id === invoiceId);

  if (!invoice || !canSetFullCashPayment() || !canActOnInvoice(invoice)) {
    showToast("Tu ne peux pas modifier le règlement.", "error");
    return;
  }

  try {
    const updatedInvoice = await apiPatch(`/invoices/${invoiceId}/payment`, {
      cashPaid: getInvoiceTotal(invoice),
      cardPaid: 0,
      actorUserId: currentUserId(),
    });

    if (isServerPhoneModeActive()) {
      mergeInvoiceIntoLocalState(updatedInvoice);
      renderServerPhoneInvoiceFromState(invoiceId);
    } else {
      await renderServicePage();
    }
    showToast("Montant espèces enregistré.");
  } catch (error) {
    showError(error);
  }
}

async function resetInvoicePayment(invoiceId) {
  if (!canResetPayment()) {
    showToast("Reset réservé à la caisse, au manager ou à l’admin.", "error");
    return;
  }

  try {
    await apiPatch(`/invoices/${invoiceId}/payment`, {
      cashPaid: 0,
      cardPaid: 0,
      actorUserId: currentUserId(),
    });

    await renderServicePage();
    showToast("Règlement remis à zéro.");
  } catch (error) {
    showError(error);
  }
}

async function validateInvoicePaid(invoiceId) {
  if (!canValidatePayment()) {
    showToast("Seule la caisse, le manager ou l’admin peut clôturer une facture.", "error");
    return;
  }

  try {
    await apiPatch(`/invoices/${invoiceId}/validate-paid`, {
      actorUserId: currentUserId(),
    });

    await renderServicePage();
    showToast("Facture clôturée comme réglée.");
  } catch (error) {
    showError(error);
  }
}

/* -------------------- RENDER SERVICE -------------------- */

async function renderServicePage(options = {}) {
  const grid = document.getElementById("serviceGrid");
  if (!grid) return;

  const user = ensureConnected();
  if (!user) return;

  if (!options.skipLoad) {
    try {
      await loadServiceData();
      setServiceConnectionState("online");
    } catch (error) {
      setServiceConnectionState("offline", "Impossible de joindre le serveur pour le moment.");
      showError(error);
      return;
    }
  }

  tables = tables.filter((table) => table.status !== "CANCELLED" && table.status !== "CLOSED");
  invoices = invoices.filter((invoice) => invoice.status !== "CANCELLED");

  clearSelectedInvoiceIfMissing();

  const visibleServers = getVisibleServersForCurrentUser();
  const displayedServers = getDisplayedServiceServers(visibleServers);
  const serverPhoneMode = user.role === "SERVER";
  const caisseSheetMode = user.role === "CAISSE";
  document.body.classList.toggle("server-phone-mode", serverPhoneMode);
  document.body.classList.toggle("server-keep-mode", serverPhoneMode);
  document.body.classList.toggle("caisse-sheet-mode", caisseSheetMode);
  document.body.classList.toggle("has-selected-invoice", Boolean(selectedInvoiceId));

  const currentUserBar = document.getElementById("currentUserBar");
  if (currentUserBar) {
    const userMenu = getActionMenuHtml("user-actions-menu", [
      canOpenServiceHistory()
        ? { label: "Historique", onclick: "openServiceHistory()" }
        : null,
      { label: "Deconnexion", onclick: "logout()" },
    ]);

    currentUserBar.innerHTML = `
      <div class="current-user-bar">
        <span>
          Connecté :
          <strong>${escapeHtml(user.name)}</strong>
          —
          ${escapeHtml(user.role)}
          ${typeof permissionLabelForCurrentUser === "function" ? `• ${escapeHtml(permissionLabelForCurrentUser())}` : ""}
        </span>
        ${userMenu}
      </div>
    `;
  }

  grid.innerHTML = "";
  grid.className = "service-grid";
  renderServiceViewBar(visibleServers);

  if (!visibleServers.length) {
    grid.classList.add("empty-grid");
    grid.innerHTML = `
      <div class="empty-message">
        Aucun serveur actif pour le moment.<br>
        Crée les comptes depuis la page Admin.
      </div>
    `;
    renderInvoiceDetailPanel();
    return;
  }

  if (serverPhoneMode) {
    renderServerPhonePage(user, visibleServers);
    lockActionButtons(grid);
    return;
  }

  if (displayedServers.length === 1) grid.classList.add("grid-1");
  else if (displayedServers.length === 2) grid.classList.add("grid-2");
  else if (displayedServers.length <= 4) grid.classList.add("grid-4");
  else grid.classList.add("grid-more");

  displayedServers.forEach((server) => {
    const serverTables = tables.filter((table) => getServerIdFromTable(table) === server.id);

    const floatingInvoices = invoices.filter((invoice) => {
      return (
        invoice.tableId === null &&
        getServerIdFromInvoice(invoice) === server.id &&
        getInvoicePaymentStatus(invoice) !== "paid" &&
        shouldShowInvoiceForServer(invoice, server.id)
      );
    });

    const closedInvoices = invoices.filter((invoice) => {
      return shouldShowInvoiceInClosedSection(invoice, server.id);
    });

    const canActHere = canCurrentUserActOnServer(server.id);

    const box = document.createElement("div");
    box.className = `server-box ${canActHere ? "" : "readonly-server"}`;

    box.addEventListener("contextmenu", (event) => {
      openServerContextMenu(event, server.id);
    });

    const paymentStats = getServerPaymentStats(server.id);
    const activeFilter = getActiveFilter(server.id);
    const serverActionMenu = getActionMenuHtml(`server-actions-menu-${server.id}`, [
      canCreateInvoice() && canActHere
        ? { label: "Facture volante", onclick: `addFloatingInvoice(${server.id})` }
        : null,
    ]);

    box.innerHTML = `
      <div class="server-header">
        <div>
          <h2>
            ${escapeHtml(server.name)}
            ${server.id === user.id ? `<span class="permission-badge role-server">Moi</span>` : ""}
          </h2>

          <span class="server-total">${formatMoney(getServerTotal(server.id))}</span>

          <div class="payment-mini">
            Réglé: ${formatMoney(paymentStats.paid)} • Reste: ${formatMoney(paymentStats.remaining)}
          </div>
        </div>

        <div class="server-actions">
          ${canOpenTable() && canActHere
        ? `<button type="button" class="small" onclick="showCreateTableForm(${server.id})">Ouvrir table</button>`
        : ""
      }
          ${serverActionMenu}
        </div>
      </div>

      <div class="server-filters">
        <button type="button" class="server-filter-btn ${activeFilter === "all" ? "active" : ""}" onclick="setServerFilter(${server.id}, 'all')">
          Toutes
        </button>
        <button type="button" class="server-filter-btn ${activeFilter === "open" ? "active" : ""}" onclick="setServerFilter(${server.id}, 'open')">
          En cours (${paymentStats.openCount})
        </button>
        <button type="button" class="server-filter-btn ${activeFilter === "paid" ? "active" : ""}" onclick="setServerFilter(${server.id}, 'paid')">
          Réglées (${paymentStats.paidCount})
        </button>
      </div>

      <div id="create-table-${server.id}" class="server-create-table">
        <input id="new-table-name-${server.id}" placeholder="Nom de la table..." />
        <button type="button" onclick="addTable(${server.id})">Ouvrir</button>
        <button type="button" class="secondary" onclick="closeCreateTableForm(${server.id})">Annuler</button>
      </div>

      <h4 class="zone-title">Tables ouvertes</h4>
      <div id="tables-zone-${server.id}" class="tables-area"></div>

      <h4 class="zone-title">Factures sans table</h4>
      <div id="floating-zone-${server.id}" class="floating-area"></div>

      <h4 class="zone-title">Factures cloturees</h4>
      <div id="closed-zone-${server.id}" class="closed-area"></div>
    `;

    grid.appendChild(box);

    renderTablesForServer(server.id, serverTables);
    renderFloatingInvoices(server.id, floatingInvoices);
    renderClosedInvoices(server.id, closedInvoices);
  });

  renderInvoiceDetailPanel();
  lockActionButtons(document);
}

function renderServerPhonePage(user, visibleServers) {
  const grid = document.getElementById("serviceGrid");
  if (!grid) return;

  const viewedServerId = getServerPhoneViewId(user, visibleServers);
  const viewedServer = visibleServers.find((server) => server.id === viewedServerId);

  grid.innerHTML = "";
  grid.className = "service-grid server-phone-grid";

  if (!viewedServer) {
    grid.innerHTML = `<div class="empty-message">Aucun serveur disponible.</div>`;
    return;
  }

  const ownView = viewedServer.id === user.id;
  const serverTables = tables.filter((table) => getServerIdFromTable(table) === viewedServer.id);
  const floatingInvoices = invoices.filter((invoice) => {
    return invoice.tableId === null && getServerIdFromInvoice(invoice) === viewedServer.id;
  });
  const paymentStats = getServerPaymentStats(viewedServer.id);

  const shell = document.createElement("section");
  shell.className = "server-phone-shell";

  shell.innerHTML = `
    <div class="server-phone-top">
      <div class="server-phone-user">
        <span>${ownView ? "Mon service" : "Service consulté"}</span>
        <strong>${escapeHtml(viewedServer.name)}</strong>
      </div>

      <button type="button" class="server-phone-logout" onclick="logout()">Déconnexion</button>

      <label class="server-phone-switch-wrap">
        <span>Autres écrans</span>
        <select class="server-phone-switch" onchange="setServerPhoneView(Number(this.value))">
          ${visibleServers
      .map((server) => {
        return `
            <option value="${server.id}" ${server.id === viewedServer.id ? "selected" : ""}>
              ${server.id === user.id ? "Moi - " : ""}${escapeHtml(server.name)}
            </option>
          `;
      })
      .join("")}
        </select>
      </label>
    </div>

    <div class="server-phone-money">
      <div>
        <span>Total</span>
        <strong>${formatMoney(getServerTotal(viewedServer.id))}</strong>
      </div>
      <div>
        <span>Reste</span>
        <strong>${formatMoney(paymentStats.remaining)}</strong>
      </div>
    </div>

    <div class="server-phone-actions">
      ${canOpenTable() && canCurrentUserActOnServer(viewedServer.id)
      ? `<button type="button" onclick="showCreateTableForm(${viewedServer.id})">Ouvrir table</button>`
      : ""
    }
      ${canCreateInvoice() && canCurrentUserActOnServer(viewedServer.id)
      ? `<button type="button" class="secondary" onclick="addFloatingInvoice(${viewedServer.id})">Facture volante</button>`
      : ""
    }
    </div>

    <div id="create-table-${viewedServer.id}" class="server-create-table server-phone-create">
      <input id="new-table-name-${viewedServer.id}" placeholder="Nom de la table..." />
      <button type="button" onclick="addTable(${viewedServer.id})">Ouvrir</button>
      <button type="button" class="secondary" onclick="closeCreateTableForm(${viewedServer.id})">Annuler</button>
    </div>

    <div class="server-phone-list">
      ${renderServerPhoneTablesHtml(viewedServer.id, serverTables)}
      ${renderServerPhoneFloatingHtml(viewedServer.id, floatingInvoices)}
    </div>
  `;

  grid.appendChild(shell);
}

function renderServerPhoneTablesHtml(serverId, serverTables) {
  if (!serverTables.length) {
    return `
      <div class="server-phone-empty">
        Aucune table ouverte.
        ${canOpenTable() && canCurrentUserActOnServer(serverId)
        ? `<button type="button" class="small" onclick="showCreateTableForm(${serverId})">Ouvrir une table</button>`
        : ""
      }
      </div>
    `;
  }

  return serverTables
    .map((table) => {
      const tableInvoices = invoices.filter((invoice) => {
        return invoice.tableId === table.id && getServerIdFromInvoice(invoice) === serverId;
      });

      return `
        <article class="server-phone-table">
          <div class="server-phone-table-head">
            <div>
              <span>Table</span>
              <strong>${escapeHtml(table.name)}</strong>
            </div>
            <button type="button" class="small" onclick="showCreateInvoiceForm(${table.id})">+ Facture</button>
          </div>

          <div id="create-invoice-${table.id}" class="invoice-create-inline server-phone-create">
            <input id="new-invoice-name-${table.id}" placeholder="Nom facture optionnel..." />
            <button type="button" onclick="addInvoiceToTable(${table.id})">Créer</button>
            <button type="button" class="secondary" onclick="closeCreateInvoiceForm(${table.id})">Annuler</button>
          </div>

          <div class="server-phone-invoices">
            ${renderServerPhoneInvoicesHtml(tableInvoices)}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderServerPhoneFloatingHtml(serverId, floatingInvoices) {
  if (!floatingInvoices.length) return "";

  return `
    <article class="server-phone-table floating">
      <div class="server-phone-table-head">
        <div>
          <span>Sans table</span>
          <strong>Factures volantes</strong>
        </div>
        <button type="button" class="small secondary" onclick="addFloatingInvoice(${serverId})">+</button>
      </div>

      <div class="server-phone-invoices">
        ${renderServerPhoneInvoicesHtml(floatingInvoices)}
      </div>
    </article>
  `;
}

function renderServerPhoneInvoicesHtml(list) {
  if (!list.length) {
    return `<div class="server-phone-empty compact">Aucune facture.</div>`;
  }

  return list
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((invoice) => {
      const selected = selectedInvoiceId === invoice.id;
      const items = invoice.items || [];

      return `
        <button type="button" class="server-phone-invoice ${selected ? "selected" : ""}" onclick="selectInvoice(${invoice.id})">
          <div class="server-phone-invoice-head">
            <strong>${escapeHtml(getInvoiceName(invoice))}</strong>
            <span>${formatMoney(getInvoiceTotal(invoice))}</span>
          </div>
          <div class="server-phone-item-preview">
            ${items.length
          ? items
            .slice(0, 4)
            .map((item) => {
              return `
                    <span>
                      ${escapeHtml(item.name)}
                      <em>x${item.quantity} - ${formatMoney(item.unitPrice)}</em>
                    </span>
                  `;
            })
            .join("")
          : `<span>Aucun article</span>`
        }
          </div>
          <div class="server-phone-status ${getPaymentClass(invoice)}">
            ${getPaymentStatusLabel(invoice)}
          </div>
        </button>
      `;
    })
    .join("");
}

function renderTablesForServer(serverId, serverTables) {
  const container = document.getElementById(`tables-zone-${serverId}`);
  if (!container) return;

  container.innerHTML = "";

  if (!serverTables.length) {
    container.innerHTML = `<div class="empty-zone">Aucune table ouverte.</div>`;
    return;
  }

  serverTables.forEach((table) => {
    const tableInvoices = invoices.filter((invoice) => {
      return invoice.tableId === table.id && shouldShowInvoiceForServer(invoice, serverId);
    });

    const canActHere = canActOnTable(table);

    const card = document.createElement("div");
    card.className = "table-card";

    const titleHtml = canRenameTable()
      ? `
        <input
          id="table-name-${table.id}"
          class="detail-title-input"
          value="${escapeHtml(table.name)}"
          onchange="renameTable(${table.id})"
        />
      `
      : `<h3>${escapeHtml(table.name)}</h3>`;

    const moveTableHtml =
      canMoveTable()
        ? `
          <div id="move-table-form-${table.id}" class="attach-floating table-move-inline">
            <select id="move-table-server-${table.id}">
              <option value="">Transférer table vers...</option>
              ${getServerOptionsHtml(table.responsibleUserId)}
            </select>

            <button type="button" class="small secondary" onclick="moveTableToServer(${table.id})">
              Transférer
            </button>
          </div>
        `
        : "";
    const tableActionMenu = getActionMenuHtml(`table-actions-menu-${table.id}`, [
      canMoveTable()
        ? { label: "Transferer table", onclick: `toggleTableMoveForm(${table.id})` }
        : null,
      canCloseTable()
        ? { label: "Fermer table", onclick: `askDeleteTable(${table.id})`, danger: true }
        : null,
    ]);

    card.innerHTML = `
      <div class="table-card-header">
        <div>
          ${titleHtml}
          <div class="table-meta">
            ${tableInvoices.length} facture(s) • Total ${formatMoney(getTableTotal(table.id))}
          </div>
        </div>

        <div class="table-actions">
          ${canCreateInvoice() && canActHere
        ? `<button type="button" class="small" onclick="showCreateInvoiceForm(${table.id})">+ Facture</button>`
        : ""
      }
          ${tableActionMenu}
        </div>
      </div>

      ${moveTableHtml}

      <div id="create-invoice-${table.id}" class="invoice-create-inline">
        <input id="new-invoice-name-${table.id}" placeholder="Nom facture optionnel..." />
        <button type="button" onclick="addInvoiceToTable(${table.id})">Créer</button>
        <button type="button" class="secondary" onclick="closeCreateInvoiceForm(${table.id})">Annuler</button>
      </div>

      <div id="invoice-stack-${table.id}" class="invoices-stack"></div>
    `;

    container.appendChild(card);
    renderInvoicesStack(`invoice-stack-${table.id}`, tableInvoices);
  });
}

function renderFloatingInvoices(serverId, list) {
  renderInvoicesStack(`floating-zone-${serverId}`, list);
}

function renderClosedInvoices(serverId, list) {
  renderInvoicesStack(`closed-zone-${serverId}`, list);
}

function renderInvoicesStack(containerId, list) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";

  if (!list.length) {
    container.innerHTML = `<div class="empty-zone">Aucune facture.</div>`;
    return;
  }

  list
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .forEach((invoice) => {
      const card = document.createElement("div");
      const selected = selectedInvoiceId === invoice.id;
      const locked = isInvoiceLocked(invoice);

      card.className = `
        invoice-card
        ${invoice.tableId === null ? "floating" : ""}
        ${getPaymentClass(invoice)}
        ${selected ? "selected" : ""}
        ${locked ? "locked" : ""}
      `;

      card.innerHTML = `
        <button type="button" class="split-invoice-button" onclick="selectInvoice(${invoice.id})">
          <div class="split-invoice-main">
            <strong>${escapeHtml(getInvoiceName(invoice))}</strong>
            <span>
              ${escapeHtml(getInvoiceTableLabel(invoice))}
              • ${(invoice.items || []).length} article(s)
              • ${formatTime(invoice.createdAt)}
            </span>
            <em>${escapeHtml(getItemsPreview(invoice))}</em>
          </div>

          <div class="split-invoice-side">
            <strong>${formatMoney(getInvoiceTotal(invoice))}</strong>
            <span class="payment-status ${getPaymentClass(invoice)}">${getPaymentStatusLabel(invoice)}</span>
            ${locked ? `<span class="lock-pill">Verrouillée</span>` : ""}
          </div>
        </button>
      `;

      container.appendChild(card);
    });
}

function renderInvoiceDetailPanel() {
  const panel = document.getElementById("invoiceDetailPanel");
  if (!panel) return;

  const invoice = invoices.find((inv) => inv.id === selectedInvoiceId);

  if (!invoice) {
    panel.innerHTML = `
      <div class="detail-empty">
        <strong>Sélectionne une facture</strong>
        <span>Le détail complet s’affichera ici.</span>
      </div>
    `;
    return;
  }

  const server = servers.find((s) => s.id === getServerIdFromInvoice(invoice));
  const locked = isInvoiceLocked(invoice);
  const canAct = canActOnInvoice(invoice);

  const possibleTables = tables.filter((table) => {
    return getServerIdFromTable(table) === getServerIdFromInvoice(invoice);
  });

  const attachHtml =
    invoice.tableId === null && possibleTables.length && !locked && canAttachFloatingInvoiceToTable() && canAct
      ? `
        <div id="invoice-attach-action-${invoice.id}" class="attach-floating invoice-side-action">
          <select id="attach-table-${invoice.id}">
            <option value="">Ajouter à une table...</option>
            ${possibleTables
        .map((table) => `<option value="${table.id}">${escapeHtml(table.name)}</option>`)
        .join("")}
          </select>
          <button type="button" class="small" onclick="attachFloatingInvoiceToTable(${invoice.id})">Ajouter</button>
        </div>
      `
      : "";

  const moveInvoiceTableHtml =
    !locked && canAct
      ? `
        <div id="invoice-move-table-action-${invoice.id}" class="attach-floating invoice-side-action">
          <select id="move-invoice-table-${invoice.id}">
            <option value="">Déplacer facture vers...</option>
            <option value="floating" ${invoice.tableId === null ? "disabled" : ""}>Facture volante</option>
            ${getTableOptionsHtml(invoice.tableId, invoice.responsibleUserId)}
          </select>

          <button type="button" class="small secondary" onclick="moveInvoiceToTable(${invoice.id})">
            Déplacer
          </button>
        </div>
      `
      : "";

  const moveInvoiceServerHtml =
    !locked && canMoveInvoice()
      ? `
        <div id="invoice-move-server-action-${invoice.id}" class="attach-floating invoice-side-action">
          <select id="move-invoice-server-${invoice.id}">
            <option value="">Transférer facture vers serveur...</option>
            ${getServerOptionsHtml(invoice.responsibleUserId)}
          </select>

          <button type="button" class="small secondary" onclick="moveInvoiceToServer(${invoice.id})">
            Transférer
          </button>
        </div>
      `
      : "";
  const invoiceActionMenu = getActionMenuHtml(`invoice-actions-menu-${invoice.id}`, [
    attachHtml
      ? { label: "Ajouter a une table", onclick: `toggleInvoiceSideAction('invoice-attach-action-${invoice.id}')` }
      : null,
    moveInvoiceTableHtml
      ? { label: "Deplacer facture", onclick: `toggleInvoiceSideAction('invoice-move-table-action-${invoice.id}')` }
      : null,
    moveInvoiceServerHtml
      ? { label: "Transferer serveur", onclick: `toggleInvoiceSideAction('invoice-move-server-action-${invoice.id}')` }
      : null,
    !locked && canCancelInvoice()
      ? { label: "Annuler facture", onclick: `askDeleteInvoice(${invoice.id})`, danger: true }
      : null,
  ]);
  const paymentActionMenu = getActionMenuHtml(`payment-actions-menu-${invoice.id}`, [
    canSetFullCardPayment() && canAct
      ? { label: "Tout CB", onclick: `markInvoicePaidByCard(${invoice.id})` }
      : null,
    canSetFullCashPayment() && canAct
      ? { label: "Tout especes", onclick: `markInvoicePaidByCash(${invoice.id})` }
      : null,
    canResetPayment()
      ? { label: "Reset reglement", onclick: `resetInvoicePayment(${invoice.id})` }
      : null,
  ]);

  panel.innerHTML = `
    <div class="detail-header">
      <div>
        <input
          class="detail-title-input"
          value="${escapeHtml(getInvoiceName(invoice))}"
          onchange="renameInvoice(${invoice.id}, this.value)"
          ${locked || !canRenameInvoice() || !canAct ? "disabled" : ""}
        />

        <div class="detail-subtitle">
          ${escapeHtml(server ? server.name : "Serveur supprimé")}
          • ${escapeHtml(getTableNameById(invoice.tableId))}
          • ${formatTime(invoice.createdAt)}
        </div>
      </div>

      <div class="detail-total-box">
        <strong>${formatMoney(getInvoiceTotal(invoice))}</strong>
        <span class="payment-status ${getPaymentClass(invoice)}">${getPaymentStatusLabel(invoice)}</span>
        ${invoiceActionMenu}
      </div>
    </div>

    ${locked
      ? `<div class="locked-banner">Facture clôturée comme réglée : elle est verrouillée.</div>`
      : ""
    }

    ${attachHtml}
    ${moveInvoiceTableHtml}
    ${moveInvoiceServerHtml}

    <div class="detail-section">
      <h3>Règlement</h3>

      <div class="payment-summary-line">
        <span class="payment-pill">CB: ${formatMoney(getInvoiceCardPaid(invoice))}</span>
        <span class="payment-pill">Espèces: ${formatMoney(getInvoiceCashPaid(invoice))}</span>
        <span class="payment-pill">Reste: ${formatMoney(getInvoiceRemaining(invoice))}</span>
      </div>

      <div class="payment-grid">
        <input
          id="card-paid-${invoice.id}"
          type="number"
          step="0.01"
          min="0"
          placeholder="Montant CB"
          value="${getInvoiceCardPaid(invoice)}"
          ${locked || !canSetPayment() || !canAct ? "disabled" : ""}
        />

        <input
          id="cash-paid-${invoice.id}"
          type="number"
          step="0.01"
          min="0"
          placeholder="Montant espèces"
          value="${getInvoiceCashPaid(invoice)}"
          ${locked || !canSetPayment() || !canAct ? "disabled" : ""}
        />
      </div>

      <div class="payment-actions">
        ${canSetPayment() && canAct
      ? `<button type="button" class="small" onclick="setInvoicePayment(${invoice.id})" ${locked ? "disabled" : ""}>
                Enregistrer règlement
              </button>`
      : ""
    }

        ${canValidatePayment()
      ? `<button type="button" class="small" onclick="validateInvoicePaid(${invoice.id})" ${locked ? "disabled" : ""}>
                Clôturer réglée
              </button>`
      : `<button type="button" class="small" disabled title="Réservé caisse / manager / admin">
                Clôture réservée
              </button>`
    }
        ${!locked ? paymentActionMenu : ""}
      </div>
    </div>

    <div class="detail-section">
      <h3>Articles</h3>

      ${!locked && canAddItem() && canAct
      ? `
            <div class="article-form">
              <input
                id="item-name-${invoice.id}"
                list="products-list-${invoice.id}"
                placeholder="Tape un article..."
                oninput="fillProductPrice(${invoice.id})"
              />

              ${renderProductsDatalist(invoice.id)}

              <input
                id="item-price-${invoice.id}"
                type="number"
                step="0.01"
                min="0"
                placeholder="${canOverrideInvoiceItemPrice() ? "Prix" : "Prix auto"}"
                ${canOverrideInvoiceItemPrice() ? "" : "disabled"}
              />

              <button type="button" onclick="addItem(${invoice.id})">Ajouter</button>
            </div>
          `
      : ""
    }

      <div class="items-list">
        ${renderItemsHtml(invoice)}
      </div>
    </div>

  `;
}

function renderItemsHtml(invoice) {
  const items = invoice.items || [];

  if (!items.length) {
    return `<div class="empty-zone">Aucun article.</div>`;
  }

  const locked = isInvoiceLocked(invoice);
  const canAct = canActOnInvoice(invoice);

  return items
    .map((item) => {
      const total = Number(item.quantity) * Number(item.unitPrice);
      const itemActionMenu = getActionMenuHtml(`item-actions-menu-${item.id}`, [
        !locked && canDeleteItem() && canAct
          ? { label: "Supprimer article", onclick: `deleteItem(${invoice.id}, ${item.id})`, danger: true }
          : null,
      ]);

      return `
        <div class="item-row">
          <input
            value="${escapeHtml(item.name)}"
            onchange="updateItem(${invoice.id}, ${item.id}, 'name', this.value)"
            ${locked || !canEditItemName() || !canAct ? "disabled" : ""}
          />

          <div class="qty-control">
            <button type="button" class="small secondary" onclick="changeItemQuantity(${invoice.id}, ${item.id}, -1)" ${locked || !canEditItemQuantity() || !canAct ? "disabled" : ""}>-</button>
            <div class="qty-value">${item.quantity}</div>
            <button type="button" class="small secondary" onclick="changeItemQuantity(${invoice.id}, ${item.id}, 1)" ${locked || !canEditItemQuantity() || !canAct ? "disabled" : ""}>+</button>
          </div>

          <input
            type="number"
            step="0.01"
            min="0"
            value="${item.unitPrice}"
            onchange="updateItem(${invoice.id}, ${item.id}, 'unitPrice', this.value)"
            ${locked || !canEditItemPrice() || !canAct ? "disabled" : ""}
          />

          <div class="item-total">
            ${formatMoney(total)}
            ${itemActionMenu}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderInvoiceLogsHtml() {
  if (!invoiceLogs.length) {
    return `<div class="empty-zone">Aucun historique visible pour cette facture.</div>`;
  }

  return `
    <div class="items-list">
      ${invoiceLogs
      .map((log) => {
        return `
            <div class="item-row" style="grid-template-columns: 1fr;">
              <div>
                <strong>${escapeHtml(getActionLabel(log.action))}</strong>
                <div class="table-meta">
                  ${escapeHtml(log.actorUser?.name || "Utilisateur inconnu")}
                  • ${formatDateTime(log.createdAt)}
                </div>
                ${log.details
            ? `<div class="table-meta">${escapeHtml(log.details)}</div>`
            : ""
          }
              </div>
            </div>
          `;
      })
      .join("")}
    </div>
  `;
}

function canOpenServiceHistory() {
  if (typeof canViewActivityLogs === "function") {
    return canViewActivityLogs();
  }

  return ["ADMIN", "MANAGER", "CAISSE"].includes(currentUserRole());
}

async function openServiceHistory() {
  if (!canOpenServiceHistory()) {
    showToast("Historique reserve a la caisse et aux responsables.", "error");
    return;
  }

  const overlay = document.getElementById("historyOverlay");
  const list = document.getElementById("historyList");
  if (!overlay || !list) return;

  overlay.classList.add("active");
  list.innerHTML = `<div class="empty-zone">Chargement de l'historique...</div>`;

  try {
    await loadServiceLogs();
    renderServiceHistory();
  } catch (error) {
    serviceLogs = [];
    list.innerHTML = `<div class="empty-zone">Historique indisponible.</div>`;
    showError(error);
  }
}

function closeServiceHistory() {
  const overlay = document.getElementById("historyOverlay");
  if (overlay) {
    overlay.classList.remove("active");
  }
}

function renderServiceHistory() {
  const list = document.getElementById("historyList");
  if (!list) return;

  if (!serviceLogs.length) {
    list.innerHTML = `<div class="empty-zone">Aucune action serveur pour le moment.</div>`;
    return;
  }

  list.innerHTML = serviceLogs
    .map((log) => {
      const meta = [
        log.actorUser?.name || "Utilisateur inconnu",
        log.table?.name ? `Table ${log.table.name}` : "",
        log.invoice?.name || (log.invoiceId ? `Facture #${log.invoiceId}` : ""),
        formatDateTime(log.createdAt),
      ].filter(Boolean);

      return `
        <div class="history-row">
          <div>
            <strong>${escapeHtml(getActionLabel(log.action))}</strong>
            <div class="table-meta">${escapeHtml(meta.join(" - "))}</div>
            ${log.details ? `<div class="table-meta">${escapeHtml(log.details)}</div>` : ""}
          </div>
        </div>
      `;
    })
    .join("");
}

/* -------------------- RECAP PAGE -------------------- */

let recapDaysCache = null;

async function loadRecapDays() {
  recapDaysCache = await apiGet("/recap/days");
  return recapDaysCache;
}

async function fetchSelectedRecap() {
  const select = document.getElementById("recapDaySelect");
  const selected = select?.value || "active";

  if (selected === "active") {
    return apiGet("/recap/today");
  }

  return apiGet(`/recap/days/${encodeURIComponent(selected)}`);
}

function renderRecapDaySelect(days) {
  const select = document.getElementById("recapDaySelect");
  if (!select || !days) return;

  const current = select.value || "active";
  const closed = days.closed || [];

  select.innerHTML = [
    `<option value="active">${escapeHtml(days.active?.label || "Journee active")}</option>`,
    ...closed.map((day) => {
      const totalLabel = formatMoneyFromDetails(day.details);
      const label = totalLabel ? `${day.label} - ${totalLabel}` : day.label;
      return `<option value="${day.id}">${escapeHtml(label)}</option>`;
    }),
  ].join("");

  const hasCurrent = Array.from(select.options).some((option) => option.value === current);
  select.value = hasCurrent ? current : "active";
}

function formatMoneyFromDetails(details) {
  const match = String(details || "").match(/total\s+([0-9]+(?:[.,][0-9]+)?)/i);
  if (!match) return "";
  return formatMoney(Number(match[1].replace(",", ".")));
}

function renderRecapPeriodInfo(period) {
  const info = document.getElementById("recapPeriodInfo");
  if (!info) return;

  if (!period) {
    info.textContent = "";
    return;
  }

  const start = period.start ? formatDateTime(period.start) : "debut historique";
  const end = period.end || period.closedAt ? formatDateTime(period.end || period.closedAt) : "maintenant";
  const closedBy = period.closedBy?.name ? ` - cloturee par ${period.closedBy.name}` : "";

  info.textContent = `${period.label || "Journee"} : ${start} -> ${end}${closedBy}`;
}

async function renderRecapPage() {
  const dayTotal = document.getElementById("dayTotal");
  if (!dayTotal) return;

  const user = ensureConnected();
  if (!user) return;

  try {
    const days = await loadRecapDays();
    renderRecapDaySelect(days);

    const recap = await fetchSelectedRecap();

    const currentUserBar = document.getElementById("currentUserBar");
    if (currentUserBar) {
      currentUserBar.innerHTML = `
        <div class="current-user-bar">
          <span>
            Connecté :
            <strong>${escapeHtml(user.name)}</strong>
            —
            ${escapeHtml(user.role)}
          </span>
          <button type="button" class="small secondary" onclick="logout()">Déconnexion</button>
        </div>
      `;
    }

    const summary = recap.summary;
    renderRecapPeriodInfo(recap.period);
    const ticketAverage =
      summary.invoiceCount > 0 ? summary.totalFacture / summary.invoiceCount : 0;

    dayTotal.textContent = formatMoney(summary.totalFacture);
    document.getElementById("tableCount").textContent = summary.tableCount;
    document.getElementById("invoiceCount").textContent = summary.invoiceCount;
    document.getElementById("averageTicket").textContent = formatMoney(ticketAverage);
    document.getElementById("medianTicket").textContent = formatMoney(summary.medianTicket || 0);
    document.getElementById("firstQuartileTicket").textContent = formatMoney(summary.firstQuartileTicket || 0);
    document.getElementById("thirdQuartileTicket").textContent = formatMoney(summary.thirdQuartileTicket || 0);

    document.getElementById("cardPaidTotal").textContent = formatMoney(summary.totalCarte);
    document.getElementById("cashPaidTotal").textContent = formatMoney(summary.totalEspeces);
    document.getElementById("paidTotal").textContent = formatMoney(summary.totalRegle);
    document.getElementById("remainingTotal").textContent = formatMoney(summary.resteARegler);

    renderServerSummary(recap.byServer || []);
    renderTableRecap(recap.tables || []);
    renderFloatingRecap(recap.invoices || []);
    renderServerDetailPdf(recap);
  } catch (error) {
    showError(error);
  }
}

function renderServerSummary(byServer) {
  const container = document.getElementById("serverSummary");
  if (!container) return;

  if (!byServer.length) {
    container.innerHTML = `<div class="empty-zone">Aucun serveur.</div>`;
    return;
  }

  container.innerHTML = byServer
    .map((server) => {
      return `
        <div class="server-summary-card">
          <h3>${escapeHtml(server.name)}</h3>
          <p>Total : <strong>${formatMoney(server.total)}</strong></p>
          <p>CB : ${formatMoney(server.card)}</p>
          <p>Espèces : ${formatMoney(server.cash)}</p>
          <p>Reste : ${formatMoney(server.remaining)}</p>
          <p>${server.invoiceCount} facture(s)</p>
        </div>
      `;
    })
    .join("");
}

function renderTableRecap(tablesList) {
  const container = document.getElementById("tableRecap");
  if (!container) return;

  if (!tablesList.length) {
    container.innerHTML = `<div class="empty-zone">Aucune table.</div>`;
    return;
  }

  container.innerHTML = tablesList
    .map((table) => {
      const tableInvoices = table.invoices || [];

      const total = tableInvoices.reduce((sum, invoice) => {
        return sum + getInvoiceTotal(invoice);
      }, 0);

      return `
        <div class="recap-table-card">
          <h3>${escapeHtml(table.name)}</h3>
          <p>Serveur : ${escapeHtml(table.responsibleUser?.name || "-")}</p>
          <p>Total : <strong>${formatMoney(total)}</strong></p>

          ${tableInvoices
          .map((invoice) => {
            return `
                <div class="recap-invoice-line">
                  <span>${escapeHtml(getInvoiceName(invoice))}</span>
                  <strong>${formatMoney(getInvoiceTotal(invoice))}</strong>
                </div>
              `;
          })
          .join("")}
        </div>
      `;
    })
    .join("");
}

function renderFloatingRecap(invoicesList) {
  const container = document.getElementById("floatingRecap");
  if (!container) return;

  const floating = invoicesList.filter((invoice) => invoice.table === null);

  if (!floating.length) {
    container.innerHTML = `<div class="empty-zone">Aucune facture volante.</div>`;
    return;
  }

  container.innerHTML = floating
    .map((invoice) => {
      return `
        <div class="recap-floating-card">
          <h3>${escapeHtml(getInvoiceName(invoice))}</h3>
          <p>Serveur : ${escapeHtml(invoice.responsibleUser?.name || "-")}</p>
          <p>Total : <strong>${formatMoney(invoice.total)}</strong></p>
          <p>CB : ${formatMoney(invoice.cardPaid)} • Espèces : ${formatMoney(invoice.cashPaid)}</p>
          <p>Reste : ${formatMoney(invoice.remaining)}</p>
        </div>
      `;
    })
    .join("");
}

function renderServerDetailPdf(recap) {
  const container = document.getElementById("serverDetailPdf");
  if (!container) return;

  const byServer = recap.byServer || [];
  const invoicesList = recap.invoices || [];

  container.innerHTML = byServer
    .map((server) => {
      const serverInvoices = invoicesList.filter((invoice) => {
        return invoice.responsibleUser?.id === server.userId;
      });

      return `
        <div class="server-detail-card">
          <h3>${escapeHtml(server.name)}</h3>
          <p>Total : <strong>${formatMoney(server.total)}</strong></p>
          <p>CB : ${formatMoney(server.card)} • Espèces : ${formatMoney(server.cash)} • Reste : ${formatMoney(server.remaining)}</p>

          ${serverInvoices
          .map((invoice) => {
            return `
                <div class="recap-invoice-line">
                  <span>
                    ${escapeHtml(getInvoiceName(invoice))}
                    <br>
                    <small>${escapeHtml(invoice.table?.name || "Facture volante")}</small>
                  </span>
                  <strong>${formatMoney(invoice.total)}</strong>
                </div>
              `;
          })
          .join("")}
        </div>
      `;
    })
    .join("");
}

/* -------------------- RECAP ACTIONS -------------------- */

async function buildRecapMessage() {
  const recap = await fetchSelectedRecap();
  const s = recap.summary;
  const periodLine =
    recap.period?.start || recap.period?.end
      ? `${recap.period.start ? formatDateTime(recap.period.start) : "debut historique"} -> ${recap.period.end ? formatDateTime(recap.period.end) : "maintenant"}`
      : "";

  const lines = [
    "RÉCAP BRYX",
    "",
    `Total journée : ${formatMoney(s.totalFacture)}`,
    `CB : ${formatMoney(s.totalCarte)}`,
    `Espèces : ${formatMoney(s.totalEspeces)}`,
    `Total réglé : ${formatMoney(s.totalRegle)}`,
    `Reste à régler : ${formatMoney(s.resteARegler)}`,
    `Ticket median : ${formatMoney(s.medianTicket || 0)}`,
    `Quartile bas : ${formatMoney(s.firstQuartileTicket || 0)}`,
    `Quartile haut : ${formatMoney(s.thirdQuartileTicket || 0)}`,
    "",
    `Tables : ${s.tableCount}`,
    `Factures : ${s.invoiceCount}`,
    "",
    "Par serveur :",
    ...(recap.byServer || []).map((server) => {
      return `- ${server.name} : ${formatMoney(server.total)} | CB ${formatMoney(server.card)} | Espèces ${formatMoney(server.cash)} | Reste ${formatMoney(server.remaining)}`;
    }),
  ];

  if (recap.period?.label || periodLine) {
    lines.splice(1, 0, recap.period?.label || "", periodLine);
  }

  return lines.join("\n");
}

async function copyRecapMessage() {
  try {
    const message = await buildRecapMessage();
    await navigator.clipboard.writeText(message);
    showToast("Récap copié.");
  } catch (error) {
    showError(error);
  }
}

async function shareRecapOnWhatsApp() {
  try {
    const message = await buildRecapMessage();
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  } catch (error) {
    showError(error);
  }
}

async function downloadRecapPdf() {
  if (!window.jspdf) {
    window.print();
    return;
  }

  try {
    const message = await buildRecapMessage();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const lines = doc.splitTextToSize(message, 180);

    doc.setFontSize(14);
    doc.text(lines, 10, 15);
    doc.save(`recap-bryx-${new Date().toISOString().slice(0, 10)}.pdf`);

    showToast("PDF téléchargé.");
  } catch (error) {
    showError(error);
  }
}

async function closeToday() {
  const confirmed = window.confirm(
    "Cloturer la journee ?\n\nToutes les factures doivent deja etre cloturees.",
  );

  if (!confirmed) return;

  try {
    const result = await apiPost("/recap/close-today", {});
    const select = document.getElementById("recapDaySelect");
    if (select) select.value = "active";
    recapDaysCache = null;
    showToast(`Journee cloturee. Total ${formatMoney(result.summary?.totalFacture || 0)}.`);
    await renderRecapPage();
  } catch (error) {
    showError(error);
  }
}

/* -------------------- SERVER PHONE ACCORDION OVERRIDES -------------------- */

function renderServerPhoneTablesHtml(serverId, serverTables) {
  if (!serverTables.length) {
    return `<div class="server-phone-empty">Aucune table ouverte.</div>`;
  }

  return serverTables
    .map((table) => {
      const tableKey = `table-${table.id}`;
      const open = getOpenServerPhoneTable() === tableKey;
      const tableInvoices = invoices.filter((invoice) => {
        return invoice.tableId === table.id && getServerIdFromInvoice(invoice) === serverId;
      });
      const tableTotal = tableInvoices.reduce((sum, invoice) => {
        return sum + getInvoiceTotal(invoice);
      }, 0);

      return `
        <article class="server-phone-table ${open ? "open" : ""}">
          <div class="server-phone-table-head" onclick="toggleServerPhoneTable('${tableKey}')">
            <div>
              <span>Table</span>
              <strong>${escapeHtml(table.name)}</strong>
              <em>${tableInvoices.length} facture(s) - ${formatMoney(tableTotal)}</em>
            </div>
            <div class="server-phone-head-actions">
              <span class="server-phone-chevron">${open ? "Fermer" : "Ouvrir"}</span>
              <button type="button" class="small" onclick="event.stopPropagation(); showCreateInvoiceForm(${table.id})">+ Facture</button>
            </div>
          </div>

          <div id="create-invoice-${table.id}" class="invoice-create-inline server-phone-create">
            <input id="new-invoice-name-${table.id}" placeholder="Nom facture optionnel..." />
            <button type="button" onclick="addInvoiceToTable(${table.id})">Créer</button>
            <button type="button" class="secondary" onclick="closeCreateInvoiceForm(${table.id})">Annuler</button>
          </div>

          ${open
          ? `
              <div class="server-phone-invoices">
                ${renderServerPhoneInvoicesHtml(tableInvoices, tableKey)}
              </div>
            `
          : ""
        }
        </article>
      `;
    })
    .join("");
}

function renderServerPhoneFloatingHtml(serverId, floatingInvoices) {
  if (!floatingInvoices.length) return "";

  const tableKey = "floating";
  const open = getOpenServerPhoneTable() === tableKey;
  const floatingTotal = floatingInvoices.reduce((sum, invoice) => {
    return sum + getInvoiceTotal(invoice);
  }, 0);

  return `
    <article class="server-phone-table floating ${open ? "open" : ""}">
      <div class="server-phone-table-head" onclick="toggleServerPhoneTable('${tableKey}')">
        <div>
          <span>Sans table</span>
          <strong>Factures volantes</strong>
          <em>${floatingInvoices.length} facture(s) - ${formatMoney(floatingTotal)}</em>
        </div>
        <div class="server-phone-head-actions">
          <span class="server-phone-chevron">${open ? "Fermer" : "Ouvrir"}</span>
          <button type="button" class="small secondary" onclick="event.stopPropagation(); addFloatingInvoice(${serverId})">+</button>
        </div>
      </div>

      ${open
      ? `
          <div class="server-phone-invoices">
            ${renderServerPhoneInvoicesHtml(floatingInvoices, tableKey)}
          </div>
        `
      : ""
    }
    </article>
  `;
}

function renderServerPhoneInvoicesHtml(list, tableKey) {
  if (!list.length) {
    const tableId = String(tableKey || "").startsWith("table-")
      ? Number(String(tableKey).replace("table-", ""))
      : null;

    return `
      <div class="server-phone-empty compact">
        Aucune facture.
        ${tableId ? `<button type="button" class="small" onclick="showCreateInvoiceForm(${tableId})">Créer une facture</button>` : ""}
      </div>
    `;
  }

  return list
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((invoice) => {
      const selected = getOpenServerPhoneInvoiceId() === invoice.id;
      const items = invoice.items || [];

      return `
        <article id="server-phone-invoice-${invoice.id}" class="server-phone-invoice ${selected ? "selected" : ""}">
          <button type="button" class="server-phone-invoice-toggle" onclick="toggleServerPhoneInvoice(${invoice.id}, '${tableKey}')">
            <div class="server-phone-invoice-head">
              <strong>${escapeHtml(getInvoiceName(invoice))}</strong>
              <span id="server-phone-invoice-total-${invoice.id}">${formatMoney(getInvoiceTotal(invoice))}</span>
            </div>

            <div class="server-phone-invoice-recap">
              <span id="server-phone-invoice-count-${invoice.id}">${items.length} article(s)</span>
              <span>${formatTime(invoice.createdAt)}</span>
            </div>

            <div class="server-phone-invoice-foot">
              <span id="server-phone-invoice-status-${invoice.id}" class="server-phone-status ${getPaymentClass(invoice)}">
                ${getPaymentStatusLabel(invoice)}
              </span>
              <span class="server-phone-chevron">${selected ? "Masquer" : "Détails"}</span>
            </div>
          </button>

          ${selected ? renderServerPhoneInvoiceControls(invoice) : ""}
        </article>
      `;
    })
    .join("");
}

function renderServerPhoneInvoiceControls(invoice) {
  const locked = isInvoiceLocked(invoice);
  const canAct = canActOnInvoice(invoice);

  return `
    <div class="server-phone-invoice-body">
      <section class="server-phone-panel">
        <div class="server-phone-panel-title">
          <strong>Articles</strong>
          <span id="server-phone-article-total-${invoice.id}">${formatMoney(getInvoiceTotal(invoice))}</span>
        </div>

        ${locked
      ? `<div class="server-phone-locked">Facture réglée : les articles sont verrouillés.</div>`
      : ""
    }

        ${!locked && canAddItem() && canAct
      ? `
          ${renderServerPhoneProductPicker(invoice.id)}

          <div class="server-phone-add-item">
            <input
              id="item-name-${invoice.id}"
              list="products-list-${invoice.id}"
              placeholder="Article..."
              oninput="fillProductPrice(${invoice.id})"
            />

            ${renderProductsDatalist(invoice.id)}

            <input
              id="item-price-${invoice.id}"
              type="number"
              step="0.01"
              min="0"
              placeholder="${canOverrideInvoiceItemPrice() ? "Prix" : "Auto"}"
              ${canOverrideInvoiceItemPrice() ? "" : "disabled"}
            />

            <button type="button" onclick="addItem(${invoice.id})">Ajouter</button>
          </div>
        `
      : ""
    }

        <div id="server-phone-items-${invoice.id}" class="server-phone-items">
          ${renderServerPhoneItemsHtml(invoice)}
        </div>
      </section>

      <section class="server-phone-panel">
        <div class="server-phone-panel-title">
          <strong>Règlement</strong>
          <span id="server-phone-remaining-${invoice.id}">Reste ${formatMoney(getInvoiceRemaining(invoice))}</span>
        </div>

        <div id="server-phone-payment-summary-${invoice.id}" class="server-phone-payment-summary">
          <span>CB ${formatMoney(getInvoiceCardPaid(invoice))}</span>
          <span>Espèces ${formatMoney(getInvoiceCashPaid(invoice))}</span>
        </div>

        <div class="server-phone-payment-inputs">
          <input
            id="card-paid-${invoice.id}"
            type="number"
            step="0.01"
            min="0"
            placeholder="CB"
            value="${getInvoiceCardPaid(invoice)}"
            ${locked || !canSetPayment() || !canAct ? "disabled" : ""}
          />

          <input
            id="cash-paid-${invoice.id}"
            type="number"
            step="0.01"
            min="0"
            placeholder="Espèces"
            value="${getInvoiceCashPaid(invoice)}"
            ${locked || !canSetPayment() || !canAct ? "disabled" : ""}
          />
        </div>

        <div class="server-phone-payment-actions">
          ${canSetPayment() && canAct
      ? `<button type="button" class="small" onclick="setInvoicePayment(${invoice.id})" ${locked ? "disabled" : ""}>Enregistrer</button>`
      : ""
    }
          ${canSetFullCardPayment() && canAct
      ? `<button type="button" class="small secondary" onclick="markInvoicePaidByCard(${invoice.id})" ${locked ? "disabled" : ""}>Tout CB</button>`
      : ""
    }
          ${canSetFullCashPayment() && canAct
      ? `<button type="button" class="small secondary" onclick="markInvoicePaidByCash(${invoice.id})" ${locked ? "disabled" : ""}>Tout espèces</button>`
      : ""
    }
        </div>
      </section>
    </div>
  `;
}

function renderServerPhoneProductPicker(invoiceId) {
  if (!products.length) return "";

  const activeCategory = getServerPhoneCategory(invoiceId);
  const categories = getProductCategories();
  const visibleProducts = products
    .filter((product) => {
      if (activeCategory === "all") return true;
      return (product.category || "Sans catégorie") === activeCategory;
    })
    .slice(0, 12);

  return `
    <div class="server-phone-products">
      <div class="server-phone-category-tabs">
        ${categories
      .map((category) => {
        const active = category === activeCategory;
        const label = category === "all" ? "Tous" : category;

        return `
            <button
              type="button"
              class="server-phone-category ${active ? "active" : ""}"
              onclick="setServerPhoneCategory(${invoiceId}, '${escapeJsString(category)}')"
            >
              ${escapeHtml(label)}
            </button>
          `;
      })
      .join("")}
      </div>

      <div class="server-phone-product-grid">
        ${visibleProducts
      .map((product) => {
        return `
            <button type="button" class="server-phone-product" onclick="quickAddProductToInvoice(${invoiceId}, ${product.id})">
              <strong>${escapeHtml(product.name)}</strong>
              <span>${formatMoney(product.price)}</span>
            </button>
          `;
      })
      .join("")}
      </div>
    </div>
  `;
}

function renderServerPhoneItemsHtml(invoice) {
  const items = invoice.items || [];

  if (!items.length) {
    return `<div class="server-phone-empty compact">Aucun article.</div>`;
  }

  const locked = isInvoiceLocked(invoice);
  const canAct = canActOnInvoice(invoice);

  return items
    .map((item) => {
      const total = Number(item.quantity) * Number(item.unitPrice);

      return `
        <div class="server-phone-item-row">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${formatMoney(item.unitPrice)} - Total ${formatMoney(total)}</span>
          </div>

          <div class="server-phone-qty">
            <button type="button" class="small secondary" onclick="changeItemQuantity(${invoice.id}, ${item.id}, -1)" ${locked || !canEditItemQuantity() || !canAct ? "disabled" : ""}>-</button>
            <span>${item.quantity}</span>
            <button type="button" class="small secondary" onclick="changeItemQuantity(${invoice.id}, ${item.id}, 1)" ${locked || !canEditItemQuantity() || !canAct ? "disabled" : ""}>+</button>
          </div>
        </div>
      `;
    })
    .join("");
}

/* -------------------- SERVER KEEP UX -------------------- */

function getServerKeepViewedServer(user, visibleServers) {
  const viewedServerId = getServerPhoneViewId(user, visibleServers);
  return visibleServers.find((server) => server.id === viewedServerId) || visibleServers[0] || null;
}

function getServerKeepInvoices(serverId) {
  return invoices
    .filter((invoice) => getServerIdFromInvoice(invoice) === serverId)
    .filter((invoice) => invoice.status !== "CANCELLED")
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

function getInvoiceKeepTitle(invoice) {
  const tableName = invoice.tableId ? getTableNameById(invoice.tableId) : "Facture volante";
  const invoiceName = getInvoiceName(invoice);
  return invoiceName === tableName ? tableName : `${tableName} - ${invoiceName}`;
}

function getServerKeepPreview(invoice) {
  const items = invoice.items || [];
  if (!items.length) return `<span>Aucune commande.</span>`;

  return items
    .slice(0, 4)
    .map((item) => `<span>${item.quantity} ${escapeHtml(item.name)}</span>`)
    .join("");
}

function getServerKeepStatus(invoice) {
  const status = getInvoicePaymentStatus(invoice);
  if (status === "paid") return "Reglee";
  if (status === "partial") return "Paiement en cours";
  return "Ouverte";
}

function openServerKeepInvoice(invoiceId) {
  selectedInvoiceId = invoiceId;
  localStorage.setItem("bryx_selected_invoice_backend", String(invoiceId));
  renderServerPhonePageFromState();
}

function backToServerKeepList() {
  selectedInvoiceId = null;
  localStorage.removeItem("bryx_selected_invoice_backend");
  renderServerPhonePageFromState();
}

function renderServerPhoneInvoiceFromState(invoiceId, options = {}) {
  const user = currentUser();

  if (user?.role === "SERVER") {
    renderServerPhonePageFromState();

    if (options.syncPaymentInputs) {
      const nameInput = document.getElementById(`item-name-${invoiceId}`);
      if (nameInput) nameInput.focus();
    }

    return true;
  }

  return false;
}

function renderServerPhonePage(user, visibleServers) {
  const grid = document.getElementById("serviceGrid");
  if (!grid) return;

  const viewedServer = getServerKeepViewedServer(user, visibleServers);

  document.body.classList.add("server-phone-mode", "server-keep-mode");
  document.body.classList.toggle("has-selected-invoice", Boolean(selectedInvoiceId));

  grid.innerHTML = "";
  grid.className = "service-grid server-keep-grid";

  if (!viewedServer) {
    grid.innerHTML = `<div class="server-keep-empty">Aucun serveur disponible.</div>`;
    return;
  }

  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedInvoiceId);
  const shell = document.createElement("section");
  shell.className = "server-keep-shell";

  shell.innerHTML = selectedInvoice
    ? renderServerKeepDetail(user, viewedServer, selectedInvoice)
    : renderServerKeepList(user, viewedServer, visibleServers);

  grid.appendChild(shell);
  lockActionButtons(shell);
}

function renderServerKeepList(user, viewedServer, visibleServers) {
  const ownView = viewedServer.id === user.id;
  const serverInvoices = getServerKeepInvoices(viewedServer.id);
  const openTables = tables.filter((table) => getServerIdFromTable(table) === viewedServer.id);
  const floatingInvoices = serverInvoices.filter((invoice) => invoice.tableId === null);

  return `
    <header class="server-keep-header">
      <div>
        <span>${ownView ? "Mon service" : "Service consulte"}</span>
        <strong>${escapeHtml(viewedServer.name)}</strong>
      </div>
      <button type="button" class="server-keep-logout" onclick="logout()">Deconnexion</button>
    </header>

    ${visibleServers.length > 1
      ? `<label class="server-keep-switch">
          <span>Voir un autre ecran</span>
          <select onchange="setServerPhoneView(Number(this.value))">
            ${visibleServers
        .map((server) => {
          return `<option value="${server.id}" ${server.id === viewedServer.id ? "selected" : ""}>
            ${server.id === user.id ? "Moi - " : ""}${escapeHtml(server.name)}
          </option>`;
        })
        .join("")}
          </select>
        </label>`
      : ""
    }

    <div class="server-keep-actions">
      ${canOpenTable() && canCurrentUserActOnServer(viewedServer.id)
      ? `<button type="button" onclick="showCreateTableForm(${viewedServer.id})">Nouvelle table</button>`
      : ""
    }
      ${canCreateInvoice() && canCurrentUserActOnServer(viewedServer.id)
      ? `<button type="button" class="secondary" onclick="addFloatingInvoice(${viewedServer.id})">Facture volante</button>`
      : ""
    }
    </div>

    <div id="create-table-${viewedServer.id}" class="server-keep-create">
      <input id="new-table-name-${viewedServer.id}" placeholder="Nom de la table" />
      <button type="button" onclick="addTable(${viewedServer.id})">Ouvrir</button>
      <button type="button" class="secondary" onclick="closeCreateTableForm(${viewedServer.id})">Annuler</button>
    </div>

    <div class="server-keep-board">
      ${openTables.map((table) => {
      const tableInvoices = serverInvoices.filter((invoice) => invoice.tableId === table.id);
      return renderServerKeepTableCard(table, tableInvoices);
    }).join("")}
      ${floatingInvoices.map((invoice) => renderServerKeepInvoiceCard(invoice)).join("")}
      ${!openTables.length && !floatingInvoices.length
      ? `<div class="server-keep-empty">Aucune table ouverte.</div>`
      : ""
    }
    </div>
  `;
}

function renderServerKeepTableCard(table, tableInvoices) {
  const total = tableInvoices.reduce((sum, invoice) => sum + getInvoiceTotal(invoice), 0);

  return `
    <article class="server-keep-table-card">
      <div class="server-keep-table-head">
        <button type="button" onclick="showCreateInvoiceForm(${table.id})">
          <strong>${escapeHtml(table.name)}</strong>
          <span>${tableInvoices.length} facture(s) - ${formatMoney(total)}</span>
        </button>
        <button type="button" class="server-keep-add-invoice" onclick="showCreateInvoiceForm(${table.id})">+ Facture</button>
      </div>
      <div id="create-invoice-${table.id}" class="server-keep-create inline">
        <input id="new-invoice-name-${table.id}" placeholder="Nom facture optionnel" />
        <button type="button" onclick="addInvoiceToTable(${table.id})">Creer</button>
        <button type="button" class="secondary" onclick="closeCreateInvoiceForm(${table.id})">Annuler</button>
      </div>
      <div class="server-keep-table-invoices">
        ${tableInvoices.length
      ? tableInvoices.map((invoice) => renderServerKeepInvoiceCard(invoice)).join("")
      : `<div class="server-keep-empty compact">Aucune facture pour le moment.</div>`
    }
      </div>
    </article>
  `;
}

function renderServerKeepInvoiceCard(invoice) {
  const lastChange = invoice.updatedAt || invoice.createdAt;

  return `
    <article class="server-keep-card ${getPaymentClass(invoice)}">
      <button type="button" onclick="openServerKeepInvoice(${invoice.id})">
        <div class="server-keep-card-head">
          <strong>${escapeHtml(getInvoiceKeepTitle(invoice))}</strong>
          <span>${getServerKeepStatus(invoice)}</span>
        </div>
        <div class="server-keep-preview">
          ${getServerKeepPreview(invoice)}
        </div>
        <div class="server-keep-card-foot">
          <span>Total : ${formatMoney(getInvoiceTotal(invoice))}</span>
          <span>${formatTime(lastChange)}</span>
        </div>
      </button>
    </article>
  `;
}

function renderServerKeepDetail(user, viewedServer, invoice) {
  const locked = isInvoiceLocked(invoice);
  const canAct = canActOnInvoice(invoice);

  return `
    <article class="server-keep-detail">
      <header class="server-keep-detail-head">
        <button type="button" class="server-keep-back" onclick="backToServerKeepList()">Retour</button>
        <div>
          <span>${escapeHtml(viewedServer.name)}</span>
          <strong>${escapeHtml(getInvoiceKeepTitle(invoice))}</strong>
        </div>
        <em>${formatMoney(getInvoiceTotal(invoice))}</em>
      </header>

      <section class="server-keep-detail-body">
        <div class="server-keep-items">
          ${(invoice.items || []).length
      ? (invoice.items || []).map((item) => renderServerKeepItem(invoice, item, locked, canAct)).join("")
      : `<div class="server-keep-empty compact">Aucun article.</div>`
    }
        </div>

        <div class="server-keep-side">
          ${!locked && canAddItem() && canAct
      ? renderServerKeepProductPicker(invoice.id)
      : locked
        ? `<div class="server-keep-empty compact">Facture reglee : commande verrouillee.</div>`
        : ""
    }
          ${renderServerKeepPayment(invoice, locked, canAct)}
        </div>
      </section>
    </article>
  `;
}

function renderServerKeepProductPicker(invoiceId) {
  if (!products.length) {
    return `<div class="server-keep-empty compact">Aucun produit catalogue.</div>`;
  }

  const activeCategory = getServerPhoneCategory(invoiceId);
  const categories = ["all", ...products
    .map((product) => getProductCategory(product))
    .filter((category, index, list) => list.indexOf(category) === index)];
  const visibleProducts = products.filter((product) => {
    if (activeCategory === "all") return true;
    return getProductCategory(product) === activeCategory;
  });

  return `
    <section class="server-keep-picker">
      <div class="server-keep-category-tabs">
        ${categories
      .map((category) => {
        const active = category === activeCategory;
        const label = category === "all" ? "Tous" : category;

        return `
          <button
            type="button"
            class="server-keep-category ${active ? "active" : ""}"
            onclick="setServerPhoneCategory(${invoiceId}, '${escapeJsString(category)}')"
          >
            ${escapeHtml(label)}
          </button>
        `;
      })
      .join("")}
      </div>

      <div class="server-keep-products">
        ${visibleProducts.length
      ? visibleProducts.map((product) => {
        return `
              <button type="button" onclick="quickAddProductToInvoice(${invoiceId}, ${product.id})">
                <strong>${escapeHtml(product.name)}</strong>
                <span>${formatMoney(product.price)}</span>
              </button>
            `;
      }).join("")
      : `<div class="server-keep-empty compact">Aucun article dans cette categorie.</div>`
    }
      </div>

      <details class="server-keep-manual">
        <summary>Article libre</summary>
        <div class="server-keep-add">
          <input
            id="item-name-${invoiceId}"
            list="products-list-${invoiceId}"
            placeholder="Nom de l'article"
            oninput="fillProductPrice(${invoiceId})"
          />
          ${renderProductsDatalist(invoiceId)}
          <input
            id="item-price-${invoiceId}"
            type="number"
            step="0.01"
            min="0"
            placeholder="Prix"
            ${canOverrideInvoiceItemPrice() ? "" : "hidden disabled"}
          />
          <button type="button" onclick="addItem(${invoiceId})">Ajouter</button>
        </div>
      </details>
    </section>
  `;
}

function renderServerKeepPayment(invoice, locked, canAct) {
  if (!canSetPayment() || !canAct) return "";

  return `
    <section class="server-keep-payment">
      <div class="server-keep-payment-head">
        <strong>Encaissement</strong>
        <span>Reste ${formatMoney(getInvoiceRemaining(invoice))}</span>
      </div>

      <div class="server-keep-payment-summary">
        <span>CB ${formatMoney(getInvoiceCardPaid(invoice))}</span>
        <span>Espèces ${formatMoney(getInvoiceCashPaid(invoice))}</span>
      </div>

      <div class="server-keep-payment-grid">
        <input
          id="card-paid-${invoice.id}"
          type="number"
          step="0.01"
          min="0"
          placeholder="CB"
          value="${getInvoiceCardPaid(invoice)}"
          ${locked ? "disabled" : ""}
        />

        <input
          id="cash-paid-${invoice.id}"
          type="number"
          step="0.01"
          min="0"
          placeholder="Espèces"
          value="${getInvoiceCashPaid(invoice)}"
          ${locked ? "disabled" : ""}
        />
      </div>

      <div class="server-keep-payment-actions">
        <button type="button" onclick="setInvoicePayment(${invoice.id})" ${locked ? "disabled" : ""}>Enregistrer</button>
        ${canSetFullCardPayment()
      ? `<button type="button" class="secondary" onclick="markInvoicePaidByCard(${invoice.id})" ${locked ? "disabled" : ""}>Tout CB</button>`
      : ""
    }
        ${canSetFullCashPayment()
      ? `<button type="button" class="secondary" onclick="markInvoicePaidByCash(${invoice.id})" ${locked ? "disabled" : ""}>Tout espèces</button>`
      : ""
    }
      </div>
    </section>
  `;
}

function renderServerKeepItem(invoice, item, locked, canAct) {
  const total = Number(item.quantity) * Number(item.unitPrice);

  return `
    <div class="server-keep-item">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${item.quantity} x ${formatMoney(item.unitPrice)} - ${formatMoney(total)}</span>
      </div>
      <div class="server-keep-qty">
        <button type="button" onclick="changeItemQuantity(${invoice.id}, ${item.id}, -1)" ${locked || !canEditItemQuantity() || !canAct ? "disabled" : ""}>-</button>
        <span>${item.quantity}</span>
        <button type="button" onclick="changeItemQuantity(${invoice.id}, ${item.id}, 1)" ${locked || !canEditItemQuantity() || !canAct ? "disabled" : ""}>+</button>
      </div>
    </div>
  `;
}
