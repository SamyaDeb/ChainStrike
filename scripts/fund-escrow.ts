/**
 * One-time: Top up the IssuanceLiquidityEscrow contract account with ALGO.
 * The escrow contract needs min-balance ALGO to cover its USDC opt-in storage.
 *
 * Usage:
 *   npx ts-node --esm scripts/fund-escrow.ts
 *
 * Prerequisites:
 *   - .env configured with ALGORAND_ADMIN_MNEMONIC and ISSUANCE_ESCROW_APP_ID
 *   - Admin account funded with testnet ALGO
 */

import * as dotenv from 'dotenv';
import path from 'path';
import algosdk from 'algosdk';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ADMIN_MNEMONIC = process.env.ALGORAND_ADMIN_MNEMONIC ?? '';
const ALGOD_SERVER = process.env.ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
const ALGOD_PORT = Number(process.env.ALGORAND_ALGOD_PORT ?? 443);
const ALGOD_TOKEN = process.env.ALGORAND_ALGOD_TOKEN ?? '';
const ESCROW_APP_ID = Number(process.env.ISSUANCE_ESCROW_APP_ID ?? '0');

async function main() {
  if (!ADMIN_MNEMONIC) throw new Error('ALGORAND_ADMIN_MNEMONIC not set in .env');
  if (!ESCROW_APP_ID) throw new Error('ISSUANCE_ESCROW_APP_ID not set in .env');

  const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
  const admin = algosdk.mnemonicToSecretKey(ADMIN_MNEMONIC);
  const escrowAddress = algosdk.getApplicationAddress(ESCROW_APP_ID).toString();

  console.log(`Admin:  ${admin.addr}`);
  console.log(`Escrow: ${escrowAddress} (appId=${ESCROW_APP_ID})`);

  const info = await algod.accountInformation(escrowAddress).do();
  const currentBalance = Number((info as any).amount ?? 0);
  const minBalance = Number((info as any)['min-balance'] ?? 0);
  console.log(`Current balance: ${currentBalance} µALGO (min: ${minBalance} µALGO)`);

  const topUp = 1_000_000; // 1 ALGO
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: admin.addr.toString(),
    receiver: escrowAddress,
    amount: BigInt(topUp),
    note: new TextEncoder().encode('ChainStrike — escrow min-balance top-up'),
    suggestedParams: sp,
  });

  const signed = txn.signTxn(admin.sk);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 4);

  console.log(`Sent ${topUp / 1_000_000} ALGO to escrow (txId=${txid})`);
  console.log('Done.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
