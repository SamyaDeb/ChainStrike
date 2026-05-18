/**
 * E2E Test 05 — Swap Sell (AMM)
 * Tests: admin wallet swaps RWA tokens back → USDC via Tinyman V2 SDK.
 * Verifies: RWA token balance decreased, USDC balance increased.
 *
 * Run: npx ts-node --esm scripts/e2e/05-swap-sell.ts
 * Requires: 04-swap-buy to have run first (reads tokenBalanceAfterBuy from state)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createRequire } from 'module';
import algosdk from 'algosdk';
import { Swap, poolUtils } from '@tinymanorg/tinyman-js-sdk';
const require = createRequire(import.meta.url);
const algosdk2 = require('@tinymanorg/tinyman-js-sdk/node_modules/algosdk');
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

const STATE_FILE = path.resolve('scripts/e2e/.state.json');
const ALGOD_SERVER = 'https://testnet-api.algonode.cloud';
const USDC_ASA_ID = 10458941;
const TINYMAN_NETWORK = 'testnet';

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

async function getAssetBalance(algod: algosdk.Algodv2, address: string, asaId: number): Promise<bigint> {
  try {
    const info = await algod.accountAssetInformation(address, asaId).do();
    const holding = (info as any).assetHolding ?? (info as any)['asset-holding'];
    return BigInt(holding?.amount ?? 0);
  } catch {
    return 0n;
  }
}

async function executeSwapSell(
  algod: algosdk.Algodv2,
  tinymanAlgod: any,
  adminAccount: algosdk.Account,
  asaId: number,
  sellAmount: bigint,
): Promise<string> {
  log(`Fetching Tinyman V2 pool info for USDC(${USDC_ASA_ID}) / RWA(${asaId})…`);

  const asset1ID = Math.min(asaId, USDC_ASA_ID);
  const asset2ID = Math.max(asaId, USDC_ASA_ID);

  const poolInfo = await poolUtils.v2.getPoolInfo({
    client: tinymanAlgod,
    network: TINYMAN_NETWORK,
    asset1ID,
    asset2ID,
  });

  if (!poolInfo || (poolInfo as any).status === 'POOL_NOT_FOUND') {
    fail(`Tinyman pool not found for asset pair ${asset1ID}/${asset2ID}`);
  }
  ok(`Pool found. Asset1=${asset1ID}, Asset2=${asset2ID}`);

  log(`Getting fixed-input swap quote: ${Number(sellAmount) / 1_000_000} RWA tokens → USDC…`);
  const quote = await Swap.v2.getQuote({
    type: 'fixed-input' as any,
    amount: sellAmount,
    assetIn: { id: asaId, decimals: 6 },
    assetOut: { id: USDC_ASA_ID, decimals: 6 },
    pool: poolInfo,
    network: TINYMAN_NETWORK,
    slippage: 0.01,
  });

  const outputAmount = (quote as any).minOutputAmount ?? (quote as any).outputAmount ?? (quote as any).amount;
  ok(`Swap quote: ${Number(sellAmount) / 1_000_000} tokens → ~${Number(outputAmount ?? 0) / 1_000_000} USDC (min)`);

  log('Generating swap transaction group…');
  const txGroup = await Swap.v2.generateTxns({
    client: tinymanAlgod,
    network: TINYMAN_NETWORK,
    quote,
    swapType: 'fixed-input' as any,
    slippage: 0.01,
    initiatorAddr: adminAccount.addr.toString(),
  });

  const initiatorSigner = async (txGroupList: any) =>
    txGroupList.flat().map(({ txn }: any) => txn.signTxn(adminAccount.sk));

  log('Signing transactions with admin wallet…');
  const signedTxns = await Swap.v2.signTxns({ txGroup, initiatorSigner });

  log('Broadcasting swap transactions to Algorand testnet…');
  const { txid } = await algod.sendRawTransaction(signedTxns).do();

  log(`Waiting for confirmation: ${txid}`);
  await algosdk.waitForConfirmation(algod, txid, 8);
  ok(`Swap confirmed: txId=${txid}`);
  ok(`View: https://testnet.algoexplorer.io/tx/${txid}`);

  return txid;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ChainStrike E2E — 05: Swap Sell (AMM)           ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const state = loadState();
  const { asaId } = state;
  if (!asaId) fail('asaId missing — run 01, 02, 03, 04 first');

  const mnemonic = process.env.ALGORAND_ADMIN_MNEMONIC ?? '';
  if (!mnemonic) fail('ALGORAND_ADMIN_MNEMONIC not set in .env');

  const adminAccount = algosdk.mnemonicToSecretKey(mnemonic);
  const algod = new algosdk.Algodv2('', ALGOD_SERVER, 443);
  const tinymanAlgod = new algosdk2.Algodv2('', ALGOD_SERVER, 443);
  const adminAddress = adminAccount.addr.toString();

  log(`Admin wallet: ${adminAddress}`);

  // Record balances BEFORE swap
  const tokensBefore = await getAssetBalance(algod, adminAddress, asaId);
  const usdcBefore = await getAssetBalance(algod, adminAddress, USDC_ASA_ID);

  log(`RWA token balance before sell: ${Number(tokensBefore) / 1_000_000} tokens`);
  log(`USDC balance before sell: ${Number(usdcBefore) / 1_000_000} USDC`);

  if (tokensBefore === 0n) {
    fail(`No RWA tokens to sell (balance=0). Run 04-swap-buy.ts first.`);
  }

  // Sell all tokens gained from the buy test (or fallback to whatever is held)
  const tokensGainedFromBuy = state.tokensGainedFromBuy ? BigInt(state.tokensGainedFromBuy) : tokensBefore;
  const sellAmount = tokensGainedFromBuy > 0n ? tokensGainedFromBuy : tokensBefore;

  if (sellAmount > tokensBefore) {
    warn(`sellAmount (${Number(sellAmount) / 1_000_000}) exceeds current balance (${Number(tokensBefore) / 1_000_000}) — selling all available tokens`);
  }
  const actualSellAmount = sellAmount > tokensBefore ? tokensBefore : sellAmount;

  log(`Selling ${Number(actualSellAmount) / 1_000_000} RWA tokens back to USDC…`);

  const swapSellTxId = await executeSwapSell(algod, tinymanAlgod, adminAccount, asaId, actualSellAmount);

  // Record balances AFTER swap
  await new Promise((r) => setTimeout(r, 1000));
  const tokensAfter = await getAssetBalance(algod, adminAddress, asaId);
  const usdcAfter = await getAssetBalance(algod, adminAddress, USDC_ASA_ID);

  const tokensSpent = tokensBefore - tokensAfter;
  const usdcGained = usdcAfter - usdcBefore;

  log(`RWA token balance after sell: ${Number(tokensAfter) / 1_000_000} tokens`);
  log(`USDC balance after sell: ${Number(usdcAfter) / 1_000_000} USDC`);

  // Assertions
  if (tokensSpent <= 0n) {
    fail(`RWA token balance did not decrease after sell. Before: ${tokensBefore}, After: ${tokensAfter}`);
  }
  ok(`RWA tokens spent: ${Number(tokensSpent) / 1_000_000} tokens`);

  if (usdcGained <= 0n) {
    fail(`USDC balance did not increase after sell. Before: ${usdcBefore}, After: ${usdcAfter}`);
  }
  ok(`USDC gained: ${Number(usdcGained) / 1_000_000} USDC`);

  // Sanity: should receive roughly the same USDC as tokens sold (within 5% for small pool slippage)
  const expectedMinUsdc = actualSellAmount * 90n / 100n; // 90% minimum (pool fees + slippage)
  if (usdcGained < expectedMinUsdc) {
    warn(`USDC received (${Number(usdcGained) / 1_000_000}) is below 90% of tokens sold — check pool liquidity or slippage`);
  } else {
    ok(`Sell rate within expected range (>= 90% value recovered)`);
  }

  saveState({
    swapSellTxId,
    tokenBalanceAfterSell: tokensAfter.toString(),
    usdcBalanceAfterSell: usdcAfter.toString(),
    usdcGainedFromSell: usdcGained.toString(),
  });

  console.log(`\n✅ TEST 05 PASSED — Sell swap executed successfully`);
  console.log(`   Swap txId:      ${swapSellTxId}`);
  console.log(`   Tokens sold:    ${Number(tokensSpent) / 1_000_000} tokens`);
  console.log(`   USDC received:  ${Number(usdcGained) / 1_000_000} USDC`);
  console.log(`   Run test 06 to verify price history\n`);
}

main().catch((err) => {
  console.error('\n❌ TEST 05 FAILED:', err.response?.data ?? err.message);
  process.exit(1);
});
