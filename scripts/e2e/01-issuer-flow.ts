/**
 * E2E Test 01 — Issuer Flow
 * Tests: issuer login → create asset application (no wallet needed, dev mode)
 *
 * Run: npx ts-node --esm scripts/e2e/01-issuer-flow.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import algosdk from 'algosdk';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

const GATEWAY = 'http://localhost:8080/api/v1';
const STATE_FILE = path.resolve('scripts/e2e/.state.json');

function log(msg: string) { console.log(`  ${msg}`); }
function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.error(`  ❌ ${msg}`); throw new Error(msg); }

function loadState(): Record<string, any> {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  }
  return {};
}

function saveState(data: Record<string, any>) {
  const existing = loadState();
  writeFileSync(STATE_FILE, JSON.stringify({ ...existing, ...data }, null, 2));
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

  const usdcAsaId = 10458941; // Algorand testnet USDC
  const amountMicroUsdc = BigInt(10_000_000); // 10 USDC for e2e test

  // Verify admin has enough USDC
  let adminUsdc = 0n;
  try {
    const info = await algod.accountAssetInformation(account.addr, usdcAsaId).do();
    const holding = info.assetHolding ?? (info as any)['asset-holding'];
    adminUsdc = BigInt(holding?.amount ?? 0);
  } catch {
    fail(`Admin wallet not opted into USDC (ASA ${usdcAsaId}). Run deploy-contracts.ts first.`);
  }

  if (adminUsdc < amountMicroUsdc) {
    fail(`Admin USDC balance (${adminUsdc} micro) too low for test deposit (${amountMicroUsdc} micro). Fund via https://faucet.circle.com/algorand`);
  }

  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: account.addr.toString(),
    receiver: issuanceEscrowAddress,
    assetIndex: usdcAsaId,
    amount: amountMicroUsdc,
    note: new TextEncoder().encode('ChainStrike E2E — issuance escrow deposit'),
    suggestedParams: sp,
  });

  const signed = txn.signTxn(account.sk);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 4);

  ok(`USDC sent to escrow: txId=${txid} amount=${Number(amountMicroUsdc) / 1_000_000} USDC`);
  ok(`Escrow address: ${issuanceEscrowAddress}`);
  ok(`View: https://testnet.algoexplorer.io/tx/${txid}`);

  return { txId: txid, issuerAddress: account.addr.toString(), amountMicroUsdc };
}

async function createAsset(token: string, liquidityTxId: string, issuerWalletAddress: string, amountMicroUsdc: bigint): Promise<string> {
  log('Creating new RWA asset application (XSLV)…');

  const ticker = `XSLV${Date.now().toString().slice(-4)}`;

  const payload = {
    name: 'Silver Vault Token',
    ticker,
    category: 'PRECIOUS_METALS',
    description: 'Tokenized silver vault backed by 999.9 fine silver bars in Singapore.',
    totalSupply: '500000000000',    // 500,000 tokens with 6 decimals
    decimals: 6,
    pricePerToken: '25000000',      // 25 USDC (in micro-USDC = 6 decimals)
    minimumInvestment: '25000000',  // 25 USDC
    lockupDays: 0,
    minimumKycTier: 1,
    tokenizationRatio: '1 XSLV = 1 troy oz of 999.9 fine silver',
    custodianName: 'Singapore Silver Vault Pte Ltd',
    custodianJurisdiction: 'SG',
    spvEntityName: 'XSLV SPV Ltd',
    // Real on-chain liquidity deposit to IssuanceLiquidityEscrow contract
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
  return data.id;
}

async function checkIssuerAssets(token: string, assetId: string) {
  log('Verifying asset appears in issuer asset list…');
  const { data } = await axios.get(`${GATEWAY}/assets/my`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const found = data.find((a: any) => a.id === assetId);
  if (!found) fail(`Asset ${assetId} not in issuer asset list`);
  ok(`Asset listed for issuer. verificationStatus=${found.verificationStatus}, status=${found.status}`);
}

async function checkPublicAssetDetail(assetId: string) {
  log('Verifying asset is accessible via public API…');
  const { data } = await axios.get(`${GATEWAY}/assets/${assetId}`);
  if (!data.id) fail('Asset detail not returned');
  ok(`Public asset detail OK. name=${data.name}, ticker=${data.ticker}`);
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ChainStrike E2E — 01: Issuer Flow               ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const issuerToken = await loginIssuer();
  const adminToken = await loginAdmin();

  // Send real USDC on-chain to the issuance escrow contract (Algorand testnet)
  const { txId: liquidityTxId, issuerAddress, amountMicroUsdc } = await sendUsdcToEscrow();

  const assetId = await createAsset(issuerToken, liquidityTxId, issuerAddress, amountMicroUsdc);

  await checkIssuerAssets(issuerToken, assetId);
  await checkPublicAssetDetail(assetId);

  // Verify escrow status was recorded
  const fresh = await axios.get(`${GATEWAY}/assets/${assetId}`);
  if (!fresh.data.issuanceEscrowStatus) {
    fail('issuanceEscrowStatus not set on asset after creation');
  }
  ok(`Escrow status: ${fresh.data.issuanceEscrowStatus} (amount: ${Number(fresh.data.issuanceEscrowAmount ?? 0) / 1_000_000} USDC)`);

  // Persist state for next test
  saveState({
    issuerToken,
    adminToken,
    assetId,
    ticker: fresh.data.ticker,
    issuerAddress,
    liquidityTxId,
    amountMicroUsdc: amountMicroUsdc.toString(),
    timestamp: new Date().toISOString(),
  });

  console.log(`\n✅ TEST 01 PASSED — Asset ID: ${assetId}`);
  console.log(`   State saved to ${STATE_FILE}\n`);
}

main().catch((err) => {
  console.error('\n❌ TEST 01 FAILED:', err.response?.data ?? err.message);
  process.exit(1);
});
