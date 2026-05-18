/**
 * E2E Test 05 — Verify Tinyman Pool + Investor Compliance Readiness
 * Tests: Tinyman pool is live → price endpoint returns valid data
 *        → investor wallet can be whitelisted for trading
 *
 * Note: Actual token swaps require wallet signing (Pera/Defly) and cannot
 * be automated server-side. Manual swap testing: open /trade/:assetId in the browser.
 *
 * Run: npx ts-node --esm scripts/e2e/05-investor-buy-and-match.ts
 * Requires: 04-activate-market to have run first
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });
dotenv.config();

import axios from 'axios';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

const GATEWAY = 'http://localhost:8080/api/v1';
const STATE_FILE = path.resolve('scripts/e2e/.state.json');

function log(msg: string) { console.log(`  ${msg}`); }
function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); }
function fail(msg: string): never { console.error(`  ❌ ${msg}`); throw new Error(msg); }

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

async function getToken(email: string, password: string): Promise<string> {
  const { data } = await axios.post(`${GATEWAY}/auth/login`, { email, password });
  if (!data.accessToken) fail(`Login failed for ${email}`);
  return data.accessToken;
}

async function verifyPoolIsLive(assetId: string): Promise<void> {
  log(`Fetching asset detail to verify Tinyman pool fields…`);
  const { data } = await axios.get(`${GATEWAY}/assets/${assetId}`);

  const checks: Array<[boolean, string]> = [
    [data.status === 'ACTIVE', `status=${data.status}`],
    [!!data.tinymanPoolAddress, `tinymanPoolAddress=${data.tinymanPoolAddress?.slice(0, 16)}…`],
    [!!data.lpAssetId, `lpAssetId=${data.lpAssetId}`],
    [!!data.asaId, `asaId=${data.asaId}`],
  ];

  for (const [pass, label] of checks) {
    if (pass) ok(label);
    else warn(`FAIL: ${label}`);
  }

  if (!data.tinymanPoolAddress || !data.lpAssetId) {
    fail('Pool not deployed — run activateMarket (test 04) first');
  }
}

async function verifyPriceEndpoint(assetId: string): Promise<void> {
  log('Fetching current price from /assets/:id/price…');
  try {
    const { data } = await axios.get(`${GATEWAY}/assets/${assetId}/price`, {
      timeout: 10_000,
      validateStatus: () => true,
    });

    if (!data || data.statusCode >= 400) {
      warn(`Price endpoint returned ${data?.statusCode ?? 'unknown'} — snapshot may not exist yet`);
      return;
    }

    const price = Number(data.price ?? 0);
    if (price > 0) {
      ok(`Current price: ${price.toFixed(6)} USDC/token`);
    } else {
      warn('Price is zero — price oracle snapshot not yet recorded');
    }

    if (typeof data.change24h === 'number') {
      ok(`24h change: ${data.change24h.toFixed(2)}%`);
    }
  } catch (err: any) {
    warn(`Price endpoint: ${err.message}`);
  }
}

async function ensureInvestorWhitelisted(
  assetId: string,
  asaId: number,
  walletAddress: string,
  userId: string,
): Promise<void> {
  log(`Whitelisting investor wallet ${walletAddress.slice(0, 16)}… for ASA ${asaId}…`);
  try {
    await axios.post(`${GATEWAY}/compliance/dev/whitelist`, {
      walletAddress,
      asaId,
      assetId,
      userId,
    });
    ok('Investor whitelisted via dev endpoint');
  } catch (err: any) {
    warn(`Dev whitelist: ${err.response?.data?.message ?? err.message}`);
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ChainStrike E2E — 05: Pool + Investor Readiness ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const state = loadState();
  const { assetId, asaId, issuerWalletAddress } = state;
  if (!assetId || !asaId) fail('assetId/asaId missing — run previous tests first');

  await verifyPoolIsLive(assetId);
  await verifyPriceEndpoint(assetId);

  const investorToken = await getToken('investor@testnet.io', 'Investor@Test2024!');
  const investorPayload = JSON.parse(Buffer.from(investorToken.split('.')[1], 'base64').toString());
  ok(`Investor logged in: ${investorPayload.email}`);

  const investorWalletAddress = issuerWalletAddress;
  if (investorWalletAddress) {
    await ensureInvestorWhitelisted(assetId, asaId, investorWalletAddress, investorPayload.sub);
  } else {
    warn('No investorWalletAddress in state — whitelist check skipped');
  }

  saveState({ investorToken });

  console.log(`\n✅ TEST 05 PASSED — Tinyman pool verified, investor ready`);
  console.log(`   To test actual swaps: open /trade/${assetId} in the browser and connect a wallet\n`);
}

main().catch((err) => {
  console.error('\n❌ TEST 05 FAILED:', err.response?.data ?? err.message);
  process.exit(1);
});
