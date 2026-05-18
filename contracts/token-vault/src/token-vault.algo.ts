import {
  Contract,
  GlobalState,
  Txn,
  Global,
  assert,
  uint64,
  Account,
} from '@algorandfoundation/algorand-typescript';
import { itxn } from '@algorandfoundation/algorand-typescript';

// ─────────────────────────────────────────────────────────────────────────────
// TokenVault Contract
//
// Holds the full supply of a minted RWA ASA.
// Remaining tokens (not distributed to issuer) are locked here indefinitely,
// representing unbacked supply. Only admin can release tokens to the issuer.
//
// Flow:
//   1. Admin deploys vault with asaId + totalSupply
//   2. Admin funds vault with ALGO (min balance) then calls optIntoAsset()
//   3. Admin transfers full token supply from ASA creator wallet → vault address
//   4. Admin calls distributeToIssuer(issuerAddress, amount) with issuer's
//      allocation (calculated from their USDC liquidity deposit)
//   5. Remaining tokens stay locked in vault
//
// Access control: admin only (platform admin account)
// ─────────────────────────────────────────────────────────────────────────────

export class TokenVault extends Contract {
  admin = GlobalState<Account>({ initialValue: Global.zeroAddress });
  asaId = GlobalState<uint64>({ initialValue: 0 });
  totalSupply = GlobalState<uint64>({ initialValue: 0 });
  distributedAmount = GlobalState<uint64>({ initialValue: 0 });

  // ─── Initialize vault ────────────────────────────────────────────────────────
  // Called once at deployment. Sets admin, ASA reference, and total supply.

  createApplication(admin: Account, asaId: uint64, totalSupply: uint64): void {
    this.admin.value = admin;
    this.asaId.value = asaId;
    this.totalSupply.value = totalSupply;
  }

  // ─── Opt vault into ASA ──────────────────────────────────────────────────────
  // Must be called after funding vault with ALGO (covers asset opt-in storage cost).
  // Enables vault to receive the ASA tokens.

  optIntoAsset(): void {
    assert(Txn.sender === this.admin.value, 'Only admin');
    itxn.assetTransfer({
      assetReceiver: Global.currentApplicationAddress,
      xferAsset: this.asaId.value,
      assetAmount: 0,
      fee: 0,
    }).submit();
  }

  // ─── Opt vault into USDC (called before treasury forwards USDC collateral) ─────

  optIntoUsdc(usdcAsaId: uint64): void {
    assert(Txn.sender === this.admin.value, 'Only admin');
    itxn.assetTransfer({
      assetReceiver: Global.currentApplicationAddress,
      xferAsset: usdcAsaId,
      assetAmount: 0,
      fee: 0,
    }).submit();
  }

  // ─── Distribute tokens to issuer ─────────────────────────────────────────────
  // Releases a portion of the locked supply to the issuer wallet.
  // Amount is proportional to the issuer's USDC liquidity deposit at launch.

  distributeToIssuer(issuerAddress: Account, amount: uint64): void {
    assert(Txn.sender === this.admin.value, 'Only admin');
    assert(
      this.distributedAmount.value + amount <= this.totalSupply.value,
      'Exceeds total supply',
    );

    itxn.assetTransfer({
      assetReceiver: issuerAddress,
      xferAsset: this.asaId.value,
      assetAmount: amount,
      fee: 0,
    }).submit();

    this.distributedAmount.value = this.distributedAmount.value + amount;
  }

  // ─── Withdraw RWA tokens to admin for Tinyman pool deployment ────────────────
  // Admin calls this to retrieve poolTokenAmount tokens from vault before
  // bootstrapping the Tinyman AMM pool. These tokens represent the pool's
  // initial RWA liquidity side.

  withdrawForPool(recipient: Account, amount: uint64): void {
    assert(Txn.sender === this.admin.value, 'Only admin');
    itxn.assetTransfer({
      assetReceiver: recipient,
      xferAsset: this.asaId.value,
      assetAmount: amount,
      fee: 0,
    }).submit();
  }

  // ─── Withdraw USDC to admin for Tinyman pool deployment ──────────────────────
  // Admin calls this to retrieve USDC held in vault (released from issuance
  // escrow) before bootstrapping the Tinyman AMM pool.

  withdrawUsdcForPool(recipient: Account, usdcAsaId: uint64, amount: uint64): void {
    assert(Txn.sender === this.admin.value, 'Only admin');
    itxn.assetTransfer({
      assetReceiver: recipient,
      xferAsset: usdcAsaId,
      assetAmount: amount,
      fee: 0,
    }).submit();
  }

  // ─── Opt vault into LP token (issued by Tinyman at pool creation) ────────────
  // Must be called after bootstrapPool so vault can receive LP tokens.
  // LP tokens represent the issuer's share of the AMM pool.

  optIntoLpToken(lpAsaId: uint64): void {
    assert(Txn.sender === this.admin.value, 'Only admin');
    itxn.assetTransfer({
      assetReceiver: Global.currentApplicationAddress,
      xferAsset: lpAsaId,
      assetAmount: 0,
      fee: 0,
    }).submit();
  }
}
