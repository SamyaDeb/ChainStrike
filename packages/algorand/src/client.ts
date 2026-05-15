import algosdk from 'algosdk';
import { AlgorandNodeConfig } from '@chainstrike/types';

let algodClient: algosdk.Algodv2 | null = null;
let indexerClient: algosdk.Indexer | null = null;

export function getAlgodClient(config: AlgorandNodeConfig): algosdk.Algodv2 {
  if (!algodClient) {
    algodClient = new algosdk.Algodv2(
      config.token,
      `${config.host}`,
      config.port,
    );
  }
  return algodClient;
}

export function getIndexerClient(config: {
  host: string;
  port: number;
  token: string;
}): algosdk.Indexer {
  if (!indexerClient) {
    indexerClient = new algosdk.Indexer(config.token, config.host, config.port);
  }
  return indexerClient;
}

export async function waitForConfirmation(
  algod: algosdk.Algodv2,
  txId: string,
  maxRounds = 5,
): Promise<algosdk.modelsv2.PendingTransactionResponse> {
  const status = await algod.status().do();
  let lastRound = status['last-round'];

  while (true) {
    const pendingInfo = await algod.pendingTransactionInformation(txId).do();

    if (pendingInfo['confirmed-round'] && pendingInfo['confirmed-round'] > 0) {
      return pendingInfo;
    }

    if (pendingInfo['pool-error'] && pendingInfo['pool-error'].length > 0) {
      throw new Error(`Transaction rejected: ${pendingInfo['pool-error']}`);
    }

    lastRound++;
    if (lastRound > (pendingInfo['last-valid'] ?? lastRound) + maxRounds) {
      throw new Error(`Transaction ${txId} not confirmed after ${maxRounds} rounds`);
    }

    await algod.statusAfterBlock(lastRound).do();
  }
}

export async function getNetworkParams(algod: algosdk.Algodv2) {
  const params = await algod.getTransactionParams().do();
  return params;
}
