/**
 * E2E Test 04 — Swap Buy (AMM)
 * Tests: admin wallet opts into RWA ASA → swaps 1 USDC → RWA token via Tinyman V2 SDK.
 * Verifies: RWA token balance increased, USDC balance decreased.
 *
 * Run: npx ts-node --esm scripts/e2e/04-swap-buy.ts
 * Requires: 03-activate-and-pool to have run first
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createRequire } from 'module';
import algosdk from 'algosdk';
import { Swap, poolUtils } from '@tinymanorg/tinyman-js-sdk';
// Tinyman SDK uses algosdk v2 internally; use its bundled version to avoid v3 API conflicts
const require = createRequire(import.meta.url);
const algosdk2 = require('@tinymanorg/tinyman-js-sdk/node_modules/algosdk');
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

const STATE_FILE = path.resolve('scripts/e2e/.state.json');
const ALGOD_SERVER = 'https://testnet-api.algonode.cloud';
const USDC_ASA_ID = 10458941;
const SWAP_INPUT_USDC = 1_000_000n; // 1 USDC
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
    return 0n; // Not opted in or zero balance
  }
}

async function optInToAsa(algod: algosdk.Algodv2, account: algosdk.Account, asaId: number): Promise<void> {
  log(`Checking opt-in status for ASA ${asaId}…`);

  // Check if already opted in
  try {
    const info = await algod.accountAssetInformation(account.addr, asaId).do();
    const holding = (info as any).assetHolding ?? (info as any)['asset-holding'];
    if (holding !== undefined) {
      ok(`Already opted into ASA ${asaId} (balance: ${Number(BigInt(holding.amount)) / 1_000_000} tokens)`);
      return;
    }
  } catch {
    // Not opted in — proceed
  }

  log(`Opting admin wallet into ASA ${asaId}…`);
  const sp = await algod.getTransactionParams().do();
  const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: account.addr.toString(),
    receiver: account.addr.toString(),
    assetIndex: asaId,
    amount: 0,
    suggestedParams: sp,
  });

  const signed = optInTxn.signTxn(account.sk);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 4);
  ok(`Opted into ASA ${asaId}: txId=${txid}`);
}

async function executeSwapBuy(
  algod: algosdk.Algodv2,
  tinymanAlgod: any, // algosdk v2 client for Tinyman SDK
  adminAccount: algosdk.Account,
  asaId: number,
): Promise<{ txId: string; tokensReceived: bigint }> {
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
    fail(`Tinyman pool not found for asset pair ${asset1ID}/${asset2ID} — run test 03 first`);
  }
  ok(`Pool found. Asset1=${asset1ID}, Asset2=${asset2ID}`);

  log(`Getting fixed-input swap quote: ${Number(SWAP_INPUT_USDC) / 1_000_000} USDC → RWA token…`);
  const quote = await Swap.v2.getQuote({
    type: 'fixed-input' as any,
    amount: SWAP_INPUT_USDC,
    assetIn: { id: USDC_ASA_ID, decimals: 6 },
    assetOut: { id: asaId, decimals: 6 },
    pool: poolInfo,
    network: TINYMAN_NETWORK,
    slippage: 0.01,
  });

  const outputAmount = (quote as any).minOutputAmount ?? (quote as any).outputAmount ?? (quote as any).amount;
  ok(`Swap quote: ${Number(SWAP_INPUT_USDC) / 1_000_000} USDC → ~${Number(outputAmount ?? 0) / 1_000_000} tokens (min)`);

  log('Generating swap transaction group…');
  const txGroup = await Swap.v2.generateTxns({
    client: tinymanAlgod,
    network: TINYMAN_NETWORK,
    quote,
    swapType: 'fixed-input' as any,
    slippage: 0.01,
    initiatorAddr: adminAccount.addr.toString(),
  });

  // Admin signs all transactions in the group
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

  // Fetch resulting token balance
  await new Promise((r) => setTimeout(r, 1000));
  const tokenBalance = await getAssetBalance(algod, adminAccount.addr.toString(), asaId);
  return { txId: txid, tokensReceived: tokenBalance };
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ChainStrike E2E — 04: Swap Buy (AMM)            ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const state = loadState();
  const { asaId } = state;
  if (!asaId) fail('asaId missing — run 01, 02, 03 first');

  const mnemonic = process.env.ALGORAND_ADMIN_MNEMONIC ?? '';
  if (!mnemonic) fail('ALGORAND_ADMIN_MNEMONIC not set in .env');

  const adminAccount = algosdk.mnemonicToSecretKey(mnemonic);
  const algod = new algosdk.Algodv2('', ALGOD_SERVER, 443);
  // Separate algosdk v2 client for Tinyman SDK (v3 removed setIntDecoding used internally)
  const tinymanAlgod = new algosdk2.Algodv2('', ALGOD_SERVER, 443);
  const adminAddress = adminAccount.addr.toString();

  log(`Admin wallet: ${adminAddress}`);

  // Record balances BEFORE swap
  const usdcBefore = await getAssetBalance(algod, adminAddress, USDC_ASA_ID);
  log(`USDC balance before swap: ${Number(usdcBefore) / 1_000_000} USDC`);

  if (usdcBefore < SWAP_INPUT_USDC) {
    fail(`Insufficient USDC: ${Number(usdcBefore) / 1_000_000} USDC, need ${Number(SWAP_INPUT_USDC) / 1_000_000} USDC`);
  }

  // Opt in to RWA ASA if needed
  await optInToAsa(algod, adminAccount, asaId);

  const tokensBefore = await getAssetBalance(algod, adminAddress, asaId);
  log(`RWA token balance before swap: ${Number(tokensBefore) / 1_000_000} tokens`);

  // Execute swap
  const { txId: swapBuyTxId, tokensReceived } = await executeSwapBuy(algod, tinymanAlgod, adminAccount, asaId);

  // Record balances AFTER swap
  const usdcAfter = await getAssetBalance(algod, adminAddress, USDC_ASA_ID);
  const tokensAfter = await getAssetBalance(algod, adminAddress, asaId);

  const usdcSpent = usdcBefore - usdcAfter;
  const tokensGained = tokensAfter - tokensBefore;

  log(`USDC balance after swap: ${Number(usdcAfter) / 1_000_000} USDC`);
  log(`RWA token balance after swap: ${Number(tokensAfter) / 1_000_000} tokens`);

  // Assertions
  if (usdcSpent <= 0n) {
    fail(`USDC balance did not decrease after swap. Before: ${usdcBefore}, After: ${usdcAfter}`);
  }
  ok(`USDC decreased by: ${Number(usdcSpent) / 1_000_000} USDC`);

  if (tokensGained <= 0n) {
    fail(`RWA token balance did not increase after swap. Before: ${tokensBefore}, After: ${tokensAfter}`);
  }
  ok(`RWA tokens gained: ${Number(tokensGained) / 1_000_000} tokens`);

  // Sanity: swapped roughly 1 USDC, should receive roughly 1 token (within 5% slippage)
  const expectedMinTokens = SWAP_INPUT_USDC * 95n / 100n; // 0.95 token min
  if (tokensGained < expectedMinTokens) {
    warn(`Tokens received (${Number(tokensGained) / 1_000_000}) is below 95% of input USDC — check pool liquidity`);
  } else {
    ok(`Swap rate within expected range (>= 0.95 token per 1 USDC)`);
  }

  saveState({
    swapBuyTxId,
    tokenBalanceAfterBuy: tokensAfter.toString(),
    usdcBalanceAfterBuy: usdcAfter.toString(),
    tokensGainedFromBuy: tokensGained.toString(),
    adminAddress,
  });

  console.log(`\n✅ TEST 04 PASSED — Buy swap executed successfully`);
  console.log(`   Swap txId:      ${swapBuyTxId}`);
  console.log(`   USDC spent:     ${Number(usdcSpent) / 1_000_000} USDC`);
  console.log(`   Tokens gained:  ${Number(tokensGained) / 1_000_000} tokens`);
  console.log(`   Run test 05 to sell tokens back → USDC\n`);
}

main().catch((err) => {
  console.error('\n❌ TEST 04 FAILED:', err.response?.data ?? err.message);
  process.exit(1);
});
