-- AlterTable
ALTER TABLE "Asset" ADD COLUMN "issuanceEscrowAmount" BIGINT;
ALTER TABLE "Asset" ADD COLUMN "issuanceEscrowReleaseTxId" TEXT;
ALTER TABLE "Asset" ADD COLUMN "issuanceEscrowStatus" TEXT;
ALTER TABLE "Asset" ADD COLUMN "issuanceEscrowTxId" TEXT;
