/**
 * Redeploy trading escrow contract with optIntoUsdc support.
 * Updates ESCROW_CONTRACT_APP_ID in .env.
 *
 * Run: npx ts-node --esm scripts/redeploy-escrow.ts
 */

import algosdk from 'algosdk';
import fs from 'fs';
import path from 'path';

const ADMIN_MNEMONIC = 'crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss';
const ALGOD_SERVER = 'https://testnet-api.algonode.cloud';
const USDC_ASA_ID = 10458941;

// Method selector for optIntoUsdc()void — keccak256("optIntoUsdc()void") first 4 bytes
// We'll compute it from the ARC56 JSON

async function main() {
  const account = algosdk.mnemonicToSecretKey(ADMIN_MNEMONIC);
  const algod = new algosdk.Algodv2('', ALGOD_SERVER, 443);

  console.log(`Admin: ${account.addr.toString()}`);

  const approvalPath = path.resolve('contracts/escrow/src/out/EscrowContract.approval.teal');
  const clearPath = path.resolve('contracts/escrow/src/out/EscrowContract.clear.teal');
  const approvalTeal = fs.readFileSync(approvalPath, 'utf-8');
  const clearTeal = fs.readFileSync(clearPath, 'utf-8');

  // Compile
  const approvalResult = await algod.compile(approvalTeal).do();
  const clearResult = await algod.compile(clearTeal).do();
  const approval = new Uint8Array(Buffer.from(approvalResult.result, 'base64'));
  const clear = new Uint8Array(Buffer.from(clearResult.result, 'base64'));

  const adminPk = algosdk.decodeAddress(account.addr.toString()).publicKey;
  const sp = await algod.getTransactionParams().do();

  console.log('Deploying new EscrowContract…');
  const createTxn = algosdk.makeApplicationCreateTxnFromObject({
    sender: account.addr.toString(),
    approvalProgram: approval,
    clearProgram: clear,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    numGlobalInts: 4,
    numGlobalByteSlices: 4,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    suggestedParams: sp,
    appArgs: [
      Buffer.from('e18362e2', 'hex'),  // createApplication(address,address,uint64)void
      adminPk,
      adminPk,
      algosdk.encodeUint64(USDC_ASA_ID),
    ],
  });

  const signedCreate = createTxn.signTxn(account.sk);
  const { txid: createTxid } = await algod.sendRawTransaction(signedCreate).do();
  const createResult = await algosdk.waitForConfirmation(algod, createTxid, 8);
  const escrowAppId = Number(createResult.applicationIndex);
  console.log(`✅ Deployed: appId=${escrowAppId}`);

  const escrowAddress = algosdk.getApplicationAddress(escrowAppId).toString();
  console.log(`   Address: ${escrowAddress}`);

  // Fund escrow with 0.2 ALGO (0.1 base + 0.1 USDC opt-in MBR)
  console.log('Funding escrow contract with 0.2 ALGO…');
  const sp2 = await algod.getTransactionParams().do();
  const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: account.addr.toString(),
    receiver: escrowAddress,
    amount: 200_000, // 0.2 ALGO in microALGO
    suggestedParams: sp2,
  });
  const signedFund = fundTxn.signTxn(account.sk);
  const { txid: fundTxid } = await algod.sendRawTransaction(signedFund).do();
  await algosdk.waitForConfirmation(algod, fundTxid, 8);
  console.log(`✅ Funded: txid=${fundTxid}`);

  // Call optIntoUsdc() — ABI method selector
  // optIntoUsdc()void → SHA512/256 first 4 bytes of "optIntoUsdc()void"
  // From ARC56 JSON: look up the method
  const arc56 = JSON.parse(fs.readFileSync('contracts/escrow/src/out/EscrowContract.arc56.json', 'utf-8'));
  const optInMethod = arc56.methods.find((m: any) => m.name === 'optIntoUsdc');
  if (!optInMethod) throw new Error('optIntoUsdc method not found in ARC56');

  const methodSig = `${optInMethod.name}(${optInMethod.args.map((a: any) => a.type).join(',')})${optInMethod.returns.type}`;
  console.log(`Method signature: ${methodSig}`);

  // Compute 4-byte selector: SHA512/256 of the method signature
  const { createHash } = await import('crypto');
  const hash = createHash('sha512-256').update(methodSig).digest();
  const selector = hash.slice(0, 4);
  console.log(`Method selector: ${Buffer.from(selector).toString('hex')}`);

  const sp3 = await algod.getTransactionParams().do();
  sp3.fee = 2000n; // cover outer txn + inner opt-in txn
  sp3.flatFee = true;
  const optInTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: account.addr.toString(),
    appIndex: escrowAppId,
    appArgs: [selector],
    foreignAssets: [USDC_ASA_ID],
    suggestedParams: sp3,
  });
  const signedOptIn = optInTxn.signTxn(account.sk);
  const { txid: optInTxid } = await algod.sendRawTransaction(signedOptIn).do();
  await algosdk.waitForConfirmation(algod, optInTxid, 8);
  console.log(`✅ Opted into USDC: txid=${optInTxid}`);

  // Update .env
  const envPath = path.resolve('.env');
  let envContent = fs.readFileSync(envPath, 'utf-8');
  envContent = envContent.replace(
    /^ESCROW_CONTRACT_APP_ID=.*/m,
    `ESCROW_CONTRACT_APP_ID=${escrowAppId}`,
  );
  fs.writeFileSync(envPath, envContent);
  console.log(`✅ Updated .env: ESCROW_CONTRACT_APP_ID=${escrowAppId}`);

  console.log(`\n🎉 New escrow contract ready:`);
  console.log(`   App ID:  ${escrowAppId}`);
  console.log(`   Address: ${escrowAddress}`);
  console.log(`   USDC:    opted in ✓`);
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
