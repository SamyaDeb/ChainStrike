/**
 * fix-activate-market.ts
 *
 * Standalone script that directly executes the full token distribution flow
 * on-chain for every asset stuck in PRE_MARKET (or ACTIVE but 0 tokens distributed).
 *
 * Does NOT require any NestJS services to be running.
 * Reads from the asset SQLite DB and writes on-chain + back to DB.
 *
 * Usage:
 *   npx ts-node --esm scripts/fix-activate-market.ts
 *
 * Options:
 *   --dry-run    Print what would happen without sending transactions
 *   --asset <id> Process only the given asset ID
 */

import * as dotenv from 'dotenv';
dotenv.config();

import algosdk from 'algosdk';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────

const ALGOD_SERVER  = process.env.ALGORAND_ALGOD_SERVER  ?? 'https://testnet-api.algonode.cloud';
const ALGOD_PORT    = parseInt(process.env.ALGORAND_ALGOD_PORT ?? '443', 10);
const ALGOD_TOKEN   = process.env.ALGORAND_ALGOD_TOKEN   ?? '';
const ADMIN_MNEMONIC = process.env.ALGORAND_ADMIN_MNEMONIC!;
const USDC_ASA_ID   = parseInt(process.env.USDC_ASSET_ID ?? '10458941', 10);
const ESCROW_APP_ID = parseInt(process.env.ISSUANCE_ESCROW_APP_ID ?? '0', 10);

const DRY_RUN   = process.argv.includes('--dry-run');
const ASSET_FILTER = (() => { const i = process.argv.indexOf('--asset'); return i !== -1 ? process.argv[i + 1] : null; })();

if (!ADMIN_MNEMONIC) { console.error('❌ ALGORAND_ADMIN_MNEMONIC not set in .env'); process.exit(1); }
if (!ESCROW_APP_ID)  { console.error('❌ ISSUANCE_ESCROW_APP_ID not set in .env'); process.exit(1); }

// ─── Clients ──────────────────────────────────────────────────────────────────

const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
const adminAccount = algosdk.mnemonicToSecretKey(ADMIN_MNEMONIC);
const ADMIN_ADDR = adminAccount.addr.toString();

console.log(`\n🔑 Admin wallet: ${ADMIN_ADDR}`);
if (DRY_RUN) console.log('🔍 DRY RUN mode — no transactions will be sent\n');

// ─── Prisma (asset service DB) ────────────────────────────────────────────────

// @ts-ignore — generated client
const { PrismaClient } = await import('/Users/samya/Downloads/csv2/node_modules/.prisma/asset-client/index.js');
const prisma = new PrismaClient({
  datasources: { db: { url: `file:${path.resolve('/Users/samya/Downloads/csv2/services/asset/prisma/dev.db')}` } },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(msg: string)   { console.log(`  ✅ ${msg}`); }
function info(msg: string) { console.log(`  ℹ️  ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); }
function err(msg: string)  { console.log(`  ❌ ${msg}`); }

// Use fetch() directly — algosdk v3 has a BigInt JSON serialization bug
async function fetchAccountAsset(address: string, asaId: number): Promise<{ optedIn: boolean; balance: bigint }> {
  try {
    const r = await fetch(`${ALGOD_SERVER}/v2/accounts/${address}/assets/${asaId}`);
    if (!r.ok) return { optedIn: false, balance: 0n };
    const data = await r.json();
    const holding = data['asset-holding'] ?? data.assetHolding;
    if (!holding) return { optedIn: false, balance: 0n };
    return { optedIn: true, balance: BigInt(holding.amount ?? holding['amount'] ?? 0) };
  } catch {
    return { optedIn: false, balance: 0n };
  }
}

async function hasOptedIn(address: string, asaId: number): Promise<boolean> {
  return (await fetchAccountAsset(address, asaId)).optedIn;
}

async function getAssetBalance(address: string, asaId: number): Promise<bigint> {
  return (await fetchAccountAsset(address, asaId)).balance;
}

async function sendTxn(txn: algosdk.Transaction, signer = adminAccount): Promise<string> {
  if (DRY_RUN) { info(`[DRY] Would send ${txn.type} txn`); return 'dry-run-txid'; }
  const signed = txn.signTxn(signer.sk);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 6);
  return txid;
}

async function sendGroup(txns: algosdk.Transaction[], signer = adminAccount): Promise<string> {
  if (DRY_RUN) { info(`[DRY] Would send group of ${txns.length} txns`); return 'dry-run-txid'; }
  algosdk.assignGroupID(txns);
  const signed = txns.map(t => t.signTxn(signer.sk));
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 6);
  return txid;
}

// ─── Step 1: Opt issuer into ASA ─────────────────────────────────────────────

async function optIssuerIntoAsa(issuerAddr: string, asaId: number): Promise<void> {
  const alreadyIn = await hasOptedIn(issuerAddr, asaId);
  if (alreadyIn) { ok(`Issuer already opted into ASA ${asaId}`); return; }

  if (issuerAddr !== ADMIN_ADDR) {
    // Issuer is an external Pera wallet — admin cannot sign the opt-in for them
    err(`Issuer ${issuerAddr.slice(0, 12)}… has NOT opted into ASA ${asaId}`);
    console.log(`\n  📱 ACTION REQUIRED — Ask the issuer to opt in via Pera Wallet:`);
    console.log(`     1. Open the Issuer Dashboard at http://localhost:3101`);
    console.log(`     2. Go to this asset's detail page`);
    console.log(`     3. Click "Opt In to [TOKEN]" button (connects Pera and signs the txn)`);
    console.log(`  Then re-run this script or click "Activate Market" in the admin dashboard.\n`);
    throw new Error(`Issuer must opt-in via their Pera Wallet before tokens can be distributed`);
  }

  // Admin = issuer (testnet dev scenario where admin mnemonic is used for everything)
  info(`Issuer (= admin wallet) opting into ASA ${asaId}…`);
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: ADMIN_ADDR,
    receiver: ADMIN_ADDR,
    assetIndex: asaId,
    amount: 0,
    suggestedParams: sp,
  });
  const txid = await sendTxn(txn);
  ok(`Issuer opted into ASA ${asaId} (txId=${txid})`);
}

// ─── Step 2: Opt vault into USDC ─────────────────────────────────────────────

async function optVaultIntoUsdc(vaultAppId: number): Promise<void> {
  const vaultAddress = algosdk.getApplicationAddress(vaultAppId).toString();
  const alreadyIn = await hasOptedIn(vaultAddress, USDC_ASA_ID);
  if (alreadyIn) { ok(`Vault ${vaultAppId} already opted into USDC`); return; }

  info(`Opting vault ${vaultAppId} into USDC…`);
  const sp = await algod.getTransactionParams().do();

  // Fund vault for USDC opt-in storage (0.1 ALGO)
  const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: ADMIN_ADDR,
    receiver: vaultAddress,
    amount: 100_000n,
    suggestedParams: sp,
  });
  // App call: optIntoUsdc() inner transaction
  const optInAppCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: ADMIN_ADDR,
    appIndex: vaultAppId,
    appArgs: [Buffer.from('c5c73c4b', 'hex')],  // optIntoUsdc()void selector
    foreignAssets: [USDC_ASA_ID],
    suggestedParams: { ...sp, flatFee: true, fee: 2000 },
  });
  const txid = await sendGroup([fundTxn, optInAppCall]);
  ok(`Vault ${vaultAppId} opted into USDC (txId=${txid})`);
}

// ─── Step 3: Release issuance escrow USDC → vault ────────────────────────────

async function releaseEscrowToVault(assetId: string, vaultAppId: number): Promise<string> {
  const vaultAddress = algosdk.getApplicationAddress(vaultAppId).toString();
  info(`Releasing escrow for asset ${assetId} → vault ${vaultAddress}…`);

  const sp = await algod.getTransactionParams().do();
  const boxKey = Buffer.concat([Buffer.from('il:'), Buffer.from(assetId)]);
  const selector = Buffer.from('f27e2c8c', 'hex');
  const assetIdBytes = Buffer.from(assetId);
  const lenBuf = Buffer.allocUnsafe(2);
  lenBuf.writeUInt16BE(assetIdBytes.length, 0);
  const encodedAssetId = Buffer.concat([lenBuf, assetIdBytes]);

  const txn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: ADMIN_ADDR,
    appIndex: ESCROW_APP_ID,
    appArgs: [selector, encodedAssetId, algosdk.decodeAddress(vaultAddress).publicKey],
    accounts: [vaultAddress],
    boxes: [{ appIndex: ESCROW_APP_ID, name: boxKey }],
    foreignAssets: [USDC_ASA_ID],
    suggestedParams: { ...sp, flatFee: true, fee: 2000 },
  });

  const txid = await sendTxn(txn);
  ok(`Escrow released to vault (txId=${txid})`);
  return txid;
}

// ─── Step 4: Unfreeze issuer for the ASA ─────────────────────────────────────

async function unfreezeIssuer(issuerAddr: string, asaId: number): Promise<void> {
  info(`Unfreezing issuer ${issuerAddr} for ASA ${asaId}…`);
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetFreezeTxnWithSuggestedParamsFromObject({
    sender: ADMIN_ADDR,
    assetIndex: asaId,
    freezeTarget: issuerAddr,
    frozen: false,
    suggestedParams: sp,
  });
  const txid = await sendTxn(txn);
  ok(`Issuer unfrozen for ASA ${asaId} (txId=${txid})`);
}

// ─── Step 5: Vault distributes tokens to issuer ───────────────────────────────

async function vaultDistribute(vaultAppId: number, asaId: number, issuerAddr: string, amount: bigint): Promise<string> {
  info(`Distributing ${amount} tokens from vault ${vaultAppId} → ${issuerAddr}…`);
  const sp = await algod.getTransactionParams().do();
  const issuerPk = algosdk.decodeAddress(issuerAddr).publicKey;

  const txn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: ADMIN_ADDR,
    appIndex: vaultAppId,
    appArgs: [
      Buffer.from('af9aed85', 'hex'),  // distributeToIssuer(address,uint64)void
      issuerPk,
      algosdk.encodeUint64(amount),
    ],
    accounts: [issuerAddr],
    foreignAssets: [asaId],
    suggestedParams: { ...sp, flatFee: true, fee: 2000 },
  });

  const txid = await sendTxn(txn);
  ok(`Vault distributed ${amount} tokens to issuer (txId=${txid})`);
  return txid;
}

// ─── Main: process each asset ─────────────────────────────────────────────────

async function processAsset(asset: any): Promise<void> {
  const { id, ticker, asaId, vaultContractId, issuerWalletAddress, liquidityDepositUsdc, pricePerToken, issuanceEscrowStatus, status } = asset;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📦 ${ticker} (id=${id.slice(0, 8)}…)`);
  console.log(`   ASA=${asaId}  Vault=${vaultContractId}  Status=${status}`);
  console.log(`   Issuer: ${issuerWalletAddress}`);
  console.log(`   Liquidity: ${liquidityDepositUsdc} µUSDC  Price: ${pricePerToken} µUSDC/token`);
  console.log(`   EscrowStatus: ${issuanceEscrowStatus ?? 'null'}`);

  // ── Guard checks ────────────────────────────────────────────────────────────

  if (!asaId)            { err('No asaId — run Deploy ASA first'); return; }
  if (!vaultContractId)  { err('No vaultContractId — run Deploy ASA first'); return; }
  if (!issuerWalletAddress) { err('No issuerWalletAddress on asset record'); return; }

  const liqUsdc    = BigInt(liquidityDepositUsdc ?? 0);
  const pricePer   = BigInt(pricePerToken ?? 0);
  if (liqUsdc <= 0n)  { err('liquidityDepositUsdc is 0 — cannot compute allocation'); return; }
  if (pricePer <= 0n) { err('pricePerToken is 0 — cannot compute allocation'); return; }

  const assetDecimals = BigInt((asset as any).decimals ?? 6);
  const allocation = (liqUsdc / pricePer) * (10n ** assetDecimals);
  info(`Issuer allocation: (${liqUsdc} / ${pricePer}) * 10^${assetDecimals} = ${allocation} base units`);

  // ── Check current on-chain state ────────────────────────────────────────────

  const vaultAddr = algosdk.getApplicationAddress(vaultContractId).toString();
  const vaultBalance = await getAssetBalance(vaultAddr, asaId);
  const issuerBalance = await getAssetBalance(issuerWalletAddress, asaId);

  info(`Vault on-chain balance:  ${vaultBalance} tokens`);
  info(`Issuer on-chain balance: ${issuerBalance} tokens`);

  if (issuerBalance >= allocation) {
    ok(`Issuer already has ${issuerBalance} tokens (≥ ${allocation}) — distribution already done!`);
    // Just ensure DB is ACTIVE
    if (status !== 'ACTIVE' && !DRY_RUN) {
      await prisma.asset.update({ where: { id }, data: { status: 'ACTIVE', listedAt: new Date() } });
      ok('DB status updated to ACTIVE');
    }
    return;
  }

  // ── Execute distribution flow ───────────────────────────────────────────────

  // 1. Opt issuer into ASA (required to receive tokens)
  await optIssuerIntoAsa(issuerWalletAddress, asaId);

  // 2. Opt vault into USDC (required for escrow release)
  if (issuanceEscrowStatus === 'PENDING') {
    await optVaultIntoUsdc(vaultContractId);

    // 3. Release escrow USDC → vault
    const releaseTxId = await releaseEscrowToVault(id, vaultContractId);
    if (!DRY_RUN) {
      await prisma.asset.update({
        where: { id },
        data: { issuanceEscrowStatus: 'RELEASED_TO_VAULT', issuanceEscrowReleaseTxId: releaseTxId },
      });
    }
  } else {
    info(`Escrow already ${issuanceEscrowStatus ?? 'null'} — skipping release`);
  }

  // 4. Unfreeze issuer for the ASA (ASA is defaultFrozen=true)
  await unfreezeIssuer(issuerWalletAddress, asaId);

  // 5. Distribute tokens from vault → issuer
  if (vaultBalance < allocation) {
    err(`Vault only holds ${vaultBalance} tokens but allocation is ${allocation} — vault may not have enough supply`);
    err('Ensure the full token supply was transferred to vault during Deploy ASA');
    return;
  }

  await vaultDistribute(vaultContractId, asaId, issuerWalletAddress, allocation);

  // ── Verify on-chain ─────────────────────────────────────────────────────────

  if (!DRY_RUN) {
    const newBalance = await getAssetBalance(issuerWalletAddress, asaId);
    if (newBalance >= allocation) {
      ok(`✓ Verified: Issuer wallet now holds ${newBalance} ${ticker} tokens on-chain`);
    } else {
      err(`Issuer balance is ${newBalance} — expected ≥ ${allocation}. Something went wrong.`);
    }

    // ── Update DB to ACTIVE ─────────────────────────────────────────────────
    await prisma.asset.update({
      where: { id },
      data: { status: 'ACTIVE', listedAt: new Date() },
    });
    ok(`DB status → ACTIVE`);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  ChainStrike — Fix Activate Market (direct on-chain)   ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  // Find assets to process
  const where: any = ASSET_FILTER
    ? { id: ASSET_FILTER }
    : { status: { in: ['PRE_MARKET', 'ACTIVE'] } };

  const assets = await prisma.asset.findMany({ where, orderBy: { createdAt: 'asc' } });

  if (assets.length === 0) {
    console.log('\nNo assets found matching criteria.');
    await prisma.$disconnect();
    return;
  }

  console.log(`\nFound ${assets.length} asset(s) to process:`);
  assets.forEach((a: any) => console.log(`  • ${a.ticker} — ${a.status} — asaId=${a.asaId}`));

  let passed = 0;
  let failed = 0;

  for (const asset of assets) {
    try {
      await processAsset(asset);
      passed++;
    } catch (e: any) {
      err(`FAILED for ${asset.ticker}: ${e.message}`);
      console.error(e.stack?.split('\n').slice(0, 4).join('\n'));
      failed++;
    }
  }

  await prisma.$disconnect();

  console.log('\n' + '═'.repeat(60));
  console.log(`Results: ${passed} succeeded, ${failed} failed`);
  if (failed === 0) {
    console.log('\n✅ All assets processed. Check Pera Wallet — issuer should now hold tokens.');
    console.log('   Testnet explorer: https://testnet.algoexplorer.io');
  } else {
    console.log('\n⚠️  Some assets failed. Check the errors above.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\n❌ Fatal error:', e.message);
  console.error(e.stack?.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
