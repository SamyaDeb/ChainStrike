/**
 * E2E Test 02 — Admin Approval Flow (AMM)
 * Tests: admin reviews all 5 verification stages → approves → deploys ASA on-chain.
 * Verifies: poolTokenAmount set, asaId set, status=PRE_MARKET.
 *
 * Run: npx ts-node --esm scripts/e2e/02-admin-approval.ts
 * Requires: 01-issuer-flow to have run first (reads .state.json)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

const GATEWAY = 'http://localhost:8080/api/v1';
const STATE_FILE = path.resolve('scripts/e2e/.state.json');

function log(msg: string) { console.log(`  ${msg}`); }
function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string): never { console.error(`  ❌ ${msg}`); throw new Error(msg); }

function loadState(): Record<string, any> {
  if (!existsSync(STATE_FILE)) fail('State file not found — run 01-issuer-flow.ts first');
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

function saveState(data: Record<string, any>) {
  const existing = loadState();
  writeFileSync(STATE_FILE, JSON.stringify({ ...existing, ...data }, null, 2));
}

function authHeader(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function ensureAdminToken(state: Record<string, any>): Promise<string> {
  if (state.adminToken) {
    try {
      const payload = JSON.parse(Buffer.from(state.adminToken.split('.')[1], 'base64').toString());
      if (payload.exp * 1000 > Date.now() + 60_000) {
        ok('Reusing stored admin token');
        return state.adminToken;
      }
    } catch {}
  }
  log('Re-logging in as admin…');
  const { data } = await axios.post(`${GATEWAY}/auth/login`, {
    email: 'admin@testnet.io',
    password: 'Admin@Test2024!',
  });
  ok('Admin re-authenticated');
  return data.accessToken;
}

async function submitVerificationStages(token: string, assetId: string) {
  log('Submitting all 5 verification stages as APPROVED…');

  const stageNames = [
    'Document Completeness',
    'Custodian Verification',
    'Legal Opinion Review',
    'Risk Committee Sign-off',
    'Final Compliance',
  ];

  for (let stage = 1; stage <= 5; stage++) {
    const { data } = await axios.post(
      `${GATEWAY}/assets/${assetId}/verification-stage`,
      {
        stage,
        status: 'APPROVED',
        notes: `[E2E AUTO] Stage ${stage}: ${stageNames[stage - 1]} approved by automated test`,
      },
      authHeader(token),
    );
    ok(`Stage ${stage} (${stageNames[stage - 1]}): ${data.status}`);
  }
}

async function checkVerificationStatus(token: string, assetId: string) {
  log('Checking asset verification status after all stages…');
  const { data } = await axios.get(`${GATEWAY}/assets/${assetId}`);
  if (data.verificationStatus !== 'APPROVED') {
    fail(`Expected verificationStatus=APPROVED, got: ${data.verificationStatus}`);
  }
  ok(`Verification status: APPROVED`);
  return data;
}

async function deployAsa(token: string, assetId: string): Promise<number> {
  log('Deploying ASA to Algorand testnet (this takes 5–15 seconds)…');

  const start = Date.now();
  const { data } = await axios.patch(
    `${GATEWAY}/assets/${assetId}/deploy-asa`,
    {},
    { ...authHeader(token), timeout: 60_000 },
  );

  if (!data.asaId || data.asaId === 0) {
    fail(`ASA deployment failed or returned asaId=0: ${JSON.stringify(data)}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  ok(`ASA deployed: asaId=${data.asaId} in ${elapsed}s`);
  ok(`View on Algoexplorer: https://testnet.algoexplorer.io/asset/${data.asaId}`);

  return data.asaId;
}

async function verifyAssetIsPreMarket(assetId: string, asaId: number): Promise<any> {
  log('Verifying asset transitioned to PRE_MARKET with asaId and poolTokenAmount set…');
  const { data } = await axios.get(`${GATEWAY}/assets/${assetId}`);

  if (data.status !== 'PRE_MARKET') {
    fail(`Expected status=PRE_MARKET, got: ${data.status}`);
  }
  ok(`Asset status: PRE_MARKET`);

  if (data.asaId !== asaId) {
    fail(`asaId mismatch: expected ${asaId}, got ${data.asaId}`);
  }
  ok(`asaId confirmed: ${data.asaId}`);

  // Verify poolTokenAmount is derived and set by the server
  if (!data.poolTokenAmount || data.poolTokenAmount === '0' || data.poolTokenAmount === 0) {
    fail(`poolTokenAmount not set or is 0 — server should derive this from liquidityDepositUsdc / pricePerToken`);
  }
  ok(`poolTokenAmount: ${data.poolTokenAmount} base units (${Number(data.poolTokenAmount) / 1_000_000} tokens)`);

  // Verify on-chain ASA flags
  if (data.onChain) {
    ok(`On-chain data: creator=${String(data.onChain.creator ?? '').slice(0, 16)}… defaultFrozen=${data.onChain.defaultFrozen}`);
    if (!data.onChain.defaultFrozen) {
      fail('CRITICAL: ASA defaultFrozen must be true for RWA compliance!');
    }
    ok('ASA defaultFrozen=true — compliance OK');
  }

  return data;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ChainStrike E2E — 02: Admin Approval + ASA      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const state = loadState();
  const { assetId } = state;
  if (!assetId) fail('assetId missing in state — run 01 first');

  const adminToken = await ensureAdminToken(state);

  await submitVerificationStages(adminToken, assetId);
  await checkVerificationStatus(adminToken, assetId);
  const asaId = await deployAsa(adminToken, assetId);
  const assetData = await verifyAssetIsPreMarket(assetId, asaId);

  saveState({
    adminToken,
    asaId,
    poolTokenAmount: assetData.poolTokenAmount?.toString(),
  });

  console.log(`\n✅ TEST 02 PASSED — ASA deployed: asaId=${asaId}`);
  console.log(`   Algoexplorer: https://testnet.algoexplorer.io/asset/${asaId}`);
  console.log(`   poolTokenAmount: ${assetData.poolTokenAmount}`);
  console.log(`   Asset is PRE_MARKET — run test 03 to activate market and create Tinyman pool\n`);
}

main().catch((err) => {
  console.error('\n❌ TEST 02 FAILED:', err.response?.data ?? err.message);
  process.exit(1);
});
