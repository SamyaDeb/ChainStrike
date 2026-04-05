import algosdk from "algosdk";
import { CURRENT_NETWORK } from "@/config/networks";

/**
 * Algod client for interacting with the Algorand blockchain
 */
export const getAlgodClient = (): algosdk.Algodv2 => {
  return new algosdk.Algodv2(
    CURRENT_NETWORK.algodToken || "",
    CURRENT_NETWORK.algodServer,
    CURRENT_NETWORK.algodPort || 443
  );
};

/**
 * Indexer client for querying blockchain data
 */
export const getIndexerClient = (): algosdk.Indexer => {
  const indexerPort =
    "indexerPort" in CURRENT_NETWORK
      ? CURRENT_NETWORK.indexerPort
      : CURRENT_NETWORK.algodPort || 443;

  return new algosdk.Indexer(
    CURRENT_NETWORK.algodToken || "",
    CURRENT_NETWORK.indexerServer,
    indexerPort
  );
};

/**
 * Get suggested transaction parameters
 */
export const getSuggestedParams = async (): Promise<algosdk.SuggestedParams> => {
  const algodClient = getAlgodClient();
  return await algodClient.getTransactionParams().do();
};

/**
 * Wait for transaction confirmation
 */
export const waitForConfirmation = async (
  txId: string,
  timeout = 4
): Promise<algosdk.modelsv2.PendingTransactionResponse> => {
  const algodClient = getAlgodClient();
  const status = await algosdk.waitForConfirmation(algodClient, txId, timeout);
  return status;
};

/**
 * Get account information
 */
export const getAccountInfo = async (
  address: string
): Promise<algosdk.modelsv2.Account> => {
  const algodClient = getAlgodClient();
  return await algodClient.accountInformation(address).do();
};

/**
 * Get account balance in microAlgos
 */
export const getAccountBalance = async (address: string): Promise<bigint> => {
  const accountInfo = await getAccountInfo(address);
  return accountInfo.amount;
};

/**
 * Get application information
 */
export const getApplicationInfo = async (
  appId: number
): Promise<algosdk.modelsv2.Application> => {
  const algodClient = getAlgodClient();
  return await algodClient.getApplicationByID(appId).do();
};

/**
 * Get asset information
 */
export const getAssetInfo = async (
  assetId: number
): Promise<algosdk.modelsv2.Asset> => {
  const algodClient = getAlgodClient();
  return await algodClient.getAssetByID(assetId).do();
};

/**
 * Get account's asset holdings
 */
export const getAccountAssets = async (
  address: string
): Promise<algosdk.modelsv2.AssetHolding[]> => {
  const accountInfo = await getAccountInfo(address);
  return accountInfo.assets || [];
};

/**
 * Get account's opted-in applications
 */
export const getAccountApplications = async (
  address: string
): Promise<algosdk.modelsv2.ApplicationLocalState[]> => {
  const accountInfo = await getAccountInfo(address);
  return accountInfo.appsLocalState || [];
};

/**
 * Check if account has opted into an application
 */
export const isOptedIntoApp = async (
  address: string,
  appId: number
): Promise<boolean> => {
  const apps = await getAccountApplications(address);
  return apps.some((app) => Number(app.id) === appId);
};

/**
 * Check if account has opted into an asset
 */
export const isOptedIntoAsset = async (
  address: string,
  assetId: number
): Promise<boolean> => {
  const assets = await getAccountAssets(address);
  return assets.some((asset) => Number(asset.assetId) === assetId);
};

/**
 * Get application global state
 */
export const getAppGlobalState = async (
  appId: number
): Promise<Record<string, algosdk.modelsv2.TealValue>> => {
  const appInfo = await getApplicationInfo(appId);
  const globalState = appInfo.params.globalState || [];

  const state: Record<string, algosdk.modelsv2.TealValue> = {};
  for (const kv of globalState) {
    // Key is Uint8Array, convert to string
    const key = new TextDecoder().decode(kv.key);
    state[key] = kv.value;
  }

  return state;
};

/**
 * Get application local state for an account
 */
export const getAppLocalState = async (
  address: string,
  appId: number
): Promise<Record<string, algosdk.modelsv2.TealValue> | null> => {
  const apps = await getAccountApplications(address);
  const app = apps.find((a) => Number(a.id) === appId);

  if (!app || !app.keyValue) {
    return null;
  }

  const state: Record<string, algosdk.modelsv2.TealValue> = {};
  for (const kv of app.keyValue) {
    // Key is Uint8Array, convert to string
    const key = new TextDecoder().decode(kv.key);
    state[key] = kv.value;
  }

  return state;
};

/**
 * Decode a uint64 value from TealValue
 */
export const decodeUint64 = (value: algosdk.modelsv2.TealValue): bigint => {
  if (value.type === 2) {
    // uint type
    return value.uint || BigInt(0);
  }
  return BigInt(0);
};

/**
 * Decode a bytes value from TealValue
 */
export const decodeBytes = (value: algosdk.modelsv2.TealValue): string => {
  if (value.type === 1 && value.bytes) {
    // bytes type - Uint8Array, convert to string
    return new TextDecoder().decode(value.bytes);
  }
  return "";
};

/**
 * Decode an address from TealValue
 */
export const decodeAddress = (value: algosdk.modelsv2.TealValue): string => {
  if (value.type === 1 && value.bytes) {
    // bytes type - already Uint8Array
    return algosdk.encodeAddress(value.bytes);
  }
  return "";
};
