/**
 * Deploy ChainStrike smart contracts to Algorand testnet.
 */

import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import algosdk from 'algosdk';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const server = process.env.ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
  const port = Number(process.env.ALGORAND_ALGOD_PORT ?? 443);
  const token = process.env.ALGORAND_ALGOD_TOKEN ?? '';
  const mnemonic = process.env.ALGORAND_ADMIN_MNEMONIC ?? '';

  if (!mnemonic || mnemonic.startsWith('your twenty')) {
    console.error('ERROR: Set ALGORAND_ADMIN_MNEMONIC in .env before deploying');
    process.exit(1);
  }

  const client = new algosdk.Algodv2(token, server, port);
  const account = algosdk.mnemonicToSecretKey(mnemonic);

  const accountInfo = await client.accountInformation(account.addr).do();
  const balance = Number(accountInfo.amount) / 1_000_000;
  console.log(`\nAdmin account: ${account.addr}`);
  console.log(`Balance: ${balance} ALGO`);

  if (balance < 0.5) {
    console.error(`\nERROR: Insufficient balance (${balance} ALGO). Need >= 0.5 ALGO.`);
    process.exit(1);
  }

  const sp = await client.getTransactionParams().do();

  // ─── Opt admin into USDC ────────────────────────────────────────────────────
  const usdcAsaId = Number(process.env.USDC_ASSET_ID ?? '10458941');
  console.log(`\n[0/3] Opting admin into USDC (ASA ${usdcAsaId})…`);
  try {
    const usdcOptIn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: account.addr.toString(),
      receiver: account.addr.toString(),
      assetIndex: usdcAsaId,
      amount: 0,
      suggestedParams: sp,
    });
    const signed = usdcOptIn.signTxn(account.sk);
    const { txid } = await client.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(client, txid, 4);
    console.log(`      USDC opt-in confirmed: ${txid}`);
  } catch (err: any) {
    if (err.message?.includes('already opted in')) {
      console.log('      Already opted in to USDC');
    } else {
      console.warn(`      USDC opt-in skipped: ${err.message}`);
    }
  }

  const adminPk = algosdk.decodeAddress(account.addr.toString()).publicKey;

  // ─── Deploy WhitelistRegistry ─────────────────────────────────────────────
  console.log('\n[1/3] Deploying WhitelistRegistry contract…');
  let whitelistAppId = 0;
  try {
    const approvalPath = path.resolve(process.cwd(), 'contracts/whitelist-registry/src/out/WhitelistRegistry.approval.teal');
    const clearPath = path.resolve(process.cwd(), 'contracts/whitelist-registry/src/out/WhitelistRegistry.clear.teal');
    const approvalTeal = fs.readFileSync(approvalPath, 'utf-8');
    const clearTeal = fs.readFileSync(clearPath, 'utf-8');
    const approvalResult = await client.compile(approvalTeal).do();
    const clearResult = await client.compile(clearTeal).do();
    const approval = new Uint8Array(Buffer.from(approvalResult.result, 'base64'));
    const clear = new Uint8Array(Buffer.from(clearResult.result, 'base64'));

    const txn = algosdk.makeApplicationCreateTxnFromObject({
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
        Buffer.from('b4c77d71', 'hex'),  // createApplication(address,address)void
        adminPk,                           // adminAddress
        adminPk,                           // oracleAddress
      ],
    });

    const signed = txn.signTxn(account.sk);
    const { txid } = await client.sendRawTransaction(signed).do();
    const result = await algosdk.waitForConfirmation(client, txid, 4);
    whitelistAppId = Number(result.applicationIndex);
    console.log(`      WhitelistRegistry App ID: ${whitelistAppId}`);
  } catch (err: any) {
    console.warn(`      Skipped: ${err.message}`);
  }

  // ─── Deploy Escrow contract ───────────────────────────────────────────────
  console.log('\n[2/3] Deploying Escrow contract…');
  let escrowAppId = 0;
  try {
    const approvalPath = path.resolve(process.cwd(), 'contracts/escrow/src/out/EscrowContract.approval.teal');
    const clearPath = path.resolve(process.cwd(), 'contracts/escrow/src/out/EscrowContract.clear.teal');
    const approvalTeal = fs.readFileSync(approvalPath, 'utf-8');
    const clearTeal = fs.readFileSync(clearPath, 'utf-8');
    const approvalResult = await client.compile(approvalTeal).do();
    const clearResult = await client.compile(clearTeal).do();
    const approval = new Uint8Array(Buffer.from(approvalResult.result, 'base64'));
    const clear = new Uint8Array(Buffer.from(clearResult.result, 'base64'));

    const txn = algosdk.makeApplicationCreateTxnFromObject({
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
        adminPk,                           // adminAddress
        adminPk,                           // settlementAddress
        algosdk.encodeUint64(usdcAsaId),   // usdcAsaId
      ],
    });

    const signed = txn.signTxn(account.sk);
    const { txid } = await client.sendRawTransaction(signed).do();
    const result = await algosdk.waitForConfirmation(client, txid, 4);
    escrowAppId = Number(result.applicationIndex);
    console.log(`      Escrow App ID: ${escrowAppId}`);
  } catch (err: any) {
    console.warn(`      Skipped: ${err.message}`);
  }

  // ─── Deploy TransferRestriction (template) ──────────────────────────────────
  console.log('\n[3/3] Deploying TransferRestriction template contract…');
  let transferRestrictionAppId = 0;
  try {
    const approvalPath = path.resolve(process.cwd(), 'contracts/transfer-restriction/src/out/TransferRestriction.approval.teal');
    const clearPath = path.resolve(process.cwd(), 'contracts/transfer-restriction/src/out/TransferRestriction.clear.teal');
    const approvalTeal = fs.readFileSync(approvalPath, 'utf-8');
    const clearTeal = fs.readFileSync(clearPath, 'utf-8');
    const approvalResult = await client.compile(approvalTeal).do();
    const clearResult = await client.compile(clearTeal).do();
    const approval = new Uint8Array(Buffer.from(approvalResult.result, 'base64'));
    const clear = new Uint8Array(Buffer.from(clearResult.result, 'base64'));

    const txn = algosdk.makeApplicationCreateTxnFromObject({
      sender: account.addr.toString(),
      approvalProgram: approval,
      clearProgram: clear,
      numLocalInts: 0,
      numLocalByteSlices: 0,
      numGlobalInts: 16,
      numGlobalByteSlices: 4,
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
      suggestedParams: sp,
      appArgs: [
        Buffer.from('2b8b3c0c', 'hex'),  // createApplication(address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64)void
        adminPk,                           // adminAddress
        algosdk.encodeUint64(0),           // asaId (placeholder)
        algosdk.encodeUint64(whitelistAppId || 0), // whitelistAppId
        algosdk.encodeUint64(0),           // lockupDays
        algosdk.encodeUint64(0),           // minimumTransferAmount
        algosdk.encodeUint64(10000),       // maximumHoldingBips
        algosdk.encodeUint64(0),           // accreditedOnly
        algosdk.encodeUint64(1),           // minimumKycTier
        algosdk.encodeUint64(0),           // totalSupply
      ],
    });

    const signed = txn.signTxn(account.sk);
    const { txid } = await client.sendRawTransaction(signed).do();
    const result = await algosdk.waitForConfirmation(client, txid, 4);
    transferRestrictionAppId = Number(result.applicationIndex);
    console.log(`      TransferRestriction App ID: ${transferRestrictionAppId}`);
  } catch (err: any) {
    console.warn(`      Skipped: ${err.message}`);
  }

  // ─── Write deployed IDs to .env ───────────────────────────────────────────
  updateEnv('WHITELIST_REGISTRY_APP_ID', String(whitelistAppId));
  updateEnv('ESCROW_CONTRACT_APP_ID', String(escrowAppId));
  updateEnv('TRANSFER_RESTRICTION_APP_ID', String(transferRestrictionAppId));

  console.log('\n✅ Deployment complete!');
  console.log(`\n  WhitelistRegistry:     ${whitelistAppId}`);
  console.log(`  Escrow:                ${escrowAppId}`);
  console.log(`  TransferRestriction:   ${transferRestrictionAppId}`);
  console.log('\nNext steps:');
  console.log('  1. .env has been updated with contract IDs');
  console.log('  2. Run: npm run seed:testnet');
  console.log('  3. Run: npm run dev');
}

function updateEnv(key: string, value: string) {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  let content = fs.readFileSync(envPath, 'utf-8');
  const regex = new RegExp(`^${key}=.*`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(envPath, content);
}

main().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
