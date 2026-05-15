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
// Escrow Contract
//
// Holds USDC deposits for pending buy orders.
// Prevents double-spending the same USDC across multiple orders.
//
// Flow:
//   1. Buyer places order -> sends USDC to this contract with order ID in note
//   2. On trade match -> Settlement Contract (or admin for testnet) instructs release
//   3. On order cancel -> Settlement Contract (or admin for testnet) returns to buyer
//
// Access control: settlement contract OR admin (for testnet operations)
// ─────────────────────────────────────────────────────────────────────────────

export class EscrowContract extends Contract {
  admin = GlobalState<Account>({ initialValue: Global.zeroAddress });
  settlementContractAddress = GlobalState<Account>({ initialValue: Global.zeroAddress });
  usdcAsaId = GlobalState<uint64>({ initialValue: 0 });
  isPaused = GlobalState<uint64>({ initialValue: 0 });

  // Locked escrow per order: orderId -> EscrowRecord(buyerAddress, amount, locked)
  escrowHolds = BoxMap<bytes, bytes>({ keyPrefix: 'e:' });

  createApplication(
    adminAddress: Account,
    settlementAddress: Account,
    usdcAsaId: uint64,
  ): void {
    this.admin.value = adminAddress;
    this.settlementContractAddress.value = settlementAddress;
    this.usdcAsaId.value = usdcAsaId;
  }

  // ─── Lock USDC for a buy order ────────────────────────────────────────────────
  // Called by the buyer's wallet transaction or admin on behalf of buyer

  recordLock(orderId: bytes, buyerAddress: Account, amount: uint64): void {
    assert(this.isPaused.value === 0, 'Contract paused');
    assert(!this.escrowHolds(orderId).exists, 'Order already locked');
    assert(amount > 0, 'Amount must be positive');

    // Store: buyer(32) + amount(8) + locked(8: 1=locked) = 48 bytes
    const record = concat(concat(buyerAddress.bytes, itob(amount)), itob(1));
    this.escrowHolds(orderId).value = record;
  }

  // ─── Release USDC to seller (on trade settlement) ────────────────────────────
  // Callable by settlement contract or admin

  releaseToSeller(
    orderId: bytes,
    sellerAddress: Account,
    amount: uint64,
    feeAddress: Account,
    feeAmount: uint64,
  ): void {
    assert(
      Txn.sender === this.settlementContractAddress.value ||
      Txn.sender === this.admin.value,
      'Only settlement contract or admin',
    );
    assert(this.isPaused.value === 0, 'Contract paused');
    assert(this.escrowHolds(orderId).exists, 'No escrow hold for this order');

    const record = this.escrowHolds(orderId).value;
    const lockedAmount = btoi(record.slice(32, 40));
    const isLocked = btoi(record.slice(40, 48));

    assert(isLocked === 1, 'Escrow not locked');
    assert(amount + feeAmount <= lockedAmount, 'Release exceeds locked amount');

    // Release USDC to seller
    itxn.assetTransfer({
      assetReceiver: sellerAddress,
      xferAsset: this.usdcAsaId.value,
      assetAmount: amount,
      fee: 0,
    }).submit();

    // Release fee to treasury
    if (feeAmount > 0) {
      itxn.assetTransfer({
        assetReceiver: feeAddress,
        xferAsset: this.usdcAsaId.value,
        assetAmount: feeAmount,
        fee: 0,
      }).submit();
    }

    // Mark as released
    const updated = concat(record.slice(0, 40), itob(0)); // isLocked = 0
    this.escrowHolds(orderId).value = updated;
  }

  // ─── Return USDC to buyer (on order cancellation) ────────────────────────────
  // Callable by settlement contract or admin

  returnToBuyer(orderId: bytes): void {
    assert(
      Txn.sender === this.settlementContractAddress.value ||
      Txn.sender === this.admin.value,
      'Only settlement contract or admin',
    );

    const record = this.escrowHolds(orderId).value;
    const buyerAddress = Account(record.slice(0, 32));
    const lockedAmount = btoi(record.slice(32, 40));
    const isLocked = btoi(record.slice(40, 48));

    assert(isLocked === 1, 'Escrow not locked or already released');

    itxn.assetTransfer({
      assetReceiver: buyerAddress,
      xferAsset: this.usdcAsaId.value,
      assetAmount: lockedAmount,
      fee: 0,
    }).submit();

    this.escrowHolds(orderId).delete();
  }

  // ─── Admin: Update settlement contract address ────────────────────────────────

  updateSettlementContract(newAddress: Account): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized');
    this.settlementContractAddress.value = newAddress;
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
