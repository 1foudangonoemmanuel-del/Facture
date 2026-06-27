/* =========================================================
   BRYX — PERMISSIONS PAR RÔLE
   =========================================================

   Rôles :
   ADMIN   = accès total
   MANAGER = service + corrections + clôture + supervision
   CAISSE  = service + règlement + clôture + corrections limitées
   SERVER  = service simple
*/

/* -------------------- ROLE -------------------- */

function getRole() {
    const user = getCurrentUser();

    return user ? user.role : null;
}

function hasRole(...roles) {
    const role = getRole();

    return roles.includes(role);
}

/* -------------------- ACCÈS PAGES -------------------- */

function canAccessServicePage() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canAccessRecapPage() {
    return hasRole("ADMIN", "MANAGER", "CAISSE");
}

function canAccessAdminPage() {
    return hasRole("ADMIN");
}

/* -------------------- SERVICE : VUE -------------------- */

function canViewServiceDashboard() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canViewAllServers() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canViewServerTotals() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canViewPaidInvoices() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

/* -------------------- SERVEURS -------------------- */

function canCreateServerFromService() {
    return false;
}

function canBlockServerFromService() {
    return false;
}

/* -------------------- TABLES -------------------- */

function canOpenTable() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canRenameTable() {
    return hasRole("ADMIN", "MANAGER");
}

function canCloseTable() {
    return hasRole("ADMIN", "MANAGER", "CAISSE");
}

function canMoveTable() {
    return hasRole("ADMIN", "MANAGER");
}

/* -------------------- FACTURES -------------------- */

function canCreateInvoice() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canRenameInvoice() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canCancelInvoice() {
    return hasRole("ADMIN", "MANAGER", "CAISSE");
}

function canMoveInvoice() {
    return hasRole("ADMIN", "MANAGER", "CAISSE");
}

function canAttachFloatingInvoiceToTable() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canReopenPaidInvoice() {
    return hasRole("ADMIN");
}

/* -------------------- ARTICLES FACTURE -------------------- */

function canAddItem() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canAddFreeItem() {
    return hasRole("ADMIN", "MANAGER", "CAISSE");
}

function canEditItemName() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canEditItemQuantity() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canEditItemPrice() {
    return hasRole("ADMIN", "MANAGER", "CAISSE");
}

function canDeleteItem() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

/* -------------------- CATALOGUE PRODUITS -------------------- */

function canManageCatalog() {
    return hasRole("ADMIN", "MANAGER");
}

function canCreateCatalogProduct() {
    return hasRole("ADMIN", "MANAGER");
}

function canEditCatalogProduct() {
    return hasRole("ADMIN", "MANAGER");
}

function canDisableCatalogProduct() {
    return hasRole("ADMIN", "MANAGER");
}

/* -------------------- RÈGLEMENT -------------------- */

function canSetPayment() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canSetFullCardPayment() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canSetFullCashPayment() {
    return hasRole("ADMIN", "MANAGER", "CAISSE", "SERVER");
}

function canResetPayment() {
    return hasRole("ADMIN", "MANAGER", "CAISSE");
}

function canValidatePayment() {
    return hasRole("ADMIN", "MANAGER", "CAISSE");
}

/* -------------------- CORRECTIONS SENSIBLES -------------------- */

function canDoSensitiveServiceActions() {
    return hasRole("ADMIN", "MANAGER", "CAISSE");
}

function canCorrectOtherServerInvoice() {
    return hasRole("ADMIN", "MANAGER", "CAISSE");
}

function canApplyDiscount() {
    return hasRole("ADMIN", "MANAGER");
}

/* -------------------- ADMIN -------------------- */

function canManageUsers() {
    return hasRole("ADMIN");
}

function canChangeRoles() {
    return hasRole("ADMIN");
}

function canBlockUsers() {
    return hasRole("ADMIN");
}

function canViewActivityLogs() {
    return hasRole("ADMIN", "MANAGER");
}

/* -------------------- HELPERS UI -------------------- */

function disabledIfNoPermission(permissionFn) {
    return permissionFn() ? "" : "disabled";
}

function hiddenIfNoPermission(permissionFn) {
    return permissionFn() ? "" : "hidden";
}

function permissionLabelForCurrentUser() {
    const role = getRole();

    if (role === "ADMIN") {
        return "Accès total";
    }

    if (role === "MANAGER") {
        return "Service + corrections + clôture";
    }

    if (role === "CAISSE") {
        return "Service + règlement + clôture";
    }

    if (role === "SERVER") {
        return "Service simple";
    }

    return "Non connecté";
}