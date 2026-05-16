import * as dotenv from 'dotenv';
dotenv.config();

import algosdk from 'algosdk';

const algodToken = process.env.ALGORAND_ALGOD_TOKEN ?? '';
const algodServer = process.env.ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
const algodPort = parseInt(process.env.ALGORAND_ALGOD_PORT ?? '443');
const client = new algosdk.Algodv2(algodToken, algodServer, algodPort);

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
      console.log('To fund testnet USDC, use Circle faucet:');
      console.log('  https://faucet.circle.com/algorand\n');
      console.log('Then re-run this script.\n');
      return;
    }

    console.log(`✅ Treasury has ${Number(treasuryUsdc.amount) / 1e6} USDC\n`);

    const adminMnemonic = process.env['ALGORAND_ADMIN_MNEMONIC'];
    if (!adminMnemonic) {
      console.error('❌ ALGORAND_ADMIN_MNEMONIC not set in .env');
      return;
    }

    // If admin is not opted in, opt in first
    if (!adminUsdc) {
      console.log('⏳ Admin wallet not opted into USDC. Creating opt-in transaction...\n');

      const account = algosdk.mnemonicToSecretKey(adminMnemonic);
      const params = await client.getTransactionParams().do();

      const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: account.addr,
        receiver: account.addr,
        assetIndex: USDC_ASA_ID,
        amount: 0n,
        suggestedParams: params,
        note: new TextEncoder().encode('ChainStrike E2E — USDC opt-in'),
      });

      const signed = optInTxn.signTxn(account.sk);
      const { txid } = await client.sendRawTransaction(signed).do();
      console.log(`✅ Opt-in transaction sent: ${txid}`);
      console.log('⏳ Waiting for confirmation...\n');
      await algosdk.waitForConfirmation(client, txid, 4);
      console.log('✅ Admin account opted into USDC\n');
    }

    // Now fund admin with USDC from treasury
    console.log(`💸 Funding admin with 20 USDC from treasury...\n`);

    const treasuryMnemonic = process.env['TREASURY_MNEMONIC'];
    if (!treasuryMnemonic) {
      console.error('❌ TREASURY_MNEMONIC not set in .env');
      return;
    }

    const treasuryAccount = algosdk.mnemonicToSecretKey(treasuryMnemonic);
    const params = await client.getTransactionParams().do();

    const transferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: treasuryAccount.addr,
      receiver: ADMIN_ADDR,
      assetIndex: USDC_ASA_ID,
      amount: BigInt(20 * 1e6), // 20 USDC
      suggestedParams: params,
      note: new TextEncoder().encode('ChainStrike E2E — admin funding'),
    });

    const signed = transferTxn.signTxn(treasuryAccount.sk);
    const { txid } = await client.sendRawTransaction(signed).do();
    console.log(`✅ Transfer transaction sent: ${txid}`);
    console.log('⏳ Waiting for confirmation...\n');
    await algosdk.waitForConfirmation(client, txid, 4);

    // Verify final balance
    const finalAdminInfo = await client.accountInformation(ADMIN_ADDR).do();
    const finalUsdc = (finalAdminInfo.assets as any[])?.find((a: any) => a['asset-id'] === USDC_ASA_ID);
    const finalBalance = finalUsdc ? Number(finalUsdc.amount) / 1e6 : 0;

    console.log(`✅ Admin wallet funded successfully!`);
    console.log(`   USDC Balance: ${finalBalance} USDC\n`);

  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    console.error('\nNote: Treasury wallet needs USDC to fund admin.');
    console.error('If Treasury is empty, fund it using Circle testnet faucet:');
    console.error('  https://faucet.circle.com/algorand\n');
  }
}

fundAdmin();
