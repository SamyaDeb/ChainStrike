import algosdk from 'algosdk';
import * as dotenv from 'dotenv';

dotenv.config();

const client = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);
const indexer = new algosdk.Indexer('', 'https://testnet-idx.algonode.cloud', 443);

const USDC_ASA_ID = 10458941;
const ADMIN_ADDR = 'HMPG7YLTESN4FQXIGCAHQOXDEIDUIFBOINJDGQ7WUFBTYMOIKDIN6CITPM';
const TREASURY_ADDR = 'QYVDPEHEZ5FJGAQNZVDRFR5HDXFKJHOQBO4FX6VKGG6HXLD5X6VEGD65U4';

async function fundAdmin() {
  try {
    console.log('\n📊 Checking balances...\n');

    const adminInfo = await client.accountInformation(ADMIN_ADDR).do();
    const treasuryInfo = await client.accountInformation(TREASURY_ADDR).do();

    const adminAlgo = Number(adminInfo.amount) / 1e6;
    const treasuryAlgo = Number(treasuryInfo.amount) / 1e6;

    const adminUsdc = (adminInfo.assets as any[])?.find((a: any) => a['asset-id'] === USDC_ASA_ID);
    const treasuryUsdc = (treasuryInfo.assets as any[])?.find((a: any) => a['asset-id'] === USDC_ASA_ID);

    console.log(`Admin Wallet (${ADMIN_ADDR}):`);
    console.log(`  ALGO: ${adminAlgo} ALGO`);
    console.log(`  USDC: ${adminUsdc ? Number(adminUsdc.amount) / 1e6 : 0} USDC\n`);

    console.log(`Treasury Wallet (${TREASURY_ADDR}):`);
    console.log(`  ALGO: ${treasuryAlgo} ALGO`);
    console.log(`  USDC: ${treasuryUsdc ? Number(treasuryUsdc.amount) / 1e6 : 0} USDC\n`);

    // Check if Treasury has USDC
    if (!treasuryUsdc || Number(treasuryUsdc.amount) === 0) {
      console.log('❌ Treasury wallet has no USDC. Need to fund from external source.\n');
      console.log('Testnet USDC sources:');
      console.log('  1. Algorand testnet faucet: https://testnet.algoexplorer.io/dispenser');
      console.log('  2. Request on Algorand Foundation Discord');
      console.log('  3. Use an existing testnet account with USDC\n');
      return;
    }

    console.log(`✅ Treasury has ${Number(treasuryUsdc.amount) / 1e6} USDC\n`);

    // If admin is not opted in, opt in first
    if (!adminUsdc) {
      console.log('⏳ Admin wallet not opted into USDC. Creating opt-in transaction...\n');

      const mnemonic = process.env['ALGORAND_ADMIN_MNEMONIC'];
      if (!mnemonic) {
        console.error('❌ ALGORAND_ADMIN_MNEMONIC not set in .env');
        return;
      }

      const account = algosdk.mnemonicToSecretKey(mnemonic);
      const params = await client.getTransactionParams().do();

      const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParams(
        account.addr,
        account.addr,
        undefined,
        0,
        USDC_ASA_ID,
        params,
      );

      const signed = optInTxn.signTxn(account.sk);
      const txId = await client.sendRawTransaction(signed).do();
      console.log(`✅ Opt-in transaction sent: ${txId.txId}`);
      console.log('⏳ Waiting for confirmation...\n');
      await algosdk.waitForConfirmation(client, txId.txId, 4);
      console.log('✅ Admin account opted into USDC\n');
    }

    // Now fund admin with USDC from treasury
    console.log(`💸 Funding admin with 50 USDC from treasury...\n`);

    const treasuryMnemonic = process.env['TREASURY_MNEMONIC'];
    if (!treasuryMnemonic) {
      console.error('❌ TREASURY_MNEMONIC not set in .env');
      return;
    }

    const treasuryAccount = algosdk.mnemonicToSecretKey(treasuryMnemonic);
    const params = await client.getTransactionParams().do();

    const transferTxn = algosdk.makeAssetTransferTxnWithSuggestedParams(
      treasuryAccount.addr,
      ADMIN_ADDR,
      undefined,
      BigInt(50 * 1e6), // 50 USDC
      USDC_ASA_ID,
      params,
    );

    const signed = transferTxn.signTxn(treasuryAccount.sk);
    const txId = await client.sendRawTransaction(signed).do();
    console.log(`✅ Transfer transaction sent: ${txId.txId}`);
    console.log('⏳ Waiting for confirmation...\n');
    await algosdk.waitForConfirmation(client, txId.txId, 4);

    // Verify final balance
    const finalAdminInfo = await client.accountInformation(ADMIN_ADDR).do();
    const finalUsdc = (finalAdminInfo.assets as any[])?.find((a: any) => a['asset-id'] === USDC_ASA_ID);
    const finalBalance = finalUsdc ? Number(finalUsdc.amount) / 1e6 : 0;

    console.log(`✅ Admin wallet funded successfully!`);
    console.log(`   USDC Balance: ${finalBalance} USDC\n`);

  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
  }
}

fundAdmin();
