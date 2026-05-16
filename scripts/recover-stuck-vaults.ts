/**
 * Retroactively deploy vaults for assets whose tokens are stuck in the admin wallet
 * (these were deployed before the defaultFrozen unfreeze fix was in place).
 *
 * For each target asset this script:
 *   1. Deploys a new TokenVault contract
 *   2. Funds + opts vault into the ASA
 *   3. Unfreezes vault for the ASA
 *   4. Transfers ALL tokens from admin wallet → vault
 *   5. Updates the DB with the new vaultContractId
 *
 * Usage:
 *   npx ts-node --esm scripts/recover-stuck-vaults.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import algosdk from 'algosdk';
import { PrismaClient } from '../node_modules/.prisma/asset-client/index.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ADMIN_MNEMONIC = process.env.ALGORAND_ADMIN_MNEMONIC ?? '';
const ALGOD_SERVER = process.env.ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
const ALGOD_PORT = Number(process.env.ALGORAND_ALGOD_PORT ?? 443);
const ALGOD_TOKEN = process.env.ALGORAND_ALGOD_TOKEN ?? '';

// Assets whose tokens are stuck in admin wallet — update if you add more
const STUCK_ASSETS = [
  { ticker: 'AGOLD', asaId: 762558669 },
  { ticker: 'XSIL',  asaId: 762561320 },
];

async function deployVaultForAsset(
  algod: algosdk.Algodv2,
  admin: algosdk.Account,
  asaId: number,
  totalSupply: bigint,
): Promise<number> {
  const approvalPath = path.resolve(
    process.cwd(), 'contracts/token-vault/src/out/TokenVault.approval.teal',
  );
  const clearPath = path.resolve(
    process.cwd(), 'contracts/token-vault/src/out/TokenVault.clear.teal',
  );
  const approvalTeal = fs.readFileSync(approvalPath, 'utf-8');
  const clearTeal    = fs.readFileSync(clearPath, 'utf-8');

  const approvalResult = await algod.compile(approvalTeal).do();
  const clearResult    = await algod.compile(clearTeal).do();
  const approval = new Uint8Array(Buffer.from(approvalResult.result, 'base64'));
  const clear    = new Uint8Array(Buffer.from(clearResult.result, 'base64'));

  const adminPk = algosdk.decodeAddress(admin.addr.toString()).publicKey;
  const sp = await algod.getTransactionParams().do();

  // 1. Deploy vault contract
  const deployTxn = algosdk.makeApplicationCreateTxnFromObject({
    sender: admin.addr.toString(),
    approvalProgram: approval,
    clearProgram: clear,
    numGlobalInts: 3,
    numGlobalByteSlices: 1,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    suggestedParams: sp,
    appArgs: [
      Buffer.from('1fc4f1f3', 'hex'),
      adminPk,
      algosdk.encodeUint64(asaId),
      algosdk.encodeUint64(totalSupply),
    ],
  });
  const { txid: deployTxid } = await algod.sendRawTransaction(deployTxn.signTxn(admin.sk)).do();
  const deployConfirm = await algosdk.waitForConfirmation(algod, deployTxid, 4);
  const appId = Number(deployConfirm.applicationIndex ?? deployConfirm['application-index']);
  const vaultAddress = algosdk.getApplicationAddress(appId);
  console.log(`  Vault deployed: appId=${appId} addr=${vaultAddress}`);

  // 2. Fund vault + opt into ASA (atomic group)
  const sp2 = await algod.getTransactionParams().do();
  const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: admin.addr.toString(),
    receiver: vaultAddress,
    amount: 300_000n,
    suggestedParams: sp2,
  });
  const optInTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: admin.addr.toString(),
    appIndex: appId,
    appArgs: [Buffer.from('bb757b1c', 'hex')],
    foreignAssets: [asaId],
    suggestedParams: { ...sp2, flatFee: true, fee: 2000 },
  });
  algosdk.assignGroupID([fundTxn, optInTxn]);
  const { txid: groupTxid } = await algod.sendRawTransaction(
    [fundTxn, optInTxn].map((t) => t.signTxn(admin.sk)),
  ).do();
  await algosdk.waitForConfirmation(algod, groupTxid, 4);
  console.log(`  Vault funded and opted into ASA ${asaId}`);

  // 3. Unfreeze vault for the ASA (defaultFrozen=true means opt-in froze it)
  const sp3 = await algod.getTransactionParams().do();
  const unfreezeTxn = algosdk.makeAssetFreezeTxnWithSuggestedParamsFromObject({
    sender: admin.addr.toString(),
    assetIndex: asaId,
    freezeTarget: vaultAddress.toString(),
    frozen: false,
    suggestedParams: sp3,
  });
  const { txid: unfreezeTxid } = await algod.sendRawTransaction(unfreezeTxn.signTxn(admin.sk)).do();
  await algosdk.waitForConfirmation(algod, unfreezeTxid, 4);
  console.log(`  Vault unfrozen for ASA ${asaId}`);

  // 4. Transfer all tokens from admin → vault
  const adminInfo = await algod.accountAssetInformation(admin.addr, asaId).do();
  const holding = (adminInfo as any).assetHolding ?? (adminInfo as any)['asset-holding'];
  const adminBalance = BigInt(holding?.amount ?? 0);
  if (adminBalance === 0n) {
    console.log(`  Admin has 0 tokens of ASA ${asaId} — skipping transfer`);
    return appId;
  }

  const sp4 = await algod.getTransactionParams().do();
  const transferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: admin.addr.toString(),
    receiver: vaultAddress,
    assetIndex: asaId,
    amount: adminBalance,
    suggestedParams: sp4,
  });
  const { txid: transferTxid } = await algod.sendRawTransaction(transferTxn.signTxn(admin.sk)).do();
  await algosdk.waitForConfirmation(algod, transferTxid, 4);
  console.log(`  Transferred ${adminBalance} tokens to vault (txId=${transferTxid})`);

  return appId;
}

async function main() {
  if (!ADMIN_MNEMONIC) throw new Error('ALGORAND_ADMIN_MNEMONIC not set');
  const algod  = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
  const admin  = algosdk.mnemonicToSecretKey(ADMIN_MNEMONIC);
  const prisma = new PrismaClient();

  for (const { ticker, asaId } of STUCK_ASSETS) {
    console.log(`\nRecovering ${ticker} (ASA ${asaId})…`);

    const asset = await (prisma as any).asset.findFirst({ where: { ticker } });
    if (!asset) { console.log(`  ${ticker} not found in DB — skipping`); continue; }
    if (asset.vaultContractId) { console.log(`  ${ticker} already has vaultContractId=${asset.vaultContractId} — skipping`); continue; }

    const totalSupply = BigInt(asset.totalSupply ?? 0);
    const vaultAppId = await deployVaultForAsset(algod, admin, asaId, totalSupply);

    await (prisma as any).asset.update({
      where: { id: asset.id },
      data: { vaultContractId: vaultAppId },
    });
    console.log(`  DB updated: ${ticker} vaultContractId=${vaultAppId}`);
  }

  await prisma.$disconnect();
  console.log('\nDone.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
