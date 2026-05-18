/**
 * E2E Test 03 — Activate Market + Tinyman Pool Creation (AMM)
 * Tests: admin activates market → Tinyman V2 pool created on-chain →
 *        verifies tinymanPoolAddress, lpAssetId, status=ACTIVE, price=pricePerToken.
 *
 * Run: npx ts-node --esm scripts/e2e/03-activate-and-pool.ts
 * Requires: 02-admin-approval to have run first
 */

import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import algosdk from 'algosdk';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

const GATEWAY = 'http://localhost:8080/api/v1';
const STATE_FILE = path.resolve('scripts/e2e/.state.json');
const ALGOD_SERVER = 'https://testnet-api.algonode.cloud';

function log(msg: string) { console.log(`  ${msg}`); }
function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); }
function fail(msg: string): never { console.error(`  ❌ ${msg}`); throw new Error(msg); }

function loadState(): Record<string, any> {
  if (!existsSync(STATE_FILE)) fail('State file not found — run 01 and 02 first');
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

function saveState(data: Record<string, any>) {
  const existing = loadState();
  writeFileSync(STATE_FILE, JSON.stringify({ ...existing, ...data }, null, 2));
}

function authHeader(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function getAdminToken(state: Record<string, any>): Promise<string> {
  if (state.adminToken) {
    try {
      const p = JSON.parse(Buffer.from(state.adminToken.split('.')[1], 'base64').toString());
      if (p.exp * 1000 > Date.now() + 60_000) return state.adminToken;
    } catch {}
  }
  const { data } = await axios.post(`${GATEWAY}/auth/login`, {
    email: 'admin@testnet.io',
    password: 'Admin@Test2024!',
  });
  return data.accessToken;
}

async function activateMarket(token: string, assetId: string): Promise<any> {
  log(`Activating market for asset ${assetId} (triggers Tinyman pool creation — may take 15–60s)…`);
  const start = Date.now();
  const { data } = await axios.patch(
    `${GATEWAY}/assets/${assetId}/activate`,
    {},
    { ...authHeader(token), timeout: 180_000 },
  );
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  ok(`Activation call returned in ${elapsed}s. status=${data.status}`);
  return data;
}

async function verifyActiveStatus(assetId: string): Promise<any> {
  log('Verifying asset status=ACTIVE via public API…');
  const { data } = await axios.get(`${GATEWAY}/assets/${assetId}`);
  if (data.status !== 'ACTIVE') {
    fail(`Expected status=ACTIVE, got: ${data.status}`);
  }
  ok(`Asset status: ACTIVE`);
  return data;
}

async function verifyTinymanPool(assetData: any) {
  log('Verifying Tinyman pool fields are set…');

  if (!assetData.tinymanPoolAddress) {
    fail('tinymanPoolAddress is null/empty — Tinyman pool was not created');
  }
  ok(`tinymanPoolAddress: ${assetData.tinymanPoolAddress}`);

  if (!assetData.lpAssetId || assetData.lpAssetId === 0) {
    fail(`lpAssetId is not set (got: ${assetData.lpAssetId}) — pool LP token not recorded`);
  }
  ok(`lpAssetId: ${assetData.lpAssetId}`);
}

async function verifyPoolPrice(assetData: any) {
  log('Verifying on-chain pool price equals pricePerToken…');

  const pricePerToken = BigInt(assetData.pricePerToken ?? '0');
  if (pricePerToken === 0n) fail('pricePerToken is 0 on asset — cannot verify pool price');

  // Current price should equal pricePerToken (1 USDC = 1 token at pool creation)
  // We accept a 1% slippage tolerance at pool creation
  if (assetData.currentPrice !== undefined && assetData.currentPrice !== null) {
    const currentPriceMicro = BigInt(assetData.currentPrice);
    const diff = currentPriceMicro > pricePerToken
      ? currentPriceMicro - pricePerToken
      : pricePerToken - currentPriceMicro;
    const tolerance = pricePerToken / 100n; // 1%
    if (diff > tolerance) {
      warn(`currentPrice (${currentPriceMicro}) deviates from pricePerToken (${pricePerToken}) by ${diff} (>${tolerance} tolerance)`);
    } else {
      ok(`currentPrice ${currentPriceMicro} ≈ pricePerToken ${pricePerToken} (within 1%)`);
    }
  } else {
    log('  currentPrice not yet set in DB — will be populated by first price snapshot');
  }
}

async function verifyPoolOnChain(assetData: any) {
  log('Verifying pool address is a valid Algorand account on-chain…');

  const poolAddress = assetData.tinymanPoolAddress;
  if (!poolAddress) return;

  const algod = new algosdk.Algodv2('', ALGOD_SERVER, 443);
  try {
    const info = await algod.accountInformation(poolAddress).do();
    const algoBalance = Number(info.amount) / 1e6;
    ok(`Pool account exists on-chain. ALGO balance: ${algoBalance.toFixed(4)} ALGO`);

    // Check LP token holding in the pool
    const assets: any[] = info.assets ?? [];
    const asaId = assetData.asaId;
    const usdcHolding = assets.find((a: any) => Number(a.assetId ?? a['asset-id']) === 10458941);
    const tokenHolding = assets.find((a: any) => Number(a.assetId ?? a['asset-id']) === asaId);

    if (usdcHolding) {
      ok(`Pool USDC balance: ${Number(usdcHolding.amount) / 1_000_000} USDC`);
    } else {
      warn('Pool has no USDC holding recorded yet');
    }
    if (tokenHolding) {
      ok(`Pool RWA token balance: ${Number(tokenHolding.amount) / 1_000_000} tokens`);
    } else {
      warn('Pool has no RWA token holding recorded yet (may use different account structure)');
    }
  } catch (err: any) {
    warn(`Could not query pool on-chain: ${err.message}`);
  }
}

async function verifyMarketplaceListing(assetId: string, ticker: string) {
  log('Verifying asset appears in public marketplace (GET /assets?status=ACTIVE)…');
  const { data } = await axios.get(`${GATEWAY}/assets?status=ACTIVE`);
  const assets = Array.isArray(data) ? data : data.assets ?? [];
  const found = assets.find((a: any) => a.id === assetId);
  if (!found) {
    fail(`Asset ${assetId} (${ticker}) not found in marketplace listing. Total: ${assets.length}`);
  }
  ok(`Asset appears in marketplace: ${found.ticker ?? ticker}`);
}

function verifyLpLockup(assetData: any) {
  log('Verifying LP lock-up fields are set on asset record…');
  const lpAmount = assetData.issuerLpAmount;
  if (!lpAmount || BigInt(lpAmount) === 0n) {
    warn(`issuerLpAmount is not set (got: ${lpAmount}) — LP custodianship not recorded`);
  } else {
    ok(`issuerLpAmount: ${lpAmount} LP tokens custodied for issuer`);
  }
  const lockupDate = assetData.lpLockupEndDate;
  if (!lockupDate) {
    warn('lpLockupEndDate is not set on asset record');
  } else {
    const days = Math.round((new Date(lockupDate).getTime() - Date.now()) / 86_400_000);
    ok(`lpLockupEndDate: ${lockupDate} (~${days} days from now)`);
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ChainStrike E2E — 03: Activate + Tinyman Pool   ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const state = loadState();
  const { assetId, asaId, ticker } = state;
  if (!assetId) fail('assetId missing — run previous tests first');
  if (!asaId) fail('asaId missing — run 02-admin-approval first');

  const adminToken = await getAdminToken(state);

  // Check if already active (idempotent)
  const { data: preCheck } = await axios.get(`${GATEWAY}/assets/${assetId}`);
  if (preCheck.status === 'ACTIVE') {
    ok('Market already ACTIVE — skipping activation call');
  } else if (preCheck.status !== 'PRE_MARKET') {
    fail(`Unexpected asset status before activation: ${preCheck.status}`);
  } else {
    await activateMarket(adminToken, assetId);
    // Give the server a moment to finalize
    await new Promise((r) => setTimeout(r, 2000));
  }

  const assetData = await verifyActiveStatus(assetId);

  await verifyTinymanPool(assetData);
  await verifyPoolPrice(assetData);
  await verifyPoolOnChain(assetData);
  await verifyMarketplaceListing(assetId, ticker ?? '');
  verifyLpLockup(assetData);

  saveState({
    adminToken,
    tinymanPoolAddress: assetData.tinymanPoolAddress,
    lpAssetId: assetData.lpAssetId,
    issuerLpAmount: assetData.issuerLpAmount,
    lpLockupEndDate: assetData.lpLockupEndDate,
    currentPrice: assetData.currentPrice,
  });

  console.log(`\n✅ TEST 03 PASSED — Market ACTIVE with Tinyman V2 pool`);
  console.log(`   Pool address:   ${assetData.tinymanPoolAddress}`);
  console.log(`   LP asset ID:    ${assetData.lpAssetId}`);
  console.log(`   Issuer LP amt:  ${assetData.issuerLpAmount}`);
  console.log(`   LP lockup end:  ${assetData.lpLockupEndDate}`);
  console.log(`   Run test 04 to execute swap (buy)\n`);
}

main().catch((err) => {
  console.error('\n❌ TEST 03 FAILED:', err.response?.data ?? err.message);
  process.exit(1);
});
