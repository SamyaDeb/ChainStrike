-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "asaId" INTEGER NOT NULL,
    "ticker" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PRE_MARKET',
    "referencePriceUsdc" BIGINT,
    "upperPriceBand" BIGINT,
    "lowerPriceBand" BIGINT,
    "lastTradedPrice" BIGINT,
    "volume24h" BIGINT NOT NULL DEFAULT 0,
    "circuitBreakerActive" BOOLEAN NOT NULL DEFAULT false,
    "circuitBreakerUntil" DATETIME,
    "openedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "timeInForce" TEXT NOT NULL DEFAULT 'GTC',
    "price" BIGINT,
    "quantity" BIGINT NOT NULL,
    "filledQuantity" BIGINT NOT NULL DEFAULT 0,
    "remainingQuantity" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "rejectionReason" TEXT,
    "escrowTxId" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "buyOrderId" TEXT NOT NULL,
    "sellOrderId" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "sellerUserId" TEXT NOT NULL,
    "buyerWalletAddress" TEXT NOT NULL,
    "sellerWalletAddress" TEXT NOT NULL,
    "price" BIGINT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "totalValue" BIGINT NOT NULL,
    "platformFee" BIGINT NOT NULL,
    "feeRate" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'MATCHED',
    "settlementAttempts" INTEGER NOT NULL DEFAULT 0,
    "onChainTxId" TEXT,
    "settledAt" DATETIME,
    "failureReason" TEXT,
    "matchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trade_buyOrderId_fkey" FOREIGN KEY ("buyOrderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Trade_sellOrderId_fkey" FOREIGN KEY ("sellOrderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OhlcvBar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "open" BIGINT NOT NULL,
    "high" BIGINT NOT NULL,
    "low" BIGINT NOT NULL,
    "close" BIGINT NOT NULL,
    "volume" BIGINT NOT NULL,
    "trades" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Market_assetId_key" ON "Market"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "Market_asaId_key" ON "Market"("asaId");

-- CreateIndex
CREATE UNIQUE INDEX "Market_ticker_key" ON "Market"("ticker");

-- CreateIndex
CREATE INDEX "Order_marketId_status_side_price_idx" ON "Order"("marketId", "status", "side", "price");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Trade_marketId_idx" ON "Trade"("marketId");

-- CreateIndex
CREATE INDEX "Trade_status_idx" ON "Trade"("status");

-- CreateIndex
CREATE INDEX "Trade_matchedAt_idx" ON "Trade"("matchedAt");

-- CreateIndex
CREATE INDEX "OhlcvBar_marketId_interval_timestamp_idx" ON "OhlcvBar"("marketId", "interval", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "OhlcvBar_marketId_interval_timestamp_key" ON "OhlcvBar"("marketId", "interval", "timestamp");
