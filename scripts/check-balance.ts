import algosdk from 'algosdk';

const client = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);
const USDC_ASA_ID = 10458941;
const ADMIN_ADDR = 'HMPG7YLTESN4FQXIGCAHQOXDEIDUIFBOINJDGQ7WUFBTYMOIKDIN6CITPM';

(async () => {
  try {
    const info = await client.accountInformation(ADMIN_ADDR).do();
    const algoBalance = Number(info.amount) / 1e6;
    console.log(`Admin Wallet: ${ADMIN_ADDR}`);
    console.log(`Algo Balance: ${algoBalance} ALGO`);

    const usdc = (info.assets as any[])?.find((a: any) => a['asset-id'] === USDC_ASA_ID);
    if (usdc) {
      const usdcBalance = Number(usdc.amount) / 1e6;
      console.log(`USDC Balance: ${usdcBalance} USDC`);
    } else {
      console.log('USDC Balance: 0 USDC (not opted in)');
    }
  } catch (err) {
    console.error('Error:', (err as Error).message);
  }
})();
