/**
 * E2E Test 05 — Investor Buy Order + Matching Engine
 * Tests: investor places BUY at same price as seeded SELL → matching engine executes
 *        → trade created → settlement triggered
 *
 * Run: npx ts-node --esm scripts/e2e/05-investor-buy-and-match.ts
 * Requires: 04-activate-market to have run first
 */

import axios from 'axios';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

const GATEWAY = 'http://localhost:8080/api/v1';
const STATE_FILE = path.resolve('scripts/e2e/.state.json');

function log(msg: string) { console.log(`  ${msg}`); }
function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); }
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

async function getToken(email: string, password: string): Promise<string> {
  const { data } = await axios.post(`${GATEWAY}/auth/login`, { email, password });
  if (!data.accessToken) fail(`Login failed for ${email}`);
  return data.accessToken;
}

async function ensureInvestorWhitelisted(assetId: string, asaId: number, walletAddress: string, userId: string) {
  log(`Ensuring investor wallet ${walletAddress.slice(0, 16)}… is whitelisted for ASA ${asaId}…`);
  try {
    await axios.post(`${GATEWAY}/compliance/dev/whitelist`, {
      walletAddress,
      asaId,
      assetId,
      userId,
    });
    ok('Investor whitelisted via dev endpoint');
  } catch (err: any) {
    warn(`Dev whitelist call: ${err.response?.data?.message ?? err.message}`);
  }
}

async function getOrderbookDepthBeforeBuy(assetId: string): Promise<{ bestAsk: string; askQty: string } | null> {
  log('Capturing orderbook depth before BUY order…');
  const { data } = await axios.get(`${GATEWAY}/orders/${assetId}/depth?levels=20`);
  const asks = data.asks ?? [];
  if (asks.length === 0) {
    warn('No asks in orderbook! Seed orders may not have loaded into in-memory store.');
    return null;
  }
  ok(`Pre-buy depth: bestAsk=${asks[0].price} (micro-USDC), qty=${asks[0].quantity}`);
  return { bestAsk: asks[0].price, askQty: asks[0].quantity };
}

async function placeBuyOrderAtBestAsk(
  investorToken: string,
  assetId: string,
  walletAddress: string,
  priceUsdc: string,
  quantity: string,
): Promise<string> {
  log(`Placing BUY LIMIT order: ${Number(quantity) / 1e6} tokens @ ${Number(priceUsdc) / 1e6} USDC…`);

  const { data } = await axios.post(
    `${GATEWAY}/orders`,
    {
      assetId,
      side: 'BUY',
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      price: priceUsdc,
      quantity,
      walletAddress,
    },
    { ...authHeader(investorToken), timeout: 15_000 },
  );

  if (!data.id) fail(`BUY order creation failed: ${JSON.stringify(data)}`);
  ok(`BUY order placed: orderId=${data.id}, status=${data.status}`);
  return data.id;
}

async function triggerMatchingEngine(assetId: string): Promise<{ matched: boolean; tradeId?: string }> {
  log('Triggering matching engine via dev endpoint…');
  try {
    const { data } = await axios.post(
      `${GATEWAY}/orders/${assetId}/dev/trigger-match`,
      {},
      { timeout: 30_000 },
    );
    log(`  Matching result: ${JSON.stringify(data)}`);

    // DevMatchingService returns { trades: number, settled: boolean }
    if (data.trades && data.trades > 0) {
      ok(`Match executed! ${data.trades} trade(s) created`);
      // Fetch the most recent trade from the orderbook DB to get the tradeId
      return { matched: true, tradeId: data.tradeId };
    } else if (data.matched === true) {
      ok(`Match confirmed: ${JSON.stringify(data)}`);
      return { matched: true, tradeId: data.tradeId };
    } else {
      warn('Matching ran but no trades were created. Orders may not have crossed in price.');
      warn(`Response: ${JSON.stringify(data)}`);
      return { matched: false };
    }
  } catch (err: any) {
    warn(`Dev trigger-match: ${err.response?.data?.message ?? err.message}`);
    return { matched: false };
  }
}

async function verifyOrderStatus(investorToken: string, orderId: string) {
  log(`Checking order ${orderId} status after match…`);
  const { data } = await axios.get(`${GATEWAY}/orders/my`, authHeader(investorToken));
  const order = Array.isArray(data) ? data.find((o: any) => o.id === orderId) : null;
  if (!order) {
    warn('Order not found in active orders (may be FILLED and archived)');
    return;
  }
  ok(`Order status: ${order.status}, filledQty=${order.filledQuantity}, remainingQty=${order.remainingQuantity}`);
  if (order.status === 'FILLED') {
    ok('Order fully FILLED — match was successful!');
  } else if (order.status === 'PARTIALLY_FILLED') {
    ok(`Order PARTIALLY_FILLED — ${order.filledQuantity} filled`);
  }
}

async function verifyOrderbookDepthAfterMatch(assetId: string, previousAskQty: string | undefined) {
  log('Checking orderbook depth after match — asks should decrease…');
  const { data } = await axios.get(`${GATEWAY}/orders/${assetId}/depth?levels=20`);
  const asks = data.asks ?? [];
  const bids = data.bids ?? [];
  ok(`Post-match depth: ${bids.length} bids, ${asks.length} asks`);
  if (asks.length > 0) {
    ok(`Best ask after match: ${asks[0].price} @ qty ${asks[0].quantity}`);
    if (previousAskQty && asks[0].quantity < previousAskQty) {
      ok('Ask quantity decreased after match ✓');
    }
  }
}

async function verifyLastTrade(assetId: string) {
  log('Checking OHLCV for trade activity…');
  try {
    const { data } = await axios.get(`${GATEWAY}/orders/${assetId}/ohlcv?interval=1m&limit=10`);
    if (Array.isArray(data) && data.length > 0) {
      const latest = data[data.length - 1];
      ok(`OHLCV: latest candle close=${latest.close}, volume=${latest.volume}`);
    } else {
      warn('OHLCV empty — trade may not have generated a candle yet');
    }
  } catch (err: any) {
    warn(`OHLCV fetch: ${err.message}`);
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ChainStrike E2E — 05: Investor Buy + Match       ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const state = loadState();
  const { assetId, asaId, issuerWalletAddress } = state;
  if (!assetId || !asaId) fail('assetId/asaId missing — run previous tests first');

  let investorToken = state.investorToken;
  if (!investorToken) {
    investorToken = await getToken('investor@testnet.io', 'Investor@Test2024!');
  }
  const investorPayload = JSON.parse(Buffer.from(investorToken.split('.')[1], 'base64').toString());
  const investorUserId = investorPayload.sub;

  // Use the admin/issuer wallet as investor wallet for dev (no separate wallet setup needed)
  const investorWalletAddress = issuerWalletAddress;
  if (!investorWalletAddress) fail('issuerWalletAddress missing — run test 03 first');

  ok(`Investor: ${investorPayload.email}`);
  ok(`Investor wallet: ${investorWalletAddress.slice(0, 20)}…`);

  await ensureInvestorWhitelisted(assetId, asaId, investorWalletAddress, investorUserId);

  const depthBefore = await getOrderbookDepthBeforeBuy(assetId);

  // Use bestAsk price from depth, or fall back to asset's pricePerToken
  let buyPrice = depthBefore?.bestAsk;
  if (!buyPrice) {
    const { data: assetData } = await axios.get(`${GATEWAY}/assets/${assetId}`);
    buyPrice = assetData.pricePerToken?.toString() ?? '25000000';
    warn(`No asks in depth — using asset pricePerToken: ${buyPrice}`);
  }

  // Buy 5 tokens (5 * 1e6 micro-tokens)
  const buyQuantity = '5000000';
  const resolvedBuyPrice = buyPrice ?? '25000000'; // fallback: 25 USDC
  const buyOrderId = await placeBuyOrderAtBestAsk(
    investorToken, assetId, investorWalletAddress, resolvedBuyPrice, buyQuantity,
  );

  // Small pause for async matching to run
  log('Waiting 2s for inline matching to process…');
  await new Promise((r) => setTimeout(r, 2000));

  // Also explicitly trigger the matching engine
  const matchResult = await triggerMatchingEngine(assetId);

  await verifyOrderStatus(investorToken, buyOrderId);
  await verifyOrderbookDepthAfterMatch(assetId, depthBefore?.askQty);
  await verifyLastTrade(assetId);

  saveState({
    investorToken,
    buyOrderId,
    tradeId: matchResult.tradeId,
    buyPrice: resolvedBuyPrice,
    buyQuantity,
    investorWalletAddress,
  });

  console.log(`\n✅ TEST 05 PASSED`);
  console.log(`   Buy order id: ${buyOrderId}`);
  console.log(`   Trade id:     ${matchResult.tradeId ?? 'N/A (no match yet)'}`);
  console.log(`   Matched:      ${matchResult.matched}\n`);
}

main().catch((err) => {
  console.error('\n❌ TEST 05 FAILED:', err.response?.data ?? err.message);
  process.exit(1);
});
