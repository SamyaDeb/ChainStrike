-- CreateTable
CREATE TABLE "WhitelistEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletAddress" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "asaId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "kycTier" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "removedAt" DATETIME,
    "removedReason" TEXT,
    "onChainTxId" TEXT
);

-- CreateTable
CREATE TABLE "TransferRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AmlAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "walletAddress" TEXT,
    "tradeId" TEXT,
    "orderId" TEXT,
    "alertType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT NOT NULL,
    "rawData" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "resolution" TEXT
);

-- CreateTable
CREATE TABLE "SarReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "narrativeText" TEXT,
    "fiuReference" TEXT,
    "filingJurisdiction" TEXT NOT NULL,
    "filedAt" DATETIME,
    "filedBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "rejectionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SarReport_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "AmlAlert" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ComplianceEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "onChainTxId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WalletRiskScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletAddress" TEXT NOT NULL,
    "riskBand" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "exposures" TEXT NOT NULL DEFAULT '[]',
    "provider" TEXT NOT NULL,
    "lastCheckedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SanctionsScreeningResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "isMatch" BOOLEAN NOT NULL,
    "matchedLists" TEXT NOT NULL DEFAULT '',
    "matchedNames" TEXT NOT NULL DEFAULT '',
    "screenerAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requiresReview" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE INDEX "WhitelistEntry_walletAddress_idx" ON "WhitelistEntry"("walletAddress");

-- CreateIndex
CREATE INDEX "WhitelistEntry_assetId_idx" ON "WhitelistEntry"("assetId");

-- CreateIndex
CREATE INDEX "WhitelistEntry_userId_idx" ON "WhitelistEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WhitelistEntry_walletAddress_assetId_key" ON "WhitelistEntry"("walletAddress", "assetId");

-- CreateIndex
CREATE INDEX "TransferRule_assetId_idx" ON "TransferRule"("assetId");

-- CreateIndex
CREATE INDEX "AmlAlert_userId_idx" ON "AmlAlert"("userId");

-- CreateIndex
CREATE INDEX "AmlAlert_status_idx" ON "AmlAlert"("status");

-- CreateIndex
CREATE INDEX "AmlAlert_detectedAt_idx" ON "AmlAlert"("detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SarReport_alertId_key" ON "SarReport"("alertId");

-- CreateIndex
CREATE INDEX "ComplianceEvent_subjectType_subjectId_idx" ON "ComplianceEvent"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ComplianceEvent_eventType_idx" ON "ComplianceEvent"("eventType");

-- CreateIndex
CREATE INDEX "ComplianceEvent_createdAt_idx" ON "ComplianceEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletRiskScore_walletAddress_key" ON "WalletRiskScore"("walletAddress");

-- CreateIndex
CREATE INDEX "SanctionsScreeningResult_userId_idx" ON "SanctionsScreeningResult"("userId");

-- CreateIndex
CREATE INDEX "SanctionsScreeningResult_screenerAt_idx" ON "SanctionsScreeningResult"("screenerAt");
