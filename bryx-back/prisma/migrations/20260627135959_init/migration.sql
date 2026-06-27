-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "pin" TEXT,
    "role" TEXT NOT NULL DEFAULT 'SERVER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Table" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "responsibleUserId" INTEGER,
    "createdByUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Table_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Table_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "tableId" INTEGER,
    "responsibleUserId" INTEGER,
    "createdByUserId" INTEGER,
    "cashPaid" REAL NOT NULL DEFAULT 0,
    "cardPaid" REAL NOT NULL DEFAULT 0,
    "paymentRequested" BOOLEAN NOT NULL DEFAULT false,
    "paymentRequestedAt" DATETIME,
    "paymentValidated" BOOLEAN NOT NULL DEFAULT false,
    "validatedByUserId" INTEGER,
    "validatedAt" DATETIME,
    "discountAmount" REAL NOT NULL DEFAULT 0,
    "discountPercent" REAL NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "discountByUserId" INTEGER,
    "customerId" INTEGER,
    "deferredPayment" BOOLEAN NOT NULL DEFAULT false,
    "deferredReason" TEXT,
    "deferredByUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_validatedByUserId_fkey" FOREIGN KEY ("validatedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_discountByUserId_fkey" FOREIGN KEY ("discountByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_deferredByUserId_fkey" FOREIGN KEY ("deferredByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" REAL NOT NULL,
    "addedByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Item_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Item_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Item_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "method" TEXT NOT NULL,
    "receivedByUserId" INTEGER,
    "customerId" INTEGER,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "action" TEXT NOT NULL,
    "actorUserId" INTEGER,
    "tableId" INTEGER,
    "invoiceId" INTEGER,
    "itemId" INTEGER,
    "targetType" TEXT,
    "targetId" INTEGER,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Table_responsibleUserId_idx" ON "Table"("responsibleUserId");

-- CreateIndex
CREATE INDEX "Table_status_idx" ON "Table"("status");

-- CreateIndex
CREATE INDEX "Invoice_tableId_idx" ON "Invoice"("tableId");

-- CreateIndex
CREATE INDEX "Invoice_responsibleUserId_idx" ON "Invoice"("responsibleUserId");

-- CreateIndex
CREATE INDEX "Invoice_createdByUserId_idx" ON "Invoice"("createdByUserId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_paymentValidated_idx" ON "Invoice"("paymentValidated");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Item_invoiceId_idx" ON "Item"("invoiceId");

-- CreateIndex
CREATE INDEX "Item_addedByUserId_idx" ON "Item"("addedByUserId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_method_idx" ON "Payment"("method");

-- CreateIndex
CREATE INDEX "Payment_receivedByUserId_idx" ON "Payment"("receivedByUserId");

-- CreateIndex
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Customer_active_idx" ON "Customer"("active");

-- CreateIndex
CREATE INDEX "ActivityLog_actorUserId_idx" ON "ActivityLog"("actorUserId");

-- CreateIndex
CREATE INDEX "ActivityLog_tableId_idx" ON "ActivityLog"("tableId");

-- CreateIndex
CREATE INDEX "ActivityLog_invoiceId_idx" ON "ActivityLog"("invoiceId");

-- CreateIndex
CREATE INDEX "ActivityLog_action_idx" ON "ActivityLog"("action");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
