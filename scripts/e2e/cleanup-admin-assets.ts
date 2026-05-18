/**
 * Utility: close admin out of all empty/LP ASA holdings from previous test runs
 * to reclaim minimum balance ALGO. Run before test suite when admin is low on ALGO.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import algosdk from 'algosdk';

const ALGOD_SERVER = 'https://testnet-api.algonode.cloud';
const USDC_ASA_ID = 10458941;

async function main() {
  const mnemonic = process.env.ALGORAND_ADMIN_MNEMONIC ?? '';
  if (!mnemonic) throw new Error('ALGORAND_ADMIN_MNEMONIC not set');
  
  const adminAccount = algosdk.mnemonicToSecretKey(mnemonic);
  const adminAddr = adminAccount.addr.toString();
  const algod = new algosdk.Algodv2('', ALGOD_SERVER, 443);
  
  console.log(`Admin: ${adminAddr}`);
  
  const info = await algod.accountInformation(adminAddr).do();
  const balance = Number((info as any).amount ?? 0);
  const minBalance = Number((info as any)['min-balance'] ?? 0);
  const assets: any[] = (info as any).assets ?? [];
  
  console.log(`Balance: ${balance/1e6} ALGO, MinBalance: ${minBalance/1e6} ALGO, Assets: ${assets.length}`);
  
  // Close out any ASA with amount=0 (empty opt-ins) except USDC
  const emptyHoldings = assets.filter((a: any) => {
    const amount = Number(a.amount ?? 0);
    const asaId = Number(a['asset-id'] ?? a.assetId ?? 0);
    return amount === 0 && asaId !== USDC_ASA_ID;
  });
  
  console.log(`Found ${emptyHoldings.length} empty ASA holdings to close out...`);
  
  for (const holding of emptyHoldings) {
    const asaId = Number(holding['asset-id'] ?? holding.assetId ?? 0);
    try {
      const sp = await algod.getTransactionParams().do();
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: adminAddr,
        receiver: adminAddr,
        assetIndex: asaId,
        amount: 0,
        closeRemainderTo: adminAddr,
        suggestedParams: sp,
      });
      const { txid } = await algod.sendRawTransaction(txn.signTxn(adminAccount.sk)).do();
      await algosdk.waitForConfirmation(algod, txid, 4);
      console.log(`  ✅ Closed out ASA ${asaId}`);
    } catch (err: any) {
      console.log(`  ⚠️  Failed ASA ${asaId}: ${err.message.split('\n')[0]}`);
    }
  }
  
  const infoAfter = await algod.accountInformation(adminAddr).do();
  const balAfter = Number((infoAfter as any).amount ?? 0);
  const minBalAfter = Number((infoAfter as any)['min-balance'] ?? 0);
  const assetsAfter: any[] = (infoAfter as any).assets ?? [];
  
  console.log(`\nAfter: Balance=${balAfter/1e6} ALGO, MinBalance=${minBalAfter/1e6} ALGO, Assets=${assetsAfter.length}, Spendable=${(balAfter-minBalAfter)/1e6} ALGO`);
}

main().catch(console.error);
