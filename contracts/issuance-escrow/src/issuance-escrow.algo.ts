import {
  Contract,
  GlobalState,
  BoxMap,
  Txn,
  Global,
  assert,
  uint64,
  bytes,
  Account,
} from '@algorandfoundation/algorand-typescript';
import { itob, btoi, concat } from '@algorandfoundation/algorand-typescript/op';
import { itxn } from '@algorandfoundation/algorand-typescript';

// ─────────────────────────────────────────────────────────────────────────────
// IssuanceLiquidityEscrow Contract
//
// Holds USDC deposited by issuers during token issuance applications.
// Prevents USDC from entering the treasury until admin makes a final decision.
//
// Flow:
//   1. Issuer sends USDC axfer to this contract's address
//   2. Backend verifies the on-chain txId, then admin calls recordIssuanceLock()
//   3a. Stage 5 APPROVED → deployAsaToMainnet() calls releaseToVault()
//        → inner axfer: USDC moves from this contract → TokenVault address
//   3b. Any stage REJECTED → addVerificationStage() calls returnToIssuer()
//        → inner axfer: USDC moves from this contract → issuer's wallet
//
// Access control: all state-changing methods require Txn.sender === admin
// ─────────────────────────────────────────────────────────────────────────────

export class IssuanceLiquidityEscrow extends Contract {
  admin = GlobalState<Account>({ initialValue: Global.zeroAddress });
  usdcAsaId = GlobalState<uint64>({ initialValue: 0 });
  isPaused = GlobalState<uint64>({ initialValue: 0 });

  // Per-asset issuance lock: assetId (UUID bytes) → IssuanceRecord
  // Value layout: issuerPubKey(32) + amount(8) + status(1) = 41 bytes
  // status: 0 = PENDING, 1 = RELEASED_TO_VAULT, 2 = RETURNED_TO_ISSUER
  issuanceLocks = BoxMap<bytes, bytes>({ keyPrefix: 'il:' });

  createApplication(adminAddress: Account, usdcAsaId: uint64): void {
    this.admin.value = adminAddress;
    this.usdcAsaId.value = usdcAsaId;
  }

  // ─── Opt this contract into USDC ─────────────────────────────────────────────
  // Must be called once after deployment (before any issuer can send USDC).
  // Admin funds the contract with enough ALGO for USDC opt-in MBR first.

  optIntoUsdc(): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized');
    itxn.assetTransfer({
      assetReceiver: Global.currentApplicationAddress,
      xferAsset: this.usdcAsaId.value,
      assetAmount: 0,
      fee: 0,
    }).submit();
  }

  // ─── Record issuance lock (admin, after verifying deposit on-chain) ───────────
  // Admin calls this after confirming the issuer's USDC axfer hit this contract.
  // Admin must pre-fund the contract with box MBR before this call:
  //   MBR = 2500 + 400 * (keyLen + valueLen) = 2500 + 400 * (38 + 41) = 34,100 microALGO

  recordIssuanceLock(assetId: bytes, issuerAddress: Account, amount: uint64): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized');
    assert(this.isPaused.value === 0, 'Contract paused');
    assert(!this.issuanceLocks(assetId).exists, 'Lock already recorded for this asset');
    assert(amount > 0, 'Amount must be positive');

    // issuerPubKey(32) + amount(8) + status(1=0 PENDING)
    const record = concat(concat(issuerAddress.bytes, itob(amount)), itob(0));
    this.issuanceLocks(assetId).value = record;
  }

  // ─── Release USDC to vault (on Stage 5 approval + ASA deployment) ────────────
  // Admin calls this during deployAsaToMainnet() after the TokenVault is deployed
  // and has opted into USDC. Issues an inner axfer directly from this contract.

  releaseToVault(assetId: bytes, vaultAddress: Account): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized');
    assert(this.isPaused.value === 0, 'Contract paused');
    assert(this.issuanceLocks(assetId).exists, 'No lock found for this asset');

    const record = this.issuanceLocks(assetId).value;
    const status = btoi(record.slice(40, 41));
    assert(status === 0, 'Escrow not in PENDING state');

    const amount = btoi(record.slice(32, 40));

    itxn.assetTransfer({
      assetReceiver: vaultAddress,
      xferAsset: this.usdcAsaId.value,
      assetAmount: amount,
      fee: 0,
    }).submit();

    // Update status to RELEASED_TO_VAULT (1)
    const updated = concat(record.slice(0, 40), itob(1));
    this.issuanceLocks(assetId).value = updated;
  }

  // ─── Return USDC to issuer (on any stage rejection) ──────────────────────────
  // Admin calls this when addVerificationStage() marks any stage REJECTED.
  // Issues an inner axfer directly from this contract back to the issuer.

  returnToIssuer(assetId: bytes): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized');
    assert(this.issuanceLocks(assetId).exists, 'No lock found for this asset');

    const record = this.issuanceLocks(assetId).value;
    const status = btoi(record.slice(40, 41));
    assert(status === 0, 'Escrow not in PENDING state');

    const issuerAddress = Account(record.slice(0, 32));
    const amount = btoi(record.slice(32, 40));

    itxn.assetTransfer({
      assetReceiver: issuerAddress,
      xferAsset: this.usdcAsaId.value,
      assetAmount: amount,
      fee: 0,
    }).submit();

    // Update status to RETURNED_TO_ISSUER (2)
    const updated = concat(record.slice(0, 40), itob(2));
    this.issuanceLocks(assetId).value = updated;
  }

  pause(): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized');
    this.isPaused.value = 1;
  }

  unpause(): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized');
    this.isPaused.value = 0;
  }
}
