import algosdk from 'algosdk';
import { SettlementTxGroup } from '@chainstrike/types';

// ─────────────────────────────────────────────────────────────────────────────
// Atomic Settlement Transaction Group
//
// RWA tokens are created with defaultFrozen=true and admin as clawback address.
// Regular transfers are rejected by Algorand for frozen assets.
// All transactions are signed by the admin (platform custodian):
//
//   Txn 0 — ASA clawback: admin revokes tokens from seller → buyer [admin signs]
//   Txn 1 — USDC transfer: admin → seller (payment from buyer's locked USDC) [admin signs]
//   Txn 2 — USDC transfer: admin → treasury (fee)                           [admin signs]
//
// Optional (with settlement contract deployed):
//   + Txn 3 — App call: settlement contract records trade event on-chain [admin signs]
//
// ALL must succeed or ALL fail.
// ─────────────────────────────────────────────────────────────────────────────

// ARC-4 method selectors (SHA-512/256 of method signature, first 4 bytes)
const ESCROW_RELEASE_TO_SELLER_METHOD = algosdk.ABIMethod.fromSignature(
  'releaseToSeller(byte[],address,uint64,address,uint64)void',
);

export function buildSettlementGroup(
  params: SettlementTxGroup,
  suggestedParams: algosdk.SuggestedParams,
  escrowContractId: number,
  usdcAsaId: number,
): algosdk.Transaction[] {
  const note = new TextEncoder().encode(
    JSON.stringify({ platform: 'chainstrike', tradeId: params.tradeId }),
  );

  const atc = new algosdk.AtomicTransactionComposer();

  // Txn 0: Clawback RWA token — admin (clawback authority) moves frozen tokens
  // from seller to buyer. Required because defaultFrozen=true on all RWA assets.
  const tokenTransfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: params.adminAddress,
    receiver: params.buyerAddress,
    assetIndex: params.asaId,
    amount: params.tokenAmount,
    assetSender: params.sellerAddress,
    suggestedParams,
    note,
  });
  atc.addTransaction({ txn: tokenTransfer, signer: algosdk.makeEmptyTransactionSigner() });

  if (escrowContractId > 0 && params.buyOrderId) {
    // Txn 1: ARC-4 call to escrow contract — releases USDC from escrow to seller + fee.
    // The escrow issues 2 inner asset transfers (fee=0 each), so outer call needs fee=3000.
    // Box reference: keyPrefix 'e:' + orderId (as defined in EscrowContract BoxMap).
    const enc = new TextEncoder();
    const boxKey = new Uint8Array([...enc.encode('e:'), ...enc.encode(params.buyOrderId)]);
    const escrowSp = { ...suggestedParams, fee: 3000n, flatFee: true };
    atc.addMethodCall({
      appID: escrowContractId,
      method: ESCROW_RELEASE_TO_SELLER_METHOD,
      methodArgs: [
        enc.encode(params.buyOrderId), // orderId: byte[]
        params.sellerAddress,           // sellerAddress: address
        params.usdcAmount,              // amount to seller: uint64
        params.treasuryAddress,         // feeAddress: address
        params.platformFee,             // feeAmount: uint64
      ],
      sender: params.adminAddress,
      signer: algosdk.makeEmptyTransactionSigner(),
      suggestedParams: escrowSp,
      appForeignAssets: [usdcAsaId],
      boxes: [{ appIndex: 0, name: boxKey }],
      // Escrow's inner txns send USDC to these addresses — AVM requires them in accounts array.
      // Without this, inner axfer to any address ≠ sender fails with "unavailable Holding".
      appAccounts: [params.sellerAddress, params.treasuryAddress],
    });
  } else {
    // Fallback: admin pays directly from admin wallet (no escrow contract or no orderId).
    // Used when escrow contract is not deployed or order has no escrow lock recorded.
    const paymentToSeller = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: params.adminAddress,
      receiver: params.sellerAddress,
      assetIndex: usdcAsaId,
      amount: params.usdcAmount,
      suggestedParams,
    });
    atc.addTransaction({ txn: paymentToSeller, signer: algosdk.makeEmptyTransactionSigner() });

    if (params.platformFee > 0n) {
      const feeTransfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: params.adminAddress,
        receiver: params.treasuryAddress,
        assetIndex: usdcAsaId,
        amount: params.platformFee,
        suggestedParams,
      });
      atc.addTransaction({ txn: feeTransfer, signer: algosdk.makeEmptyTransactionSigner() });
    }
  }

  return atc.buildGroup().map((t) => t.txn);
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
