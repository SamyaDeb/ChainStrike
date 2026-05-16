-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issuerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "asaId" INTEGER,
    "complianceContractId" INTEGER,
    "settlementContractId" INTEGER,
    "totalSupply" BIGINT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "pricePerToken" BIGINT,
    "tokenizationRatio" TEXT,
    "minimumInvestment" BIGINT NOT NULL DEFAULT 0,
    "lockupDays" INTEGER NOT NULL DEFAULT 0,
    "initialLiquidityTxId" TEXT,
    "custodianName" TEXT,
    "custodianJurisdiction" TEXT,
    "spvEntityName" TEXT,
    "metadataIpfsCid" TEXT,
    "metadataHash" TEXT,
    "jurisdictionBlocklist" TEXT NOT NULL DEFAULT '',
    "minimumKycTier" INTEGER NOT NULL DEFAULT 1,
    "accreditedInvestorRequired" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "listedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "AssetDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "AssetDocument_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetVerificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reviewerId" TEXT,
    "notes" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetVerificationLog_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CorporateAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recordDate" DATETIME NOT NULL,
    "paymentDate" DATETIME,
    "amountPerToken" BIGINT,
    "totalAmount" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'ANNOUNCED',
    "onChainTxId" TEXT,
    "announcementUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CorporateAction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OraclePrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "asaId" INTEGER NOT NULL,
    "assetId" TEXT NOT NULL,
    "price" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "signature" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_ticker_key" ON "Asset"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_asaId_key" ON "Asset"("asaId");

-- CreateIndex
CREATE INDEX "Asset_issuerId_idx" ON "Asset"("issuerId");

-- CreateIndex
CREATE INDEX "Asset_status_idx" ON "Asset"("status");

-- CreateIndex
CREATE INDEX "AssetDocument_assetId_idx" ON "AssetDocument"("assetId");

-- CreateIndex
CREATE INDEX "AssetVerificationLog_assetId_idx" ON "AssetVerificationLog"("assetId");

-- CreateIndex
CREATE INDEX "CorporateAction_assetId_idx" ON "CorporateAction"("assetId");

-- CreateIndex
CREATE INDEX "OraclePrice_asaId_idx" ON "OraclePrice"("asaId");

-- CreateIndex
CREATE INDEX "OraclePrice_assetId_idx" ON "OraclePrice"("assetId");
