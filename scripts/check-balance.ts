import algosdk from 'algosdk';

const client = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);
const ADMIN_ADDR = 'HMPG7YLTESN4FQXIGCAHQOXDEIDUIFBOINJDGQ7WUFBTYMOIKDIN6CITPM';

(async () => {
  const info = await client.accountInformation(ADMIN_ADDR).do();
  const balance = Number(info.amount) / 1e6;
  console.log(`Current ALGO balance: ${balance} ALGO`);
  console.log('\nTo fund admin wallet, visit: https://bank.testnet.algorand.network');
  console.log(`Wallet address: ${ADMIN_ADDR}\n`);
})();
