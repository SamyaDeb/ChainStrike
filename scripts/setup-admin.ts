#!/usr/bin/env ts-node
/**
 * setup-admin.ts
 *
 * Run once before starting services to:
 *   1. Derive the admin wallet address from ALGORAND_ADMIN_MNEMONIC
 *   2. Check ALGO + USDC balances
 *   3. Opt admin into USDC (ASA 10458941) if needed
 *   4. Print the values to paste into .env and apps/web/.env.local
 *
 * Usage:
 *   npx ts-node scripts/setup-admin.ts
 */

import 'dotenv/config';
import algosdk from 'algosdk';

const ALGOD_SERVER = process.env.ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
const ALGOD_PORT   = Number(process.env.ALGORAND_ALGOD_PORT ?? 443);
const ALGOD_TOKEN  = process.env.ALGORAND_ALGOD_TOKEN ?? '';
const NETWORK      = process.env.ALGORAND_NETWORK ?? 'testnet';
const USDC_ASA_ID  = NETWORK === 'mainnet' ? 31566704 : 10458941;

async function main() {
  const mnemonic = process.env.ALGORAND_ADMIN_MNEMONIC;
  if (!mnemonic) {
    console.error('❌  ALGORAND_ADMIN_MNEMONIC is not set in .env');
    process.exit(1);
  }

  const adminAccount = algosdk.mnemonicToSecretKey(mnemonic);
  const adminAddr = adminAccount.addr.toString();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Admin wallet: ${adminAddr}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);

  // ─── Check ALGO balance ─────────────────────────────────────────────────────
  let algoBalance = 0n;
  try {
    const acctInfo = await algod.accountInformation(adminAddr).do();
    algoBalance = BigInt((acctInfo as any).amount ?? 0);
    const algoDisplay = Number(algoBalance) / 1_000_000;
    const funded = algoBalance >= 1_000_000n;
    console.log(`  ALGO balance:  ${algoDisplay.toFixed(6)} ALGO  ${funded ? '✓' : '⚠️  NEEDS FUNDING'}`);
    if (!funded) {
      console.log(`  → Get testnet ALGO at: https://bank.testnet.algorand.network`);
      console.log(`    Paste address: ${adminAddr}\n`);
    }
  } catch (err) {
    console.log(`  ALGO balance:  ⚠️  Could not fetch (${(err as Error).message})`);
  }

  // ─── Check / opt-in to USDC ──────────────────────────────────────────────────
  let usdcOptedIn = false;
  let usdcBalance = 0n;
  try {
    const assetInfo = await algod.accountAssetInformation(adminAddr, USDC_ASA_ID).do();
    const holding = (assetInfo as any).assetHolding ?? (assetInfo as any)['asset-holding'];
    usdcOptedIn = !!holding;
    usdcBalance = BigInt(holding?.amount ?? 0);
    const usdcDisplay = Number(usdcBalance) / 1_000_000;
    console.log(`  USDC balance:  ${usdcDisplay.toFixed(2)} USDC  ✓ (opted in)`);
    if (usdcBalance < 5_000_000n) {
      console.log(`  ⚠️  Low USDC — fund via: https://faucet.circle.com/algorand`);
      console.log(`     (Needed only to pre-fund dispense-usdc endpoint — not for settlement)`);
    }
  } catch {
    console.log(`  USDC:          not opted in yet — opting in now...`);
    try {
      const sp = await algod.getTransactionParams().do();
      const optIn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: adminAccount.addr,
        receiver: adminAccount.addr,
        assetIndex: USDC_ASA_ID,
        amount: 0n,
        suggestedParams: sp,
      });
      const signed = optIn.signTxn(adminAccount.sk);
      const { txid } = await algod.sendRawTransaction(signed).do();
      await algosdk.waitForConfirmation(algod, txid, 4);
      usdcOptedIn = true;
      console.log(`  USDC opt-in:   ✓ txId=${txid}`);
    } catch (optErr) {
      console.log(`  USDC opt-in:   ❌ failed: ${(optErr as Error).message}`);
      console.log(`  → Ensure admin wallet has ALGO first (minimum 0.2 ALGO for opt-in fee)`);
    }
  }

  // ─── Print env values ────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Paste these into .env:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`TREASURY_WALLET_ADDRESS=${adminAddr}`);
  console.log(`NEXT_PUBLIC_PLATFORM_ADDRESS=${adminAddr}`);
  console.log(`KAFKA_ENABLED=false`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Paste these into apps/web/.env.local:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`NEXT_PUBLIC_ESCROW_ADDRESS=${adminAddr}`);
  console.log(`NEXT_PUBLIC_DEV_SKIP_ESCROW=false`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  How USDC flows (no escrow contract needed):');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`  Buyer   → sends USDC to admin wallet (${adminAddr.slice(0, 12)}...)`);
  console.log(`  Admin   → verified as escrow receiver (TREASURY_WALLET_ADDRESS = admin)`);
  console.log(`  Settle  → admin pays USDC to issuer from the pooled buyer USDC`);
  console.log(`  Admin   → keeps platform fee (self-transfer to treasury = admin)\n`);
  console.log(`  Explorer: https://testnet.algoexplorer.io/address/${adminAddr}\n`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
