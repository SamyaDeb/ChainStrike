/**
 * Call optIntoUsdc() on the trading escrow contract to opt it into USDC.
 * Run: npx ts-node --esm scripts/escrow-optin-usdc.ts
 */

import algosdk from 'algosdk';
import { createHash } from 'crypto';

const ADMIN_MNEMONIC = 'crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss';
const ALGOD_SERVER = 'https://testnet-api.algonode.cloud';
const USDC_ASA_ID = 10458941;
const ESCROW_APP_ID = parseInt(process.env['ESCROW_CONTRACT_APP_ID'] ?? '762585096', 10);

async function main() {
  const account = algosdk.mnemonicToSecretKey(ADMIN_MNEMONIC);
  const algod = new algosdk.Algodv2('', ALGOD_SERVER, 443);

  const escrowAddress = algosdk.getApplicationAddress(ESCROW_APP_ID).toString();
  console.log(`Escrow app ID: ${ESCROW_APP_ID}`);
  console.log(`Escrow address: ${escrowAddress}`);
  console.log(`Admin: ${account.addr.toString()}`);

  // Compute ABI method selector for optIntoUsdc()void
  const methodSig = 'optIntoUsdc()void';
  const hash = createHash('sha512-256').update(methodSig).digest();
  const selector = hash.slice(0, 4);
  console.log(`Method selector: ${Buffer.from(selector).toString('hex')}`);

  const sp = await algod.getTransactionParams().do();
  // fee = 2000 to cover outer txn (1000) + inner opt-in txn (1000)
  sp.flatFee = true;
  sp.fee = BigInt(2000);

  const txn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: account.addr.toString(),
    appIndex: ESCROW_APP_ID,
    appArgs: [selector],
    foreignAssets: [USDC_ASA_ID],
    suggestedParams: sp,
  });

  const signed = txn.signTxn(account.sk);
  const { txid } = await algod.sendRawTransaction(signed).do();
  console.log(`TX submitted: ${txid}`);
  await algosdk.waitForConfirmation(algod, txid, 10);
  console.log(`✅ Escrow contract opted into USDC: ${txid}`);
  console.log(`   Escrow address: ${escrowAddress}`);
}

main().catch(err => {
  console.error('❌ Failed:', err.message ?? err);
  process.exit(1);
});
