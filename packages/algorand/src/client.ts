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
): Promise<Record<string, unknown>> {
  // algosdk v3 uses bigint for round numbers. Delegate to algosdk's own implementation
  // which handles type coercion correctly, then convert to plain Record for compatibility.
  const result = await algosdk.waitForConfirmation(algod, txId, maxRounds);
  return result as unknown as Record<string, unknown>;
}

export async function getNetworkParams(algod: algosdk.Algodv2) {
  const params = await algod.getTransactionParams().do();
  return params;
}
