import algosdk from 'algosdk';
import { SettlementTxGroup } from '@chainstrike/types';

// ─────────────────────────────────────────────────────────────────────────────
// Atomic Settlement Transaction Group
//
// Group structure:
//   Txn 0 — ASA transfer: seller → buyer (token)         [seller signs]
//   Txn 1 — USDC transfer: admin → seller (payment)      [admin signs — custodial]
//   Txn 2 — USDC transfer: admin → treasury (fee)        [admin signs — custodial]
//
// Optional (with settlement contract deployed):
//   + Txn 3 — App call: settlement contract records trade event on-chain [admin signs]
//
// ALL must succeed or ALL fail.
// ─────────────────────────────────────────────────────────────────────────────

export function buildSettlementGroup(
  params: SettlementTxGroup,
  suggestedParams: algosdk.SuggestedParams,
  settlementContractId: number,
  usdcAsaId: number,
): algosdk.Transaction[] {
  const note = new TextEncoder().encode(
    JSON.stringify({ platform: 'chainstrike', tradeId: params.tradeId }),
  );

  // Txn 0: Token transfer — seller sends RWA tokens to buyer
  const tokenTransfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: params.sellerAddress,
    receiver: params.buyerAddress,
    assetIndex: params.asaId,
    amount: params.tokenAmount,
    suggestedParams,
    note,
  });

  // Txn 1: USDC transfer — admin (custodian) pays seller from held USDC
  const paymentToSeller = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: params.adminAddress,
    receiver: params.sellerAddress,
    assetIndex: usdcAsaId,
    amount: params.usdcAmount - params.platformFee,
    suggestedParams,
  });

  // Txn 2: Platform fee — admin sends USDC fee to treasury
  const platformFee = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: params.adminAddress,
    receiver: params.treasuryAddress,
    assetIndex: usdcAsaId,
    amount: params.platformFee,
    suggestedParams,
  });

  const txns = [tokenTransfer, paymentToSeller, platformFee];

  // Txn 3: App call — records trade on-chain for immutable audit trail (optional)
  if (settlementContractId > 0) {
    const tradeRecord = algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.buyerAddress,
      appIndex: settlementContractId,
      appArgs: [
        new TextEncoder().encode('record_trade'),
        algosdk.encodeUint64(params.asaId),
        algosdk.encodeUint64(params.usdcAmount),
        algosdk.encodeUint64(params.tokenAmount),
      ],
      accounts: [params.sellerAddress],
      suggestedParams,
    });
    txns.push(tradeRecord);
  }

  // Assign atomic group ID — all txns are linked
  return algosdk.assignGroupID(txns);
}

// ─── USDC escrow lock (buy order placement) ───────────────────────────────────
// When a buy limit order is accepted, USDC is locked in the Escrow Contract.
// This prevents double-spending the same funds across multiple orders.

export function buildEscrowLockTransaction(
  buyerAddress: string,
  escrowContractAddress: string,
  usdcAsaId: number,
  amount: bigint,
  orderId: string,
  suggestedParams: algosdk.SuggestedParams,
): algosdk.Transaction {
  const note = new TextEncoder().encode(
    JSON.stringify({ action: 'lock_escrow', orderId }),
  );

  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: buyerAddress,
    receiver: escrowContractAddress,
    assetIndex: usdcAsaId,
    amount,
    suggestedParams,
    note,
  });
}

// ─── USDC escrow release (order cancellation) ─────────────────────────────────

export function buildEscrowReleaseTransaction(
  escrowContractId: number,
  buyerAddress: string,
  usdcAsaId: number,
  amount: bigint,
  orderId: string,
  suggestedParams: algosdk.SuggestedParams,
): algosdk.Transaction {
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender: buyerAddress,
    appIndex: escrowContractId,
    appArgs: [
      new TextEncoder().encode('release_escrow'),
      new TextEncoder().encode(orderId),
    ],
    foreignAssets: [usdcAsaId],
    suggestedParams,
  });
}

// ─── Compute platform fee ─────────────────────────────────────────────────────

export function computePlatformFee(
  usdcAmount: bigint,
  feeRate: number,
  minFee: bigint,
): bigint {
  const fee = BigInt(Math.floor(Number(usdcAmount) * feeRate));
  return fee < minFee ? minFee : fee;
}
