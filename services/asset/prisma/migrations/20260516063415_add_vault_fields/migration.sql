-- AlterTable
ALTER TABLE "Asset" ADD COLUMN "liquidityDepositTxId" TEXT;
ALTER TABLE "Asset" ADD COLUMN "liquidityDepositUsdc" BIGINT;
ALTER TABLE "Asset" ADD COLUMN "vaultContractId" INTEGER;
