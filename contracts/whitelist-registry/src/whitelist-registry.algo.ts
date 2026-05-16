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
// Whitelist Registry Contract
//
// Maintains the canonical on-chain mapping of:
//   (investor address, ASA ID) -> (approved: bool, tier: uint64, expiry: uint64)
//
// Access control:
//   - Only the Compliance Oracle address can add/remove entries
//   - Anyone can query (read-only checks)
//
// Called by the Settlement Contract before executing any trade.
// ─────────────────────────────────────────────────────────────────────────────

export class WhitelistRegistry extends Contract {
  // Platform Compliance Oracle address - the only account that can update whitelist
  complianceOracle = GlobalState<Account>({ initialValue: Global.zeroAddress });

  // Admin address (platform admin multi-sig) - can change the compliance oracle
  admin = GlobalState<Account>({ initialValue: Global.zeroAddress });

  // Paused flag for emergency use
  isPaused = GlobalState<uint64>({ initialValue: 0 });

  // Box storage: key = (address || asaId), value = (approved || tier || expiry)
  whitelist = BoxMap<bytes, bytes>({ keyPrefix: 'wl:' });

  // ─── Deployment / Initialization ─────────────────────────────────────────────

  createApplication(adminAddress: Account, oracleAddress: Account): void {
    this.admin.value = adminAddress;
    this.complianceOracle.value = oracleAddress;
  }

  // ─── Add/Update Whitelist Entry ───────────────────────────────────────────────

  addToWhitelist(
    walletAddress: Account,
    asaId: uint64,
    tier: uint64,
    expiryTimestamp: uint64,
  ): void {
    assert(Txn.sender === this.complianceOracle.value, 'Only compliance oracle can modify whitelist');
    assert(this.isPaused.value === 0, 'Contract is paused');
    assert(tier >= 1 && tier <= 3, 'Invalid KYC tier');

    const key = this.encodeKey(walletAddress, asaId);

    // approved=1, tier, expiry packed as 3x8 bytes = 24 bytes
    const value = concat(concat(itob(1), itob(tier)), itob(expiryTimestamp));
    this.whitelist(key).value = value;
  }

  // ─── Remove Whitelist Entry ───────────────────────────────────────────────────

  removeFromWhitelist(walletAddress: Account, asaId: uint64): void {
    assert(Txn.sender === this.complianceOracle.value, 'Only compliance oracle can modify whitelist');
    assert(this.isPaused.value === 0, 'Contract is paused');

    const key = this.encodeKey(walletAddress, asaId);
    this.whitelist(key).delete();
  }

  // ─── Query: Is address whitelisted? ──────────────────────────────────────────
  // Returns: approved (0 or 1), tier (0-3), expiry (unix timestamp, 0=no expiry)
  // Returns (0, 0, 0) if not found.

  isWhitelisted(walletAddress: Account, asaId: uint64): readonly [uint64, uint64, uint64] {
    const key = this.encodeKey(walletAddress, asaId);

    if (!this.whitelist(key).exists) {
      return [0, 0, 0];
    }

    const value = this.whitelist(key).value;
    const approved = btoi(value.slice(0, 8));
    const tier = btoi(value.slice(8, 16));
    const expiry = btoi(value.slice(16, 24));

    // Check expiry (expiry=0 means no expiry)
    if (expiry > 0 && Global.latestTimestamp > expiry) {
      return [0, 0, expiry]; // Expired
    }

    return [approved, tier, expiry];
  }

  // ─── Admin: Update Compliance Oracle ─────────────────────────────────────────

  updateComplianceOracle(newOracle: Account): void {
    assert(Txn.sender === this.admin.value, 'Only admin can update oracle');
    this.complianceOracle.value = newOracle;
  }

  // ─── Emergency Pause ──────────────────────────────────────────────────────────

  pause(): void {
    assert(Txn.sender === this.admin.value, 'Only admin can pause');
    this.isPaused.value = 1;
  }

  unpause(): void {
    assert(Txn.sender === this.admin.value, 'Only admin can unppause');
    this.isPaused.value = 0;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private encodeKey(acct: Account, asaId: uint64): bytes {
    // 32-byte address + 8-byte asaId = 40-byte key
    return concat(acct.bytes, itob(asaId));
  }
}
