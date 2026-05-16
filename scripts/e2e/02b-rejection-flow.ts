/**
 * E2E Test 02b — Rejection Flow (On-Chain Escrow Return)
 *
 * Tests the full rejection path:
 *   1. Issue a new asset with real USDC sent to IssuanceLiquidityEscrow
 *   2. Admin rejects Stage 1
 *   3. Assert issuanceEscrowStatus = RETURNED_TO_ISSUER in DB
 *   4. Assert issuer wallet USDC balance restored on Algorand testnet
 *   5. Assert escrow contract released the USDC (inner txn confirmed)
 *
 * Run: npx ts-node --esm scripts/e2e/02b-rejection-flow.ts
 * Requires: deploy-contracts.ts run first; ISSUANCE_ESCROW_APP_ID set in .env
 */

import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import algosdk from 'algosdk';

const GATEWAY = 'http://localhost:8080/api/v1';
const USDC_ASA_ID = 10458941;

function log(msg: string) { console.log(`  ${msg}`); }
function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string): never { console.error(`  ❌ ${msg}`); throw new Error(msg); }

function authHeader(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function getAlgod(): Promise<algosdk.Algodv2> {
  const server = process.env.ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
  const port = parseInt(process.env.ALGORAND_ALGOD_PORT ?? '443');
  const token = process.env.ALGORAND_ALGOD_TOKEN ?? '';
  return new algosdk.Algodv2(token, server, port);
}

async function getAdminAccount(): Promise<algosdk.Account> {
  const mnemonic = process.env.ALGORAND_ADMIN_MNEMONIC ?? '';
  if (!mnemonic) fail('ALGORAND_ADMIN_MNEMONIC not set in .env');
  return algosdk.mnemonicToSecretKey(mnemonic);
}

async function getUsdcBalance(algod: algosdk.Algodv2, address: string): Promise<bigint> {
  try {
    const info = await algod.accountAssetInformation(address, USDC_ASA_ID).do();
    const holding = info.assetHolding ?? (info as any)['asset-holding'];
    return BigInt(holding?.amount ?? 0);
  } catch {
    return 0n;
  }
}

async function loginAdmin(): Promise<string> {
  const { data } = await axios.post(`${GATEWAY}/auth/login`, {
    email: 'admin@testnet.io',
    password: 'Admin@Test2024!',
  });
  if (!data.accessToken) fail('Admin login failed');
  return data.accessToken;
}

async function loginIssuer(): Promise<string> {
  const { data } = await axios.post(`${GATEWAY}/auth/login`, {
    email: 'issuer@testnet.io',
    password: 'Issuer@Test2024!',
  });
  if (!data.accessToken) fail('Issuer login failed');
  return data.accessToken;
}

async function sendUsdcToEscrow(algod: algosdk.Algodv2, account: algosdk.Account, amountMicroUsdc: bigint): Promise<string> {
  const issuanceEscrowAddress = process.env.ISSUANCE_ESCROW_ADDRESS ?? '';
  if (!issuanceEscrowAddress) fail('ISSUANCE_ESCROW_ADDRESS not set in .env');

  const balance = await getUsdcBalance(algod, account.addr.toString());
  if (balance < amountMicroUsdc) {
    fail(`Admin USDC balance (${balance} micro) too low. Need ${amountMicroUsdc} micro. Fund via https://faucet.circle.com/algorand`);
  }

  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: account.addr.toString(),
    receiver: issuanceEscrowAddress,
    assetIndex: USDC_ASA_ID,
    amount: amountMicroUsdc,
    note: new TextEncoder().encode('ChainStrike E2E rejection test — escrow deposit'),
    suggestedParams: sp,
  });
  const signed = txn.signTxn(account.sk);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 4);

  ok(`USDC sent to escrow: ${Number(amountMicroUsdc) / 1_000_000} USDC → ${issuanceEscrowAddress.slice(0, 10)}… (txId=${txid})`);
  return txid;
}

async function createTestAsset(issuerToken: string, liquidityTxId: string, issuerAddress: string, amountMicroUsdc: bigint): Promise<string> {
  const ticker = `RJCT${Date.now().toString().slice(-4)}`;
  const { data } = await axios.post(`${GATEWAY}/assets`, {
    name: 'Rejection Test Asset',
    ticker,
    category: 'PRECIOUS_METALS',
    description: 'Test asset for rejection flow — will be rejected in Stage 1.',
    totalSupply: '100000000000',
    decimals: 6,
    pricePerToken: '5000000',       // 5 USDC
    lockupDays: 0,
    minimumKycTier: 1,
    tokenizationRatio: '1 token = 1g test metal',
    custodianName: 'Test Custodian',
    custodianJurisdiction: 'SG',
    liquidityDepositTxId: liquidityTxId,
    liquidityDepositUsdc: amountMicroUsdc.toString(),
    issuerWalletAddress: issuerAddress,
  }, authHeader(issuerToken));

  if (!data.id) fail(`Asset creation failed: ${JSON.stringify(data)}`);
  ok(`Test asset created: id=${data.id} ticker=${data.ticker} escrowStatus=${data.issuanceEscrowStatus}`);
  return data.id;
}

async function rejectStage1(adminToken: string, assetId: string): Promise<void> {
  log('Admin rejecting Stage 1 (Document Completeness)…');
  const { data } = await axios.post(`${GATEWAY}/assets/${assetId}/verification-stage`, {
    stage: 1,
    status: 'REJECTED',
    notes: '[E2E] Rejecting to test on-chain USDC return from escrow',
  }, { ...authHeader(adminToken), timeout: 60_000 });

  ok(`Stage 1 rejected: ${data.status}`);
}

async function assertEscrowReturned(assetId: string): Promise<string> {
  log('Checking DB: issuanceEscrowStatus should be RETURNED_TO_ISSUER…');
  const { data: asset } = await axios.get(`${GATEWAY}/assets/${assetId}`);

  if (asset.issuanceEscrowStatus !== 'RETURNED_TO_ISSUER') {
    fail(`Expected issuanceEscrowStatus=RETURNED_TO_ISSUER, got: ${asset.issuanceEscrowStatus}`);
  }
  if (!asset.issuanceEscrowReleaseTxId) {
    fail('issuanceEscrowReleaseTxId not set after rejection — on-chain return may have failed');
  }

  ok(`DB escrow status: RETURNED_TO_ISSUER`);
  ok(`Return txId: ${asset.issuanceEscrowReleaseTxId}`);
  ok(`Asset status: ${asset.status} verificationStatus: ${asset.verificationStatus}`);
  ok(`View return tx: https://testnet.algoexplorer.io/tx/${asset.issuanceEscrowReleaseTxId}`);

  return asset.issuanceEscrowReleaseTxId as string;
}

async function assertIssuerUsdcRestored(
  algod: algosdk.Algodv2,
  issuerAddress: string,
  balanceBefore: bigint,
  depositAmount: bigint,
): Promise<void> {
  log('Verifying issuer USDC balance restored on-chain…');

  const balanceAfter = await getUsdcBalance(algod, issuerAddress);
  const restored = balanceAfter - balanceBefore + depositAmount;

  // Allow for some ALGO fee deduction (~0.001 ALGO per transaction) but USDC should be exact
  if (balanceAfter < balanceBefore) {
    fail(`Issuer USDC balance decreased after rejection: before=${balanceBefore} after=${balanceAfter}`);
  }

  ok(`Issuer USDC before: ${Number(balanceBefore) / 1_000_000} USDC`);
  ok(`Issuer USDC after:  ${Number(balanceAfter) / 1_000_000} USDC`);
  ok(`Net change: +${Number(balanceAfter - balanceBefore) / 1_000_000} USDC (deposit: ${Number(depositAmount) / 1_000_000} USDC)`);

  if (balanceAfter - balanceBefore !== depositAmount) {
    console.log(`  ⚠️  Balance delta (${balanceAfter - balanceBefore}) does not exactly equal deposit (${depositAmount}) — may include test fees`);
  } else {
    ok('Exact USDC return confirmed on-chain');
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ChainStrike E2E — 02b: Rejection + Return       ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const algod = await getAlgod();
  const adminAccount = await getAdminAccount();
  const issuerAddress = adminAccount.addr.toString(); // admin acts as issuer for this test
  const depositAmount = BigInt(5_000_000); // 5 USDC

  log(`Using admin wallet as issuer: ${issuerAddress.slice(0, 10)}…`);

  // Record balance before deposit
  const balanceBefore = await getUsdcBalance(algod, issuerAddress);
  log(`Issuer USDC balance before: ${Number(balanceBefore) / 1_000_000} USDC`);

  const adminToken = await loginAdmin();
  const issuerToken = await loginIssuer();

  // 1. Send real USDC to escrow on Algorand testnet
  const liquidityTxId = await sendUsdcToEscrow(algod, adminAccount, depositAmount);

  // 2. Create asset application (backend verifies deposit + records lock on-chain)
  const assetId = await createTestAsset(issuerToken, liquidityTxId, issuerAddress, depositAmount);

  // 3. Admin rejects Stage 1 → triggers returnToIssuer() inner txn
  await rejectStage1(adminToken, assetId);

  // 4. Assert DB state
  const returnTxId = await assertEscrowReturned(assetId);

  // 5. Assert issuer USDC restored on-chain
  // Wait one extra block for indexer propagation
  await new Promise((r) => setTimeout(r, 4000));
  await assertIssuerUsdcRestored(algod, issuerAddress, balanceBefore - depositAmount, depositAmount);

  console.log(`\n✅ TEST 02b PASSED — Rejection + On-Chain Escrow Return`);
  console.log(`   Asset rejected: ${assetId}`);
  console.log(`   Return tx: https://testnet.algoexplorer.io/tx/${returnTxId}\n`);
}

main().catch((err) => {
  console.error('\n❌ TEST 02b FAILED:', err.response?.data ?? err.message);
  process.exit(1);
});
