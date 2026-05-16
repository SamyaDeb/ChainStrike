-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT NOT NULL,
    "asaId" INTEGER NOT NULL,
    "assetId" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "sellerUserId" TEXT NOT NULL,
    "buyerWalletAddress" TEXT NOT NULL,
    "sellerWalletAddress" TEXT NOT NULL,
    "tokenAmount" BIGINT NOT NULL,
    "usdcAmount" BIGINT NOT NULL,
    "platformFee" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "onChainTxId" TEXT,
    "onChainGroupId" TEXT,
    "confirmedRound" INTEGER,
    "failureReason" TEXT,
    "settledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SettlementLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "txId" TEXT,
    "error" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SettlementLog_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EscrowHold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "asaId" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "lockTxId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LOCKED',
    "releasedAt" DATETIME,
    "releaseTxId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_tradeId_key" ON "Settlement"("tradeId");

-- CreateIndex
CREATE INDEX "Settlement_status_idx" ON "Settlement"("status");

-- CreateIndex
CREATE INDEX "Settlement_tradeId_idx" ON "Settlement"("tradeId");

-- CreateIndex
CREATE INDEX "SettlementLog_settlementId_idx" ON "SettlementLog"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "EscrowHold_orderId_key" ON "EscrowHold"("orderId");

-- CreateIndex
CREATE INDEX "EscrowHold_userId_idx" ON "EscrowHold"("userId");

-- CreateIndex
CREATE INDEX "EscrowHold_status_idx" ON "EscrowHold"("status");
