/**
 * Fix: recordIssuanceLock failed for existing assets because box MBR was
 * under-funded (sent 34,100 µALGO but box needs 37,300 µALGO MBR).
 * The escrow now has 1.24M µALGO buffer — plenty to create the missing boxes.
 *
 * This script:
 *   1. Creates missing boxes in IssuanceLiquidityEscrow for BAL, AGOLD, XSIL
 *   2. For BAL (already ACTIVE): also calls releaseToVault → USDC escrow → vault
 *   3. Updates DB issuanceEscrowStatus and issuanceEscrowReleaseTxId for BAL
 *
 * Usage:
 *   npx ts-node --esm scripts/fix-escrow-boxes.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import algosdk from 'algosdk';
import { PrismaClient } from '../node_modules/.prisma/asset-client/index.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ADMIN_MNEMONIC         = process.env.ALGORAND_ADMIN_MNEMONIC ?? '';
const ALGOD_SERVER           = process.env.ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
const ALGOD_PORT             = Number(process.env.ALGORAND_ALGOD_PORT ?? 443);
const ALGOD_TOKEN            = process.env.ALGORAND_ALGOD_TOKEN ?? '';
const ISSUANCE_ESCROW_APP_ID = Number(process.env.ISSUANCE_ESCROW_APP_ID ?? '762550539');
const USDC_ASA_ID            = 10458941; // testnet USDC

// Selectors from compiled TEAL
const SEL_RECORD  = Buffer.from('013be981', 'hex'); // recordIssuanceLock(byte[],address,uint64)void
const SEL_RELEASE = Buffer.from('f27e2c8c', 'hex'); // releaseToVault(byte[],address)void

function encodeAssetId(assetId: string): Buffer {
  const raw = Buffer.from(assetId);
  const len = Buffer.allocUnsafe(2);
  len.writeUInt16BE(raw.length, 0);
  return Buffer.concat([len, raw]);
}

async function recordLock(
  algod: algosdk.Algodv2,
  admin: algosdk.Account,
  assetId: string,
  issuerAddress: string,
  amount: bigint,
): Promise<string> {
  const escrowAddress = algosdk.getApplicationAddress(ISSUANCE_ESCROW_APP_ID).toString();
  const boxKey        = Buffer.concat([Buffer.from('il:'), Buffer.from(assetId)]);
  const sp            = await algod.getTransactionParams().do();

  // 40_000 µALGO covers box MBR (37,300) with buffer
  const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender:          admin.addr.toString(),
    receiver:        escrowAddress,
    amount:          40_000n,
    suggestedParams: sp,
  });

  const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender:       admin.addr.toString(),
    appIndex:     ISSUANCE_ESCROW_APP_ID,
    appArgs:      [SEL_RECORD, encodeAssetId(assetId), algosdk.decodeAddress(issuerAddress).publicKey, algosdk.encodeUint64(amount)],
    accounts:     [issuerAddress],
    boxes:        [{ appIndex: ISSUANCE_ESCROW_APP_ID, name: boxKey }],
    foreignAssets:[USDC_ASA_ID],
    suggestedParams: sp,
  });

  algosdk.assignGroupID([fundTxn, appCallTxn]);
  const signed = [fundTxn, appCallTxn].map((t) => t.signTxn(admin.sk));
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 4);
  return txid;
}

async function releaseToVault(
  algod: algosdk.Algodv2,
  admin: algosdk.Account,
  assetId: string,
  vaultAddress: string,
): Promise<string> {
  const boxKey = Buffer.concat([Buffer.from('il:'), Buffer.from(assetId)]);
  const sp     = await algod.getTransactionParams().do();

  const txn = algosdk.makeApplicationNoOpTxnFromObject({
    sender:       admin.addr.toString(),
    appIndex:     ISSUANCE_ESCROW_APP_ID,
    appArgs:      [SEL_RELEASE, encodeAssetId(assetId), algosdk.decodeAddress(vaultAddress).publicKey],
    accounts:     [vaultAddress],
    boxes:        [{ appIndex: ISSUANCE_ESCROW_APP_ID, name: boxKey }],
    foreignAssets:[USDC_ASA_ID],
    suggestedParams: { ...sp, flatFee: true, fee: 2000 },
  });

  const signed = txn.signTxn(admin.sk);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 4);
  return txid;
}

async function main() {
  if (!ADMIN_MNEMONIC) throw new Error('ALGORAND_ADMIN_MNEMONIC not set');

  const algod  = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
  const admin  = algosdk.mnemonicToSecretKey(ADMIN_MNEMONIC);
  const prisma = new PrismaClient();

  const targets = [
    { ticker: 'BAL',   releaseAfter: true  },
    { ticker: 'AGOLD', releaseAfter: false },
    { ticker: 'XSIL',  releaseAfter: false },
  ];

  for (const { ticker, releaseAfter } of targets) {
    console.log(`\n── ${ticker} ──────────────────────────────`);
    const asset = await (prisma as any).asset.findFirst({ where: { ticker } });
    if (!asset) { console.log('  Not found in DB'); continue; }

    const assetId       = asset.id as string;
    const issuerWallet  = asset.issuerWalletAddress as string;
    const amount        = BigInt(asset.liquidityDepositUsdc ?? 0);
    const vaultContractId = asset.vaultContractId as number | null;
    const escrowStatus  = asset.issuanceEscrowStatus as string;

    if (!issuerWallet) { console.log('  No issuerWalletAddress — skipping'); continue; }
    if (amount === 0n) { console.log('  liquidityDepositUsdc is 0 — skipping'); continue; }
    if (escrowStatus === 'RELEASED_TO_VAULT') { console.log('  Already released — skipping'); continue; }

    // Step 1: Record the lock (create box)
    console.log(`  Recording issuance lock: assetId=${assetId} issuer=${issuerWallet.slice(0,12)}… amount=${amount}`);
    try {
      const lockTxId = await recordLock(algod, admin, assetId, issuerWallet, amount);
      await (prisma as any).asset.update({ where: { id: assetId }, data: { issuanceEscrowTxId: lockTxId } });
      console.log(`  Box created: txId=${lockTxId}`);
    } catch (err: any) {
      if (err.message?.includes('already recorded') || err.message?.includes('exists')) {
        console.log('  Box already exists — continuing to release step');
      } else {
        console.error(`  recordLock failed: ${err.message}`);
        continue;
      }
    }

    // Step 2: Release to vault (only for BAL which is already ACTIVE, or if explicitly requested)
    if (!releaseAfter) {
      console.log('  Box created. Admin must click "Activate Market" to release USDC → vault.');
      continue;
    }

    if (!vaultContractId) { console.log('  No vaultContractId — cannot release'); continue; }
    const vaultAddress = algosdk.getApplicationAddress(vaultContractId).toString();

    console.log(`  Releasing USDC escrow → vault ${vaultAddress.slice(0,12)}…`);
    try {
      const releaseTxId = await releaseToVault(algod, admin, assetId, vaultAddress);
      await (prisma as any).asset.update({
        where: { id: assetId },
        data: { issuanceEscrowStatus: 'RELEASED_TO_VAULT', issuanceEscrowReleaseTxId: releaseTxId },
      });
      console.log(`  USDC released: txId=${releaseTxId}`);
    } catch (err: any) {
      console.error(`  releaseToVault failed: ${err.message}`);
    }
  }

  await prisma.$disconnect();
  console.log('\nDone.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
