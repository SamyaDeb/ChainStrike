/**
 * E2E Test 04 — Activate Market
 * Tests: admin activates market → status becomes ACTIVE → asset visible in marketplace
 *
 * Run: npx ts-node --esm scripts/e2e/04-activate-market.ts
 * Requires: 03-distribute-and-seed to have run first
 */

import axios from 'axios';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

const GATEWAY = 'http://localhost:8080/api/v1';
const STATE_FILE = path.resolve('scripts/e2e/.state.json');

function log(msg: string) { console.log(`  ${msg}`); }
function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.error(`  ❌ ${msg}`); throw new Error(msg); }

function loadState(): Record<string, any> {
  if (!existsSync(STATE_FILE)) fail('State file not found — run previous tests first');
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

function saveState(data: Record<string, any>) {
  const existing = loadState();
  writeFileSync(STATE_FILE, JSON.stringify({ ...existing, ...data }, null, 2));
}

function authHeader(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function getAdminToken(): Promise<string> {
  const state = loadState();
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

async function activateMarket(token: string, assetId: string) {
  log(`Activating market for asset ${assetId}…`);
  const { data } = await axios.patch(
    `${GATEWAY}/assets/${assetId}/activate`,
    {},
    { ...authHeader(token), timeout: 180_000 },
  );
  if (data.status !== 'ACTIVE') {
    fail(`Expected status=ACTIVE, got: ${JSON.stringify(data)}`);
  }
  ok(`Market activated. status=${data.status}`);
}

async function verifyAssetIsActive(assetId: string) {
  log('Verifying asset status via public API…');
  const { data } = await axios.get(`${GATEWAY}/assets/${assetId}`);
  if (data.status !== 'ACTIVE') {
    fail(`Expected status=ACTIVE, got: ${data.status}`);
  }
  ok(`Public asset status: ACTIVE`);
  if (data.listedAt) {
    ok(`Listed at: ${data.listedAt}`);
  }
}

async function verifyMarketplaceListsAsset(assetId: string, ticker: string) {
  log('Verifying asset appears in public marketplace (GET /assets?status=ACTIVE)…');
  const { data } = await axios.get(`${GATEWAY}/assets?status=ACTIVE`);
  const assets = Array.isArray(data) ? data : data.assets ?? [];
  const found = assets.find((a: any) => a.id === assetId || a.ticker === ticker);
  if (!found) {
    // Could be the ticker suffix is different; try id match
    const byId = assets.find((a: any) => a.id === assetId);
    if (!byId) {
      fail(`Asset ${assetId} (${ticker}) not found in marketplace listing. Total assets: ${assets.length}`);
    }
  }
  ok(`Asset appears in marketplace: ${found?.ticker ?? ticker}`);
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ChainStrike E2E — 04: Activate Market           ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const state = loadState();
  const { assetId, ticker } = state;
  if (!assetId) fail('assetId missing — run previous tests first');

  const adminToken = await getAdminToken();

  // Check if already active (may have been activated in test 02 or externally)
  const { data: preCheck } = await axios.get(`${GATEWAY}/assets/${assetId}`);
  if (preCheck.status === 'ACTIVE') {
    ok(`Market already ACTIVE — skipping activation`);
  } else {
    await activateMarket(adminToken, assetId);
    await new Promise((r) => setTimeout(r, 1000));
  }

  await verifyAssetIsActive(assetId);
  await verifyMarketplaceListsAsset(assetId, ticker ?? '');

  saveState({ adminToken });

  console.log(`\n✅ TEST 04 PASSED — Market is LIVE and ACTIVE`);
  console.log(`   Investors can now trade ${ticker ?? assetId}\n`);
}

main().catch((err) => {
  console.error('\n❌ TEST 04 FAILED:', err.response?.data ?? err.message);
  process.exit(1);
});
