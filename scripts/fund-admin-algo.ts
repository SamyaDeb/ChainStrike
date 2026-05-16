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

async function fundAdminAlgo() {
  try {
    console.log('\n📊 Checking Algo balances...\n');

    const adminInfo = await client.accountInformation(ADMIN_ADDR).do();
    const treasuryInfo = await client.accountInformation(TREASURY_ADDR).do();

    const adminAlgo = Number(adminInfo.amount) / 1e6;
    const treasuryAlgo = Number(treasuryInfo.amount) / 1e6;

    console.log(`Admin Wallet: ${adminAlgo} ALGO`);
    console.log(`Treasury Wallet: ${treasuryAlgo} ALGO\n`);

    if (treasuryAlgo < 1) {
      console.log('❌ Treasury wallet has no Algo to send. Please fund it from the testnet faucet:');
      console.log('  https://bank.testnet.algorand.network\n');
      return;
    }

    console.log(`💸 Sending 1 ALGO from treasury to admin...\n`);

    const treasuryMnemonic = process.env['TREASURY_MNEMONIC'];
    if (!treasuryMnemonic) {
      console.error('❌ TREASURY_MNEMONIC not set in .env');
      return;
    }

    const treasuryAccount = algosdk.mnemonicToSecretKey(treasuryMnemonic);
    const params = await client.getTransactionParams().do();

    const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: treasuryAccount.addr,
      receiver: ADMIN_ADDR,
      amount: 1_000_000n, // 1 ALGO
      suggestedParams: params,
      note: new TextEncoder().encode('ChainStrike E2E — admin Algo funding'),
    });

    const signed = paymentTxn.signTxn(treasuryAccount.sk);
    const { txid } = await client.sendRawTransaction(signed).do();
    console.log(`✅ Transaction sent: ${txid}`);
    console.log('⏳ Waiting for confirmation...\n');
    await algosdk.waitForConfirmation(client, txid, 4);

    // Verify final balance
    const finalAdminInfo = await client.accountInformation(ADMIN_ADDR).do();
    const finalBalance = Number(finalAdminInfo.amount) / 1e6;

    console.log(`✅ Admin wallet funded successfully!`);
    console.log(`   ALGO Balance: ${finalBalance} ALGO\n`);

  } catch (err) {
    console.error('❌ Error:', (err as Error).message);
    console.error('\nTo fund testnet Algo, use the faucet:');
    console.error('  https://bank.testnet.algorand.network\n');
  }
}

fundAdminAlgo();
