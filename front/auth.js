const AUTH_API_URL = window.BRYX_CONFIG?.API_URL || "/api";
const CURRENT_USER_KEY = "bryx_current_user";

/* -------------------- USER STORAGE -------------------- */

function getCurrentUser() {
    try {
        return JSON.parse(localStorage.getItem(CURRENT_USER_KEY));
    } catch {
        return null;
    }
}

function setCurrentUser(user) {
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
}

function clearCurrentUser() {
    localStorage.removeItem(CURRENT_USER_KEY);
}

function getCurrentUserId() {
    const user = getCurrentUser();
    return user ? user.id : null;
}

function getAuthToken() {
    const user = getCurrentUser();
    return user ? user.token : null;
}

function getAuthHeaders() {
    const token = getAuthToken();

    return token
        ? {
            Authorization: `Bearer ${token}`,
        }
        : {};
}

function getCurrentUserRole() {
    const user = getCurrentUser();
    return user ? user.role : null;
}

/* -------------------- ROLE HELPERS -------------------- */

function isAdmin() {
    return getCurrentUserRole() === "ADMIN";
}

function isManager() {
    return getCurrentUserRole() === "MANAGER";
}

function isCaisse() {
    return getCurrentUserRole() === "CAISSE";
}

function isServer() {
    return getCurrentUserRole() === "SERVER";
}

function canManageUsers() {
    return isAdmin();
}

function canValidatePayment() {
    return isAdmin() || isManager() || isCaisse();
}

function canMoveInvoices() {
    return isAdmin() || isManager() || isCaisse();
}

function canSeeAdminPage() {
    return isAdmin();
}

function canSeeRecapPage() {
    return isAdmin() || isManager() || isCaisse();
}

function canUseServicePage() {
    return isAdmin() || isManager() || isCaisse() || isServer();
}

/* -------------------- AUTH GUARDS -------------------- */

function requireAuth() {
    const user = getCurrentUser();

    if (!user || !user.token) {
        clearCurrentUser();
        window.location.href = "login.html";
        return null;
    }

    return user;
}

function requireRole(allowedRoles) {
    const user = requireAuth();

    if (!user) return null;

    if (!allowedRoles.includes(user.role)) {
        redirectUserByRole(user.role);
        return null;
    }

    return user;
}

function redirectUserByRole(role) {
    if (role === "ADMIN") {
        window.location.href = "admin.html";
        return;
    }

    if (role === "MANAGER" || role === "CAISSE" || role === "SERVER") {
        window.location.href = "service.html";
        return;
    }

    window.location.href = "login.html";
}

function logout() {
    clearCurrentUser();
    window.location.href = "login.html";
}

/* -------------------- LOGIN -------------------- */

async function login() {
    const nameInput = document.getElementById("loginName");
    const pinInput = document.getElementById("loginPin");

    if (!nameInput || !pinInput) return;

    const name = nameInput.value.trim();
    const pin = pinInput.value.trim();

    if (!name || !pin) {
        showAuthToast("Entre ton nom et ton code PIN.", "error");
        return;
    }

    try {
        const res = await fetch(`${AUTH_API_URL}/auth/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ name, pin }),
        });

        if (!res.ok) {
            const error = await res.json().catch(() => null);
            throw new Error(error?.message || "Connexion impossible");
        }

        const user = await res.json();

        if (!user?.token) {
            throw new Error("Connexion incomplete: redeploie aussi le backend.");
        }

        setCurrentUser(user);

        if (user.role === "ADMIN") {
            window.location.href = "admin.html";
            return;
        }

        window.location.href = "service.html";
    } catch (error) {
        showAuthToast(error.message || "Erreur de connexion.", "error");
    }
}

/* -------------------- LOGIN PAGE INIT -------------------- */

function initLoginPage() {
    const existingUser = getCurrentUser();

    if (existingUser && existingUser.token) {
        if (existingUser.role === "ADMIN") {
            window.location.href = "admin.html";
            return;
        }

        window.location.href = "service.html";
        return;
    }

    if (existingUser && !existingUser.token) {
        clearCurrentUser();
    }

    const nameInput = document.getElementById("loginName");
    const pinInput = document.getElementById("loginPin");

    if (nameInput) {
        nameInput.focus();
    }

    [nameInput, pinInput].forEach((input) => {
        if (!input) return;

        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                login();
            }
        });
    });
}

/* -------------------- NAV / USER BAR -------------------- */

function renderCurrentUserBar() {
    const user = getCurrentUser();
    if (!user) return "";

    return `
    <div class="current-user-bar">
      <span>
        Connecté :
        <strong>${escapeAuthHtml(user.name)}</strong>
        —
        ${escapeAuthHtml(user.role)}
      </span>

      <button class="small secondary" onclick="logout()">
        Déconnexion
      </button>
    </div>
  `;
}

function renderRoleNav() {
    const user = getCurrentUser();

    if (!user) {
        return `
      <a href="login.html">Connexion</a>
    `;
    }

    const links = [];

    if (canUseServicePage()) {
        links.push(`<a href="service.html">Service</a>`);
    }

    if (canSeeRecapPage()) {
        links.push(`<a href="recap.html">Récap</a>`);
    }

    if (canSeeAdminPage()) {
        links.push(`<a href="admin.html">Admin</a>`);
    }

    return links.join("");
}

function injectCurrentUserBar() {
    const bar = document.getElementById("currentUserBar");
    if (!bar) return;

    bar.innerHTML = renderCurrentUserBar();
}

function injectRoleNav() {
    const nav = document.getElementById("roleNav");
    if (!nav) return;

    nav.innerHTML = renderRoleNav();
}

/* -------------------- TOAST -------------------- */

function showAuthToast(message, type = "success") {
    const toast = document.getElementById("toast");

    if (!toast) {
        alert(message);
        return;
    }

    toast.textContent = message;
    toast.className = `toast show ${type}`;

    setTimeout(() => {
        toast.className = "toast";
    }, 2400);
}

/* -------------------- HTML ESCAPE -------------------- */

function escapeAuthHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
