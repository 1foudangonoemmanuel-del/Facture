const ADMIN_API_URL = window.BRYX_CONFIG?.API_URL || "/api";

let adminUsers = [];
let adminProducts = [];
let adminToastTimeout = null;

/* -------------------- API -------------------- */

async function adminGet(path) {
    const res = await fetch(`${ADMIN_API_URL}${path}`);

    if (!res.ok) {
        throw new Error(await res.text());
    }

    return res.json();
}

async function adminPost(path, body) {
    const res = await fetch(`${ADMIN_API_URL}${path}`, {
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

async function adminPatch(path, body) {
    const res = await fetch(`${ADMIN_API_URL}${path}`, {
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

async function adminDelete(path, body = {}) {
    const res = await fetch(`${ADMIN_API_URL}${path}`, {
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

/* -------------------- CURRENT USER -------------------- */

function adminCurrentUser() {
    if (typeof getCurrentUser === "function") {
        return getCurrentUser();
    }

    try {
        return JSON.parse(localStorage.getItem("bryx_current_user"));
    } catch {
        return null;
    }
}

function adminCurrentUserId() {
    const user = adminCurrentUser();
    return user ? user.id : null;
}

/* -------------------- HELPERS -------------------- */

function adminEscapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function adminFormatMoney(value) {
    return `${Number(value || 0).toFixed(2)} €`;
}

function adminShowToast(message, type = "success") {
    const toast = document.getElementById("toast");

    if (!toast) {
        alert(message);
        return;
    }

    clearTimeout(adminToastTimeout);

    toast.textContent = message;
    toast.className = `toast show ${type}`;

    adminToastTimeout = setTimeout(() => {
        toast.className = "toast";
    }, 2400);
}

function adminShowError(error) {
    console.error(error);

    let message = "Erreur.";

    try {
        const parsed = JSON.parse(error.message);
        message = parsed.message || message;
    } catch {
        message = error.message || message;
    }

    adminShowToast(message, "error");
}

/* -------------------- RENDER -------------------- */

async function renderAdminPage() {
    try {
        adminUsers = await adminGet("/users");
        adminProducts = await adminGet("/products");

        renderUsers();
        renderProducts();
    } catch (error) {
        adminShowError(error);
    }
}

/* -------------------- USERS -------------------- */

function renderUsers() {
    const container = document.getElementById("usersList");
    if (!container) return;

    if (!adminUsers.length) {
        container.innerHTML = `<div class="empty-zone">Aucun utilisateur.</div>`;
        return;
    }

    container.innerHTML = adminUsers
        .map((user) => {
            const deleted = user.active === false;
            const blocked = user.blocked === true || user.active === false;
            const isMe = Number(user.id) === Number(adminCurrentUserId());

            return `
        <div class="admin-row ${blocked ? "blocked" : ""}">
          <div class="admin-row-main">
            <strong>${adminEscapeHtml(user.name)}</strong>
            <span>
              ID ${user.id}
              • ${adminEscapeHtml(user.role)}
              • ${deleted
                    ? "Supprimé"
                    : blocked
                        ? "Bloqué"
                        : "Actif"
                }
              ${isMe ? "• Moi" : ""}
            </span>
          </div>

          <div class="admin-row-actions">
            <select id="role-user-${user.id}" ${deleted ? "disabled" : ""}>
              <option value="SERVER" ${user.role === "SERVER" ? "selected" : ""}>SERVER</option>
              <option value="CAISSE" ${user.role === "CAISSE" ? "selected" : ""}>CAISSE</option>
              <option value="MANAGER" ${user.role === "MANAGER" ? "selected" : ""}>MANAGER</option>
              <option value="ADMIN" ${user.role === "ADMIN" ? "selected" : ""}>ADMIN</option>
            </select>

            <button
              class="small secondary"
              onclick="updateUserRole(${user.id})"
              ${deleted ? "disabled" : ""}
            >
              Modifier rôle
            </button>

            ${deleted
                    ? `<button class="small secondary" disabled>Compte supprimé</button>`
                    : blocked
                        ? `<button class="small" onclick="unblockUser(${user.id})">Débloquer</button>`
                        : `<button class="small danger" onclick="blockUser(${user.id})">Bloquer</button>`
                }

            <button
              class="small danger"
              onclick="deleteUser(${user.id})"
              ${deleted || isMe ? "disabled" : ""}
              title="${isMe ? "Tu ne peux pas supprimer ton propre compte" : "Supprimer ce compte"}"
            >
              Supprimer
            </button>
          </div>
        </div>
      `;
        })
        .join("");
}

async function createUser() {
    const nameInput = document.getElementById("newUserName");
    const pinInput = document.getElementById("newUserPin");
    const roleInput = document.getElementById("newUserRole");

    if (!nameInput || !pinInput || !roleInput) return;

    const name = nameInput.value.trim();
    const pin = pinInput.value.trim();
    const role = roleInput.value;

    if (!name) {
        adminShowToast("Nom utilisateur obligatoire.", "error");
        nameInput.focus();
        return;
    }

    if (!pin) {
        adminShowToast("Code PIN obligatoire.", "error");
        pinInput.focus();
        return;
    }

    try {
        await adminPost("/users", {
            name,
            pin,
            role,
            actorUserId: adminCurrentUserId(),
        });

        nameInput.value = "";
        pinInput.value = "";
        roleInput.value = "SERVER";

        await renderAdminPage();
        adminShowToast("Utilisateur créé.");
    } catch (error) {
        adminShowError(error);
    }
}

async function updateUserRole(userId) {
    const user = adminUsers.find((u) => u.id === userId);

    if (user && user.active === false) {
        adminShowToast("Compte supprimé : rôle non modifiable.", "error");
        return;
    }

    const select = document.getElementById(`role-user-${userId}`);
    if (!select) return;

    try {
        await adminPatch(`/users/${userId}/role`, {
            role: select.value,
            actorUserId: adminCurrentUserId(),
        });

        await renderAdminPage();
        adminShowToast("Rôle modifié.");
    } catch (error) {
        adminShowError(error);
    }
}

async function blockUser(userId) {
    try {
        await adminPatch(`/users/${userId}/block`, {
            actorUserId: adminCurrentUserId(),
        });

        await renderAdminPage();
        adminShowToast("Utilisateur bloqué.");
    } catch (error) {
        adminShowError(error);
    }
}

async function unblockUser(userId) {
    try {
        await adminPatch(`/users/${userId}/unblock`, {
            actorUserId: adminCurrentUserId(),
        });

        await renderAdminPage();
        adminShowToast("Utilisateur débloqué.");
    } catch (error) {
        adminShowError(error);
    }
}

async function deleteUser(userId) {
    const user = adminUsers.find((u) => u.id === userId);

    if (!user) return;

    if (Number(userId) === Number(adminCurrentUserId())) {
        adminShowToast("Tu ne peux pas supprimer ton propre compte.", "error");
        return;
    }

    const ok = confirm(
        `Supprimer le compte "${user.name}" ?\n\n` +
        `Il ne pourra plus se connecter et disparaîtra du service.\n` +
        `Les anciennes factures garderont quand même son historique.`
    );

    if (!ok) return;

    try {
        await adminDelete(`/users/${userId}`, {
            actorUserId: adminCurrentUserId(),
        });

        await renderAdminPage();
        adminShowToast("Compte supprimé.");
    } catch (error) {
        adminShowError(error);
    }
}

/* -------------------- PRODUCTS -------------------- */

function renderProducts() {
    const container = document.getElementById("productsList");
    if (!container) return;

    if (!adminProducts.length) {
        container.innerHTML = `<div class="empty-zone">Aucun produit catalogue.</div>`;
        return;
    }

    container.innerHTML = adminProducts
        .map((product) => {
            return `
        <div class="admin-row">
          <div class="admin-row-main">
            <strong>${adminEscapeHtml(product.name)}</strong>
            <span>
              ${adminFormatMoney(product.price)}
              • ${adminEscapeHtml(product.category || "Sans catégorie")}
            </span>
          </div>

          <div class="admin-row-actions product-actions">
            <input
              id="product-name-${product.id}"
              value="${adminEscapeHtml(product.name)}"
              placeholder="Nom"
            />

            <input
              id="product-price-${product.id}"
              type="number"
              step="0.01"
              min="0"
              value="${product.price}"
              placeholder="Prix"
            />

            <input
              id="product-category-${product.id}"
              value="${adminEscapeHtml(product.category || "")}"
              placeholder="Catégorie"
            />

            <button class="small secondary" onclick="updateProduct(${product.id})">
              Modifier
            </button>

            <button class="small danger" onclick="disableProduct(${product.id})">
              Désactiver
            </button>
          </div>
        </div>
      `;
        })
        .join("");
}

async function createProduct() {
    const nameInput = document.getElementById("newProductName");
    const priceInput = document.getElementById("newProductPrice");
    const categoryInput = document.getElementById("newProductCategory");

    if (!nameInput || !priceInput || !categoryInput) return;

    const name = nameInput.value.trim();
    const price = parseFloat(priceInput.value);
    const category = categoryInput.value.trim();

    if (!name) {
        adminShowToast("Nom produit obligatoire.", "error");
        nameInput.focus();
        return;
    }

    if (Number.isNaN(price) || price < 0) {
        adminShowToast("Prix invalide.", "error");
        priceInput.focus();
        return;
    }

    try {
        await adminPost("/products", {
            name,
            price,
            category,
            actorUserId: adminCurrentUserId(),
        });

        nameInput.value = "";
        priceInput.value = "";
        categoryInput.value = "";
        nameInput.focus();

        await renderAdminPage();
        adminShowToast("Produit créé.");
    } catch (error) {
        adminShowError(error);
    }
}

async function updateProduct(productId) {
    const nameInput = document.getElementById(`product-name-${productId}`);
    const priceInput = document.getElementById(`product-price-${productId}`);
    const categoryInput = document.getElementById(`product-category-${productId}`);

    if (!nameInput || !priceInput || !categoryInput) return;

    const name = nameInput.value.trim();
    const price = parseFloat(priceInput.value);
    const category = categoryInput.value.trim();

    if (!name) {
        adminShowToast("Nom produit obligatoire.", "error");
        nameInput.focus();
        return;
    }

    if (Number.isNaN(price) || price < 0) {
        adminShowToast("Prix invalide.", "error");
        priceInput.focus();
        return;
    }

    try {
        await adminPatch(`/products/${productId}`, {
            name,
            price,
            category,
            actorUserId: adminCurrentUserId(),
        });

        await renderAdminPage();
        adminShowToast("Produit modifié.");
    } catch (error) {
        adminShowError(error);
    }
}

async function disableProduct(productId) {
    const product = adminProducts.find((p) => p.id === productId);

    const ok = confirm(
        `Désactiver ${product ? product.name : "ce produit"} ?\n\n` +
        `Il ne sera plus proposé dans le service.`
    );

    if (!ok) return;

    try {
        await adminPatch(`/products/${productId}/disable`, {
            actorUserId: adminCurrentUserId(),
        });

        await renderAdminPage();
        adminShowToast("Produit désactivé.");
    } catch (error) {
        adminShowError(error);
    }
}