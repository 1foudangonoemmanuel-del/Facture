const API_URL = window.BRYX_CONFIG?.API_URL || "/api";

let servers = [];
let tables = [];
let invoices = [];
let products = [];
let invoiceLogs = [];

let selectedInvoiceId =
  Number(localStorage.getItem("bryx_selected_invoice_backend")) || null;

let contextServerId = null;
let pendingConfirmAction = null;
let toastTimeout = null;

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

async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`);

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json();
}

async function apiPatch(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json();
}

async function apiDelete(path, body = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json();
}

/* -------------------- LOAD DATA -------------------- */

async function loadServiceData() {
  servers = await apiGet("/users");
  tables = await apiGet("/tables");
  invoices = await apiGet("/invoices");
  products = await apiGet("/products");
}

async function loadInvoiceLogs(invoiceId) {
  if (!invoiceId) {
    invoiceLogs = [];
    return;
  }

  try {
    invoiceLogs = await apiGet(`/activity-logs/invoice/${invoiceId}`);
  } catch {
    invoiceLogs = [];
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

function findProductByName(name) {
  const clean = normalizeText(name);

  return products.find((product) => {
    return normalizeText(product.name) === clean;
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

  let message = "Erreur.";

  try {
    const parsed = JSON.parse(error.message);
    message = parsed.message || message;
  } catch {
    message = error.message || message;
  }

  showToast(message, "error");
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

document.addEventListener("click", (event) => {
  const confirmButton = document.getElementById("confirmButton");
  const confirmOverlay = document.getElementById("confirmOverlay");
  const menu = document.getElementById("serverContextMenu");

  if (confirmButton && event.target === confirmButton) {
    confirmAction();
  }

  if (confirmOverlay && event.target === confirmOverlay) {
    closeConfirmModal();
  }

  if (menu && !menu.contains(event.target)) {
    closeServerContextMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeConfirmModal();
    closeServerContextMenu();
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
    .querySelectorAll(".server-create-table.active, .invoice-create-inline.active")
    .forEach((el) => el.classList.remove("active"));
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
    showError(error);
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
    showError(error);
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
    showError(error);
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
    showError(error);
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
    showError(error);
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
    showError(error);
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
    showError(error);
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
    showError(error);
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
    showError(error);
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
    showError(error);
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
    await apiPost(`/invoices/${invoiceId}/items`, body);

    nameInput.value = "";
    priceInput.value = "";
    nameInput.focus();

    await renderServicePage();
    showToast(product ? `${product.name} ajouté.` : "Article libre ajouté.");
  } catch (error) {
    showError(error);
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
    await apiPatch(`/items/${itemId}`, body);
    await renderServicePage();
  } catch (error) {
    showError(error);
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
    await deleteItem(invoiceId, itemId);
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

    await renderServicePage();
    showToast("Article supprimé.");
  } catch (error) {
    showError(error);
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
    await apiPatch(`/invoices/${invoiceId}/payment`, {
      cashPaid,
      cardPaid,
      actorUserId: currentUserId(),
    });

    await renderServicePage();
    showToast("Mode de règlement mis à jour.");
  } catch (error) {
    showError(error);
  }
}

async function markInvoicePaidByCard(invoiceId) {
  const invoice = invoices.find((inv) => inv.id === invoiceId);

  if (!invoice || !canSetFullCardPayment() || !canActOnInvoice(invoice)) {
    showToast("Tu ne peux pas modifier le règlement.", "error");
    return;
  }

  try {
    await apiPatch(`/invoices/${invoiceId}/payment`, {
      cashPaid: 0,
      cardPaid: getInvoiceTotal(invoice),
      actorUserId: currentUserId(),
    });

    await renderServicePage();
    showToast("Montant CB enregistré.");
  } catch (error) {
    showError(error);
  }
}

async function markInvoicePaidByCash(invoiceId) {
  const invoice = invoices.find((inv) => inv.id === invoiceId);

  if (!invoice || !canSetFullCashPayment() || !canActOnInvoice(invoice)) {
    showToast("Tu ne peux pas modifier le règlement.", "error");
    return;
  }

  try {
    await apiPatch(`/invoices/${invoiceId}/payment`, {
      cashPaid: getInvoiceTotal(invoice),
      cardPaid: 0,
      actorUserId: currentUserId(),
    });

    await renderServicePage();
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

async function renderServicePage() {
  const grid = document.getElementById("serviceGrid");
  if (!grid) return;

  const user = ensureConnected();
  if (!user) return;

  try {
    await loadServiceData();
  } catch (error) {
    showError(error);
    return;
  }

  tables = tables.filter((table) => table.status !== "CANCELLED" && table.status !== "CLOSED");
  invoices = invoices.filter((invoice) => invoice.status !== "CANCELLED");

  clearSelectedInvoiceIfMissing();

  if (selectedInvoiceId) {
    await loadInvoiceLogs(selectedInvoiceId);
  } else {
    invoiceLogs = [];
  }

  const visibleServers = getVisibleServersForCurrentUser();

  const currentUserBar = document.getElementById("currentUserBar");
  if (currentUserBar) {
    currentUserBar.innerHTML = `
      <div class="current-user-bar">
        <span>
          Connecté :
          <strong>${escapeHtml(user.name)}</strong>
          —
          ${escapeHtml(user.role)}
          ${typeof permissionLabelForCurrentUser === "function" ? `• ${escapeHtml(permissionLabelForCurrentUser())}` : ""}
        </span>
        <button class="small secondary" onclick="logout()">Déconnexion</button>
      </div>
    `;
  }

  grid.innerHTML = "";
  grid.className = "service-grid";

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

  if (visibleServers.length === 1) grid.classList.add("grid-1");
  else if (visibleServers.length === 2) grid.classList.add("grid-2");
  else if (visibleServers.length <= 4) grid.classList.add("grid-4");
  else grid.classList.add("grid-more");

  visibleServers.forEach((server) => {
    const serverTables = tables.filter((table) => getServerIdFromTable(table) === server.id);

    const floatingInvoices = invoices.filter((invoice) => {
      return (
        invoice.tableId === null &&
        getServerIdFromInvoice(invoice) === server.id &&
        shouldShowInvoiceForServer(invoice, server.id)
      );
    });

    const canActHere = canCurrentUserActOnServer(server.id);

    const box = document.createElement("div");
    box.className = `server-box ${canActHere ? "" : "readonly-server"}`;

    box.addEventListener("contextmenu", (event) => {
      openServerContextMenu(event, server.id);
    });

    const paymentStats = getServerPaymentStats(server.id);
    const activeFilter = getActiveFilter(server.id);

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
          ${canCreateInvoice() && canActHere
        ? `<button class="small" onclick="addFloatingInvoice(${server.id})">+ Facture volante</button>`
        : ""
      }

          ${canOpenTable() && canActHere
        ? `<button class="small secondary" onclick="showCreateTableForm(${server.id})">Ouvrir table</button>`
        : ""
      }
        </div>
      </div>

      <div class="server-filters">
        <button class="server-filter-btn ${activeFilter === "all" ? "active" : ""}" onclick="setServerFilter(${server.id}, 'all')">
          Toutes
        </button>
        <button class="server-filter-btn ${activeFilter === "open" ? "active" : ""}" onclick="setServerFilter(${server.id}, 'open')">
          En cours (${paymentStats.openCount})
        </button>
        <button class="server-filter-btn ${activeFilter === "paid" ? "active" : ""}" onclick="setServerFilter(${server.id}, 'paid')">
          Réglées (${paymentStats.paidCount})
        </button>
      </div>

      <div id="create-table-${server.id}" class="server-create-table">
        <input id="new-table-name-${server.id}" placeholder="Nom de la table..." />
        <button onclick="addTable(${server.id})">Ouvrir</button>
        <button class="secondary" onclick="closeCreateTableForm(${server.id})">Annuler</button>
      </div>

      <h4 class="zone-title">Tables ouvertes</h4>
      <div id="tables-zone-${server.id}" class="tables-area"></div>

      <h4 class="zone-title">Factures sans table</h4>
      <div id="floating-zone-${server.id}" class="floating-area"></div>
    `;

    grid.appendChild(box);

    renderTablesForServer(server.id, serverTables);
    renderFloatingInvoices(server.id, floatingInvoices);
  });

  renderInvoiceDetailPanel();
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
          <div class="attach-floating">
            <select id="move-table-server-${table.id}">
              <option value="">Transférer table vers...</option>
              ${getServerOptionsHtml(table.responsibleUserId)}
            </select>

            <button class="small secondary" onclick="moveTableToServer(${table.id})">
              Transférer
            </button>
          </div>
        `
        : "";

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
        ? `<button class="small" onclick="showCreateInvoiceForm(${table.id})">+ Facture</button>`
        : ""
      }

          ${canCloseTable()
        ? `<button class="danger small" onclick="askDeleteTable(${table.id})">Fermer</button>`
        : ""
      }
        </div>
      </div>

      ${moveTableHtml}

      <div id="create-invoice-${table.id}" class="invoice-create-inline">
        <input id="new-invoice-name-${table.id}" placeholder="Nom facture optionnel..." />
        <button onclick="addInvoiceToTable(${table.id})">Créer</button>
        <button class="secondary" onclick="closeCreateInvoiceForm(${table.id})">Annuler</button>
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
        <button class="split-invoice-button" onclick="selectInvoice(${invoice.id})">
          <div class="split-invoice-main">
            <strong>${escapeHtml(getInvoiceName(invoice))}</strong>
            <span>
              ${invoice.tableId === null ? "Sans table" : getTableNameById(invoice.tableId)}
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
        <div class="attach-floating">
          <select id="attach-table-${invoice.id}">
            <option value="">Ajouter à une table...</option>
            ${possibleTables
        .map((table) => `<option value="${table.id}">${escapeHtml(table.name)}</option>`)
        .join("")}
          </select>
          <button class="small" onclick="attachFloatingInvoiceToTable(${invoice.id})">Ajouter</button>
        </div>
      `
      : "";

  const moveInvoiceTableHtml =
    !locked && canAct
      ? `
        <div class="attach-floating">
          <select id="move-invoice-table-${invoice.id}">
            <option value="">Déplacer facture vers...</option>
            <option value="floating" ${invoice.tableId === null ? "disabled" : ""}>Facture volante</option>
            ${getTableOptionsHtml(invoice.tableId, invoice.responsibleUserId)}
          </select>

          <button class="small secondary" onclick="moveInvoiceToTable(${invoice.id})">
            Déplacer
          </button>
        </div>
      `
      : "";

  const moveInvoiceServerHtml =
    !locked && canMoveInvoice()
      ? `
        <div class="attach-floating">
          <select id="move-invoice-server-${invoice.id}">
            <option value="">Transférer facture vers serveur...</option>
            ${getServerOptionsHtml(invoice.responsibleUserId)}
          </select>

          <button class="small secondary" onclick="moveInvoiceToServer(${invoice.id})">
            Transférer
          </button>
        </div>
      `
      : "";

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
      ? `<button class="small" onclick="setInvoicePayment(${invoice.id})" ${locked ? "disabled" : ""}>
                Enregistrer règlement
              </button>`
      : ""
    }

        ${canSetFullCardPayment() && canAct
      ? `<button class="small secondary" onclick="markInvoicePaidByCard(${invoice.id})" ${locked ? "disabled" : ""}>
                Tout CB
              </button>`
      : ""
    }

        ${canSetFullCashPayment() && canAct
      ? `<button class="small secondary" onclick="markInvoicePaidByCash(${invoice.id})" ${locked ? "disabled" : ""}>
                Tout espèces
              </button>`
      : ""
    }

        ${canResetPayment()
      ? `<button class="small secondary" onclick="resetInvoicePayment(${invoice.id})" ${locked ? "disabled" : ""}>
                Reset
              </button>`
      : ""
    }

        ${canValidatePayment()
      ? `<button class="small" onclick="validateInvoicePaid(${invoice.id})" ${locked ? "disabled" : ""}>
                Clôturer réglée
              </button>`
      : `<button class="small" disabled title="Réservé caisse / manager / admin">
                Clôture réservée
              </button>`
    }
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

              <button onclick="addItem(${invoice.id})">Ajouter</button>
            </div>
          `
      : ""
    }

      <div class="items-list">
        ${renderItemsHtml(invoice)}
      </div>
    </div>

    ${canCancelInvoice()
      ? `<div class="detail-section">
            <h3>Actions sensibles</h3>
            <button class="danger" onclick="askDeleteInvoice(${invoice.id})" ${locked ? "disabled" : ""}>
              Annuler facture
            </button>
          </div>`
      : ""
    }

    <div class="detail-section">
      <h3>Historique</h3>
      ${renderInvoiceLogsHtml()}
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

      return `
        <div class="item-row">
          <input
            value="${escapeHtml(item.name)}"
            onchange="updateItem(${invoice.id}, ${item.id}, 'name', this.value)"
            ${locked || !canEditItemName() || !canAct ? "disabled" : ""}
          />

          <div class="qty-control">
            <button class="small secondary" onclick="changeItemQuantity(${invoice.id}, ${item.id}, -1)" ${locked || !canEditItemQuantity() || !canAct ? "disabled" : ""}>-</button>
            <div class="qty-value">${item.quantity}</div>
            <button class="small secondary" onclick="changeItemQuantity(${invoice.id}, ${item.id}, 1)" ${locked || !canEditItemQuantity() || !canAct ? "disabled" : ""}>+</button>
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
            ${!locked && canDeleteItem() && canAct
          ? `<button class="danger small" onclick="deleteItem(${invoice.id}, ${item.id})">x</button>`
          : ""
        }
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

/* -------------------- RECAP PAGE -------------------- */

async function renderRecapPage() {
  const dayTotal = document.getElementById("dayTotal");
  if (!dayTotal) return;

  const user = ensureConnected();
  if (!user) return;

  try {
    const recap = await apiGet("/recap/today");

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
          <button class="small secondary" onclick="logout()">Déconnexion</button>
        </div>
      `;
    }

    const summary = recap.summary;
    const ticketAverage =
      summary.invoiceCount > 0 ? summary.totalFacture / summary.invoiceCount : 0;

    dayTotal.textContent = formatMoney(summary.totalFacture);
    document.getElementById("tableCount").textContent = summary.tableCount;
    document.getElementById("invoiceCount").textContent = summary.invoiceCount;
    document.getElementById("averageTicket").textContent = formatMoney(ticketAverage);

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
  const recap = await apiGet("/recap/today");
  const s = recap.summary;

  const lines = [
    "RÉCAP BRYX",
    "",
    `Total journée : ${formatMoney(s.totalFacture)}`,
    `CB : ${formatMoney(s.totalCarte)}`,
    `Espèces : ${formatMoney(s.totalEspeces)}`,
    `Total réglé : ${formatMoney(s.totalRegle)}`,
    `Reste à régler : ${formatMoney(s.resteARegler)}`,
    "",
    `Tables : ${s.tableCount}`,
    `Factures : ${s.invoiceCount}`,
    "",
    "Par serveur :",
    ...(recap.byServer || []).map((server) => {
      return `- ${server.name} : ${formatMoney(server.total)} | CB ${formatMoney(server.card)} | Espèces ${formatMoney(server.cash)} | Reste ${formatMoney(server.remaining)}`;
    }),
  ];

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