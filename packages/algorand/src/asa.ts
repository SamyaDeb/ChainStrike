import algosdk from 'algosdk';
import { AsaCreateParams, AsaInfo } from '@chainstrike/types';

// ─── Create a new ASA (RWA token) ─────────────────────────────────────────────
// All RWA tokens MUST have:
//   - defaultFrozen: true  (investors must be whitelisted before receiving)
//   - managerAddress set  (platform admin multi-sig)
//   - freezeAddress set   (compliance master)
//   - clawbackAddress set (compliance master)

export async function buildAsaCreateTransaction(
  algod: algosdk.Algodv2,
  params: AsaCreateParams,
): Promise<algosdk.Transaction> {
  const suggestedParams = await algod.getTransactionParams().do();

  if (!params.defaultFrozen) {
    throw new Error('RWA tokens MUST have defaultFrozen=true for compliance enforcement');
  }

  return algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    sender: params.creator,
    total: params.total,
    decimals: params.decimals,
    defaultFrozen: true,
    unitName: params.unitName,
    assetName: params.assetName,
    assetURL: params.url,
    assetMetadataHash: params.metadataHash,
    manager: params.managerAddress,
    reserve: params.reserveAddress,
    freeze: params.freezeAddress,
    clawback: params.clawbackAddress,
    suggestedParams,
  });
}

// ─── Freeze / Unfreeze an account's holding ───────────────────────────────────
// Called by Compliance Service when whitelist status changes.
// The freeze address (compliance master) must sign this transaction.

export function buildFreezeTransaction(
  algod: algosdk.Algodv2,
  freezeAddress: string,
  targetAddress: string,
  asaId: number,
  newFreezeState: boolean,
  suggestedParams: algosdk.SuggestedParams,
): algosdk.Transaction {
  return algosdk.makeAssetFreezeTxnWithSuggestedParamsFromObject({
    sender: freezeAddress,
    assetIndex: asaId,
    freezeTarget: targetAddress,
    frozen: newFreezeState,
    suggestedParams,
  });
}

// ─── Clawback tokens from an account ─────────────────────────────────────────
// Used under regulatory direction only. Requires clawback address signature
// (compliance master multi-sig) and a multi-sig governance vote.

export function buildClawbackTransaction(
  clawbackAddress: string,
  revokeTarget: string,
  receiver: string,
  asaId: number,
  amount: bigint,
  suggestedParams: algosdk.SuggestedParams,
): algosdk.Transaction {
  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: clawbackAddress,
    receiver: receiver,
    assetSender: revokeTarget,
    assetIndex: asaId,
    amount,
    suggestedParams,
  });
}

// ─── Opt-in to ASA ────────────────────────────────────────────────────────────
// Investors must opt-in before receiving RWA tokens.
// Signed by the investor's wallet.

export function buildOptInTransaction(
  address: string,
  asaId: number,
  suggestedParams: algosdk.SuggestedParams,
): algosdk.Transaction {
  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: address,
    receiver: address,
    assetIndex: asaId,
    amount: 0n,
    suggestedParams,
  });
}

// ─── Query ASA info ───────────────────────────────────────────────────────────

export async function getAsaInfo(algod: algosdk.Algodv2, asaId: number): Promise<AsaInfo> {
  const info = await algod.getAssetByID(asaId).do();
  const p = info.params;

  return {
    asaId,
    name: p.name ?? '',
    unitName: p.unitName ?? p['unit-name'] ?? '',
    total: BigInt(p.total),
    decimals: p.decimals,
    defaultFrozen: p.defaultFrozen ?? p['default-frozen'] ?? false,
    creator: p.creator,
    manager: p.manager,
    reserve: p.reserve,
    freeze: p.freeze,
    clawback: p.clawback,
    url: p.url,
    metadataHash: p.metadataHash ? Buffer.from(p.metadataHash as Uint8Array).toString('hex') : p['metadata-hash']
      ? Buffer.from(p['metadata-hash']).toString('hex')
      : undefined,
  };
}

// ─── Check if account has opted in ───────────────────────────────────────────

export async function hasOptedIn(
  algod: algosdk.Algodv2,
  address: string,
  asaId: number,
): Promise<boolean> {
  try {
    const info = await algod.accountAssetInformation(address, asaId).do();
    // algosdk v3: assetHolding (camelCase); v2: asset-holding (kebab)
    return (info.assetHolding ?? info['asset-holding']) !== undefined;
  } catch {
    return false;
  }
}

// ─── Get token balance ────────────────────────────────────────────────────────

export async function getTokenBalance(
  algod: algosdk.Algodv2,
  address: string,
  asaId: number,
): Promise<bigint> {
  try {
    const info = await algod.accountAssetInformation(address, asaId).do();
    // algosdk v3: assetHolding (camelCase); v2: asset-holding (kebab)
    const holding = info.assetHolding ?? info['asset-holding'];
    return BigInt(holding?.amount ?? 0);
  } catch {
    return 0n;
  }
}
