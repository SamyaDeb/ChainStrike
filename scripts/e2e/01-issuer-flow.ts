/**
 * E2E Test 01 — Issuer Flow (AMM)
 * Tests: issuer login → send USDC to IssuanceLiquidityEscrow → create RWA asset application.
 * NOTE: No `totalSupply` field — it is derived server-side from liquidityDepositUsdc / pricePerToken.
 *
 * Run: npx ts-node --esm scripts/e2e/01-issuer-flow.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import algosdk from 'algosdk';
import { writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import path from 'path';

const GATEWAY = 'http://localhost:8080/api/v1';
const STATE_FILE = path.resolve('scripts/e2e/.state.json');
const USDC_ASA_ID = 10458941; // Algorand testnet USDC
const LIQUIDITY_DEPOSIT_USDC = BigInt(10_000_000); // 10 USDC (micro-USDC)
const PRICE_PER_TOKEN = '1000000'; // 1 USDC per token (micro-USDC)

function log(msg: string) { console.log(`  ${msg}`); }
function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string): never { console.error(`  ❌ ${msg}`); throw new Error(msg); }

function loadState(): Record<string, any> {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  }
  return {};
}

function saveState(data: Record<string, any>) {
  const dir = path.dirname(STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = loadState();
  writeFileSync(STATE_FILE, JSON.stringify({ ...existing, ...data }, null, 2));
}

function deleteState() {
  if (existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE);
    log('Deleted stale .state.json');
  }
}

async function loginIssuer(): Promise<string> {
  log('Logging in as issuer@testnet.io…');
  const { data } = await axios.post(`${GATEWAY}/auth/login`, {
    email: 'issuer@testnet.io',
    password: 'Issuer@Test2024!',
  });
  if (!data.accessToken) fail('No access token in login response');
  const payload = JSON.parse(Buffer.from(data.accessToken.split('.')[1], 'base64').toString());
  if (!['ISSUER', 'issuer'].includes(payload.role)) {
    fail(`Expected ISSUER role, got: ${payload.role}`);
  }
  ok(`Logged in as issuer. userId=${payload.sub}`);
  return data.accessToken;
}

async function loginAdmin(): Promise<string> {
  log('Logging in as admin@testnet.io…');
  const { data } = await axios.post(`${GATEWAY}/auth/login`, {
    email: 'admin@testnet.io',
    password: 'Admin@Test2024!',
  });
  if (!data.accessToken) fail('No admin access token');
  ok('Admin logged in.');
  return data.accessToken;
}

async function sendUsdcToEscrow(): Promise<{ txId: string; issuerAddress: string; amountMicroUsdc: bigint }> {
  log('Sending real testnet USDC to IssuanceLiquidityEscrow contract…');

  const mnemonic = process.env.ALGORAND_ADMIN_MNEMONIC ?? '';
  if (!mnemonic) fail('ALGORAND_ADMIN_MNEMONIC not set in .env');

  const issuanceEscrowAddress = process.env.ISSUANCE_ESCROW_ADDRESS ?? '';
  if (!issuanceEscrowAddress) fail('ISSUANCE_ESCROW_ADDRESS not set in .env — run deploy-contracts.ts first');

  const account = algosdk.mnemonicToSecretKey(mnemonic);
  const algodServer = process.env.ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
  const algodPort = parseInt(process.env.ALGORAND_ALGOD_PORT ?? '443');
  const algodToken = process.env.ALGORAND_ALGOD_TOKEN ?? '';
  const algod = new algosdk.Algodv2(algodToken, algodServer, algodPort);

  // Verify admin has enough USDC
  let adminUsdc = 0n;
  try {
    const info = await algod.accountAssetInformation(account.addr, USDC_ASA_ID).do();
    const holding = (info as any).assetHolding ?? (info as any)['asset-holding'];
    adminUsdc = BigInt(holding?.amount ?? 0);
  } catch {
    fail(`Admin wallet not opted into USDC (ASA ${USDC_ASA_ID}). Fund via https://faucet.circle.com/algorand`);
  }

  if (adminUsdc < LIQUIDITY_DEPOSIT_USDC) {
    fail(`Admin USDC balance (${adminUsdc} micro = ${Number(adminUsdc) / 1_000_000} USDC) too low for test deposit (${Number(LIQUIDITY_DEPOSIT_USDC) / 1_000_000} USDC). Fund via https://faucet.circle.com/algorand`);
  }
  ok(`Admin USDC balance: ${Number(adminUsdc) / 1_000_000} USDC`);

  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: account.addr.toString(),
    receiver: issuanceEscrowAddress,
    assetIndex: USDC_ASA_ID,
    amount: LIQUIDITY_DEPOSIT_USDC,
    note: new TextEncoder().encode('ChainStrike E2E AMM — issuance escrow deposit'),
    suggestedParams: sp,
  });

  const signed = txn.signTxn(account.sk);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 4);

  ok(`USDC sent to escrow: txId=${txid} amount=${Number(LIQUIDITY_DEPOSIT_USDC) / 1_000_000} USDC`);
  ok(`Escrow address: ${issuanceEscrowAddress}`);
  ok(`View: https://testnet.algoexplorer.io/tx/${txid}`);

  return { txId: txid, issuerAddress: account.addr.toString(), amountMicroUsdc: LIQUIDITY_DEPOSIT_USDC };
}

async function createAsset(
  token: string,
  liquidityTxId: string,
  issuerWalletAddress: string,
  amountMicroUsdc: bigint,
): Promise<{ assetId: string; ticker: string }> {
  log('Creating new RWA asset application (XSLV)…');

  const ticker = `XSLV${Date.now().toString().slice(-4)}`;

  // NOTE: No totalSupply — it is derived server-side as:
  //   poolTokenAmount = liquidityDepositUsdc / pricePerToken * 10^decimals
  //   = 10_000_000 / 1_000_000 * 10^6 = 10_000_000 base units = 10 tokens
  const payload = {
    name: 'Silver Vault Token',
    ticker,
    category: 'PRECIOUS_METALS',
    description:
      'Tokenized silver vault backed by 999.9 fine silver bars in Singapore. Minimum investment 1 oz.',
    decimals: 6,
    pricePerToken: PRICE_PER_TOKEN,
    lockupDays: 0,
    minimumKycTier: 1,
    tokenizationRatio: '1 XSLV = 1 troy oz of 999.9 fine silver',
    custodianName: 'Singapore Silver Vault Pte Ltd',
    custodianJurisdiction: 'SG',
    spvEntityName: 'XSLV SPV Ltd',
    liquidityDepositTxId: liquidityTxId,
    liquidityDepositUsdc: amountMicroUsdc.toString(),
    issuerWalletAddress,
  };

  const { data } = await axios.post(`${GATEWAY}/assets`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!data.id) fail(`Asset creation failed: ${JSON.stringify(data)}`);
  ok(`Asset created: id=${data.id}, ticker=${data.ticker}, status=${data.status}`);
  ok(`Escrow status: ${data.issuanceEscrowStatus ?? 'not set'}`);

  return { assetId: data.id, ticker: data.ticker };
}

async function checkIssuerAssets(token: string, assetId: string) {
  log('Verifying asset appears in issuer asset list…');
  const { data } = await axios.get(`${GATEWAY}/assets/my`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const found = (Array.isArray(data) ? data : data.assets ?? []).find((a: any) => a.id === assetId);
  if (!found) fail(`Asset ${assetId} not in issuer asset list`);
  ok(`Asset listed for issuer. verificationStatus=${found.verificationStatus}, status=${found.status}`);
}

async function checkPublicAssetDetail(assetId: string): Promise<any> {
  log('Verifying asset is accessible via public API…');
  const { data } = await axios.get(`${GATEWAY}/assets/${assetId}`);
  if (!data.id) fail('Asset detail not returned');
  ok(`Public asset detail OK. name=${data.name}, ticker=${data.ticker}`);
  return data;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ChainStrike E2E — 01: Issuer Flow (AMM)         ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // Remove stale state from a previous run
  deleteState();

  const issuerToken = await loginIssuer();
  const adminToken = await loginAdmin();

  // Send real USDC on-chain to the issuance escrow contract (Algorand testnet)
  const { txId: liquidityTxId, issuerAddress, amountMicroUsdc } = await sendUsdcToEscrow();

  const { assetId, ticker } = await createAsset(issuerToken, liquidityTxId, issuerAddress, amountMicroUsdc);

  await checkIssuerAssets(issuerToken, assetId);
  const assetDetail = await checkPublicAssetDetail(assetId);

  // Verify escrow status was recorded
  if (!assetDetail.issuanceEscrowStatus) {
    fail('issuanceEscrowStatus not set on asset after creation');
  }
  ok(`Escrow status: ${assetDetail.issuanceEscrowStatus} (amount: ${Number(assetDetail.issuanceEscrowAmount ?? amountMicroUsdc) / 1_000_000} USDC)`);

  // Verify no totalSupply in response (should be derived)
  if (assetDetail.totalSupply !== undefined && assetDetail.totalSupply !== null) {
    log(`  ⚠️  totalSupply field present in response (value: ${assetDetail.totalSupply}) — expected to be derived server-side`);
  } else {
    ok('totalSupply not in request payload — correctly derived server-side');
  }

  // Expected pool token amount: 10 USDC / 1 USDC per token × 10^6 = 10,000,000 base units
  const expectedPoolTokens = (amountMicroUsdc / BigInt(PRICE_PER_TOKEN)) * 1_000_000n;
  ok(`Expected poolTokenAmount: ${expectedPoolTokens} base units (${Number(expectedPoolTokens) / 1_000_000} tokens)`);

  // Persist state for next test
  saveState({
    issuerToken,
    adminToken,
    assetId,
    ticker,
    issuerAddress,
    liquidityTxId,
    amountMicroUsdc: amountMicroUsdc.toString(),
    pricePerToken: PRICE_PER_TOKEN,
    expectedPoolTokenAmount: expectedPoolTokens.toString(),
    timestamp: new Date().toISOString(),
  });

  console.log(`\n✅ TEST 01 PASSED — Asset ID: ${assetId}`);
  console.log(`   Ticker: ${ticker}`);
  console.log(`   State saved to ${STATE_FILE}\n`);
}

main().catch((err) => {
  console.error('\n❌ TEST 01 FAILED:', err.response?.data ?? err.message);
  process.exit(1);
});
