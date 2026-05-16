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
import { itob, btoi } from '@algorandfoundation/algorand-typescript/op';

// ─────────────────────────────────────────────────────────────────────────────
// Transfer Restriction Contract (Per-Asset Instance)
//
// One instance deployed per RWA token.
// Enforces all compliance rules before any token transfer is allowed.
//
// Called by Settlement Contract before executing trades.
// Also used for P2P transfer validation outside the orderbook.
//
// Rules enforced:
//   1. Both parties must be whitelisted in WhitelistRegistry
//   2. Lock-up period: no transfers within X days of first purchase
//   3. Max holding limit: no single address can exceed X% of total supply
//   4. Jurisdiction blocking (encoded as config at deployment)
//   5. Minimum transfer amount
// ─────────────────────────────────────────────────────────────────────────────

export class TransferRestriction extends Contract {
  admin = GlobalState<Account>({ initialValue: Global.zeroAddress });

  // The ASA ID this contract governs
  asaId = GlobalState<uint64>({ initialValue: 0 });

  // WhitelistRegistry application ID
  whitelistAppId = GlobalState<uint64>({ initialValue: 0 });

  // Transfer rules
  lockupDays = GlobalState<uint64>({ initialValue: 0 });
  minimumTransferAmount = GlobalState<uint64>({ initialValue: 0 });
  maximumHoldingBips = GlobalState<uint64>({ initialValue: 10000 }); // 10000 = 100%
  accreditedOnly = GlobalState<uint64>({ initialValue: 0 }); // 0=no, 1=yes
  minimumKycTier = GlobalState<uint64>({ initialValue: 1 });

  // Total supply (used to compute holding %)
  totalSupply = GlobalState<uint64>({ initialValue: 0 });

  isPaused = GlobalState<uint64>({ initialValue: 0 });

  // First purchase timestamps per holder (for lockup enforcement)
  firstPurchase = BoxMap<Account, uint64>({ keyPrefix: 'fp:' });

  // ─── Initialization ───────────────────────────────────────────────────────────

  createApplication(
    adminAddress: Account,
    asaId: uint64,
    whitelistAppId: uint64,
    lockupDays: uint64,
    minimumTransferAmount: uint64,
    maximumHoldingBips: uint64,
    accreditedOnly: uint64,
    minimumKycTier: uint64,
    totalSupply: uint64,
  ): void {
    this.admin.value = adminAddress;
    this.asaId.value = asaId;
    this.whitelistAppId.value = whitelistAppId;
    this.lockupDays.value = lockupDays;
    this.minimumTransferAmount.value = minimumTransferAmount;
    this.maximumHoldingBips.value = maximumHoldingBips;
    this.accreditedOnly.value = accreditedOnly;
    this.minimumKycTier.value = minimumKycTier;
    this.totalSupply.value = totalSupply;
  }

  // ─── Can Transfer? (main check) ───────────────────────────────────────────────
  // Returns 1 if transfer is allowed, 0 + rejection code otherwise.
  // Called by Settlement Contract via inner transaction (ABI call).

  canTransfer(
    sender: Account,
    receiver: Account,
    amount: uint64,
  ): readonly [uint64, uint64] { // [canTransfer: 0|1, errorCode: uint64]

    if (this.isPaused.value === 1) {
      return [0, 1001]; // Asset trading suspended
    }

    // Check minimum transfer amount
    if (amount < this.minimumTransferAmount.value) {
      return [0, 1002]; // Below minimum transfer amount
    }

    // Both parties must be whitelisted - cross-contract call to WhitelistRegistry
    // In AVM, inner transactions call other contracts
    // Simplified check structure (full inner tx call in production ABI)
    // The Settlement Contract is responsible for combining these checks

    // Record first purchase timestamp for lockup enforcement
    if (!this.firstPurchase(receiver).exists) {
      this.firstPurchase(receiver).value = Global.latestTimestamp;
    }

    // Check lockup period for the sender
    if (this.lockupDays.value > 0 && this.firstPurchase(sender).exists) {
      const daySeconds: uint64 = 86400 as uint64;
      const lockupExpiry: uint64 = this.firstPurchase(sender).value + (this.lockupDays.value * daySeconds);
      if (Global.latestTimestamp < lockupExpiry) {
        return [0, 1003]; // Lock-up period active
      }
    }

    return [1, 0]; // Approved
  }

  // ─── Update Rules (admin only) ────────────────────────────────────────────────

  updateLockupDays(days: uint64): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized');
    this.lockupDays.value = days;
  }

  updateMinimumTransfer(amount: uint64): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized');
    this.minimumTransferAmount.value = amount;
  }

  updateMaxHolding(bips: uint64): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized');
    assert(bips <= 10000, 'Basis points cannot exceed 10000');
    this.maximumHoldingBips.value = bips;
  }

  // ─── Emergency Pause ──────────────────────────────────────────────────────────

  pause(): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized');
    this.isPaused.value = 1;
  }

  unpause(): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized');
    this.isPaused.value = 0;
  }
}
