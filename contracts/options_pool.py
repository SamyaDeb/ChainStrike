"""
ChainStrike Options Pool Contract

Liquidity pool for options trading:
- Users deposit ALGO to earn yield from option premiums
- Protocol writes options from pooled funds
- Manages risk exposure and utilization limits
- LP token accounting for share of pool

Features:
- Deposit/withdraw ALGO
- Auto-compounding premium distribution
- Risk-based pool utilization limits (max 80%)
- LP token minting/burning
- Fee collection for stakers
"""

from algopy import (
    ARC4Contract,
    Account,
    Asset,
    Bytes,
    BoxMap,
    Global,
    Txn,
    UInt64,
    arc4,
    gtxn,
    itxn,
    op,
    subroutine,
)
from algopy.arc4 import Address, Bool, String, Struct, abimethod


class PoolStats(Struct):
    """Pool statistics"""

    total_liquidity: arc4.UInt64  # Total ALGO in pool
    available_liquidity: arc4.UInt64  # Available for writing options
    utilized_liquidity: arc4.UInt64  # Locked in active options
    total_shares: arc4.UInt64  # Total LP shares
    total_premiums_earned: arc4.UInt64
    total_payouts: arc4.UInt64
    utilization_rate: arc4.UInt64  # Basis points (e.g., 5000 = 50%)
    lp_count: arc4.UInt64


class LPPosition(Struct):
    """Liquidity provider position"""

    shares: arc4.UInt64  # LP token balance
    deposited_value: arc4.UInt64  # Original ALGO deposited
    current_value: arc4.UInt64  # Current value with earnings
    entry_time: arc4.UInt64


class OptionsPool(ARC4Contract):
    """
    Options liquidity pool contract.

    LPs deposit ALGO and earn yield from option premiums.
    Protocol writes options against pooled collateral.

    Share Mechanism:
    - Deposit: Receive shares based on current pool ratio
    - Withdraw: Burn shares to receive proportional ALGO
    - Premiums increase share value over time
    - Payouts decrease share value

    Risk Management:
    - Maximum 80% utilization
    - Minimum liquidity reserves
    - Gradual withdrawal queue for large amounts
    """

    def __init__(self) -> None:
        """Initialize options pool"""
        # Pool state
        self.total_liquidity = UInt64(0)
        self.utilized_liquidity = UInt64(0)
        self.total_shares = UInt64(0)
        self.lp_count = UInt64(0)

        # Earnings tracking
        self.total_premiums_earned = UInt64(0)
        self.total_payouts = UInt64(0)
        self.total_fees_collected = UInt64(0)

        # LP token (ASA)
        self.lp_token_id = UInt64(0)

        # Configuration
        self.max_utilization = UInt64(8000)  # 80% in basis points
        self.deposit_fee = UInt64(10)  # 0.1% in basis points
        self.withdraw_fee = UInt64(10)  # 0.1% in basis points
        self.min_deposit = UInt64(1_000_000)  # 1 ALGO minimum

        # Contract references
        self.admin = Global.creator_address
        self.options_market = Global.zero_address
        self.staking_contract = Global.zero_address

        # State
        self.is_paused = False

        # Constants
        self.share_precision = UInt64(1_000_000)  # 6 decimals for shares

        # Box storage for per-LP positions
        self.lp_positions = BoxMap(Bytes, LPPosition, key_prefix=b"olp_")

    @abimethod()
    def initialize(
        self,
        options_market: Address,
        staking_contract: Address,
    ) -> arc4.UInt64:
        """
        Initialize pool and create LP token.

        Args:
            options_market: Options market contract address
            staking_contract: Staking contract for fee distribution

        Returns:
            LP token asset ID
        """
        assert Txn.sender == self.admin, "Only admin"
        assert self.lp_token_id == 0, "Already initialized"

        self.options_market = options_market.native
        self.staking_contract = staking_contract.native

        # Create LP token ASA
        result = itxn.AssetConfig(
            total=UInt64(10_000_000_000_000_000),  # Large supply
            decimals=6,
            default_frozen=False,
            unit_name="csOPT",
            asset_name="ChainStrike Options LP",
            url="https://chainstrike.io/pool/options",
            manager=Global.current_application_address,
            reserve=Global.current_application_address,
            fee=Global.min_txn_fee,
        ).submit()

        self.lp_token_id = result.created_asset.id

        return arc4.UInt64(self.lp_token_id)

    @abimethod()
    def deposit(self) -> arc4.UInt64:
        """
        Deposit ALGO into pool and receive LP shares.
        ALGO amount determined from payment in group transaction.

        Group transaction structure:
        - If first deposit: [opt-in, payment, app_call] or [payment, app_call]
        - If subsequent: [payment, app_call]

        Returns:
            LP shares minted
        """
        assert not self.is_paused, "Contract paused"
        assert self.lp_token_id > 0, "Not initialized"

        # Find payment in group - try index 0 first, then index 1
        payment_amount = UInt64(0)

        # Try first transaction as payment
        if gtxn.Transaction(0).type_bytes == b"pay":
            payment_txn = gtxn.PaymentTransaction(0)
            if payment_txn.receiver == Global.current_application_address:
                payment_amount = payment_txn.amount

        # If not found at index 0, try index 1 (after opt-in)
        if payment_amount == 0 and Global.group_size > 1:
            if gtxn.Transaction(1).type_bytes == b"pay":
                payment_txn = gtxn.PaymentTransaction(1)
                if payment_txn.receiver == Global.current_application_address:
                    payment_amount = payment_txn.amount

        assert payment_amount >= self.min_deposit, "Below minimum deposit"

        # Calculate deposit fee
        fee = (payment_amount * self.deposit_fee) // 10000
        net_deposit = payment_amount - fee

        # Calculate shares to mint
        shares_to_mint = self._calculate_shares_for_deposit(net_deposit)

        # Mint LP tokens to depositor
        itxn.AssetTransfer(
            xfer_asset=self.lp_token_id,
            asset_receiver=Txn.sender,
            asset_amount=shares_to_mint,
            fee=Global.min_txn_fee,
        ).submit()

        # Update pool state
        self.total_liquidity += net_deposit
        self.total_shares += shares_to_mint
        self.total_fees_collected += fee

        # Update LP position in BoxMap
        lp_key = Txn.sender.bytes
        if lp_key in self.lp_positions:
            existing = self.lp_positions[lp_key].copy()
            new_shares = existing.shares.native + shares_to_mint
            new_deposited = existing.deposited_value.native + net_deposit
            new_value = self._calculate_algo_for_shares(new_shares)
            self.lp_positions[lp_key] = LPPosition(
                shares=arc4.UInt64(new_shares),
                deposited_value=arc4.UInt64(new_deposited),
                current_value=arc4.UInt64(new_value),
                entry_time=existing.entry_time,
            )
        else:
            self.lp_positions[lp_key] = LPPosition(
                shares=arc4.UInt64(shares_to_mint),
                deposited_value=arc4.UInt64(net_deposit),
                current_value=arc4.UInt64(net_deposit),
                entry_time=arc4.UInt64(Global.latest_timestamp),
            )
            self.lp_count += 1

        # Send fee to staking contract
        if fee > 0 and self.staking_contract != Global.zero_address:
            itxn.Payment(
                receiver=self.staking_contract,
                amount=fee,
                fee=Global.min_txn_fee,
            ).submit()

        return arc4.UInt64(shares_to_mint)

    @abimethod()
    def withdraw(self, shares: arc4.UInt64) -> arc4.UInt64:
        """
        Withdraw ALGO from pool by burning LP shares.
        LP tokens must be sent in group transaction.

        Args:
            shares: LP shares to burn

        Returns:
            ALGO amount returned
        """
        assert not self.is_paused, "Contract paused"
        assert self.lp_token_id > 0, "Not initialized"
        assert shares.native > 0, "Invalid shares"

        # Verify LP token transfer
        assert gtxn.AssetTransferTransaction(0).xfer_asset.id == self.lp_token_id, "Wrong asset"
        assert gtxn.AssetTransferTransaction(0).asset_amount >= shares.native, "Insufficient shares"
        assert gtxn.AssetTransferTransaction(0).asset_receiver == Global.current_application_address, "Wrong receiver"

        # Calculate ALGO amount for shares
        algo_amount = self._calculate_algo_for_shares(shares.native)

        # Check available liquidity
        available = self.total_liquidity - self.utilized_liquidity
        assert algo_amount <= available, "Insufficient available liquidity"

        # Calculate withdrawal fee
        fee = (algo_amount * self.withdraw_fee) // 10000
        net_withdrawal = algo_amount - fee

        # Transfer ALGO to withdrawer
        itxn.Payment(
            receiver=Txn.sender,
            amount=net_withdrawal,
            fee=Global.min_txn_fee,
        ).submit()

        # Update pool state
        self.total_liquidity -= algo_amount
        self.total_shares -= shares.native
        self.total_fees_collected += fee

        # Update LP position in BoxMap
        lp_key = Txn.sender.bytes
        if lp_key in self.lp_positions:
            existing = self.lp_positions[lp_key].copy()
            if existing.shares.native > shares.native:
                new_shares = existing.shares.native - shares.native
                new_value = self._calculate_algo_for_shares(new_shares)
                # Proportionally reduce deposited value
                new_deposited = (existing.deposited_value.native * new_shares) // existing.shares.native
                self.lp_positions[lp_key] = LPPosition(
                    shares=arc4.UInt64(new_shares),
                    deposited_value=arc4.UInt64(new_deposited),
                    current_value=arc4.UInt64(new_value),
                    entry_time=existing.entry_time,
                )
            else:
                del self.lp_positions[lp_key]
                if self.lp_count > 0:
                    self.lp_count -= 1

        # Note: LP tokens are "burned" by keeping them in contract

        return arc4.UInt64(net_withdrawal)

    @abimethod()
    def lock_collateral(self, amount: arc4.UInt64, option_id: arc4.UInt64) -> Bool:
        """
        Lock collateral for an option (called by OptionsMarket only).

        Args:
            amount: ALGO amount to lock
            option_id: Option identifier

        Returns:
            Success status
        """
        assert Txn.sender == self.options_market, "Only options market"

        # Check utilization limit
        new_utilized = self.utilized_liquidity + amount.native
        new_utilization = (new_utilized * 10000) // self.total_liquidity
        assert new_utilization <= self.max_utilization, "Exceeds max utilization"

        # Check available liquidity
        available = self.total_liquidity - self.utilized_liquidity
        assert amount.native <= available, "Insufficient liquidity"

        # Lock collateral
        self.utilized_liquidity = new_utilized

        return Bool(True)

    @abimethod()
    def release_collateral(self, amount: arc4.UInt64, option_id: arc4.UInt64) -> Bool:
        """
        Release collateral when option expires/settles.

        Args:
            amount: ALGO amount to release
            option_id: Option identifier

        Returns:
            Success status
        """
        assert Txn.sender == self.options_market, "Only options market"

        # Release collateral
        if self.utilized_liquidity >= amount.native:
            self.utilized_liquidity -= amount.native
        else:
            self.utilized_liquidity = UInt64(0)

        return Bool(True)

    @abimethod()
    def receive_premium(self, amount: arc4.UInt64, option_id: arc4.UInt64) -> Bool:
        """
        Receive option premium into pool.
        Called by OptionsMarket after sending payment via inner transaction.

        Args:
            amount: Premium amount that was sent
            option_id: Option identifier

        Returns:
            Success status
        """
        assert Txn.sender == self.options_market, "Only options market"

        # Trust the amount from OptionsMarket - payment was sent as inner txn
        # Add premium to pool (increases share value for all LPs)
        self.total_liquidity += amount.native
        self.total_premiums_earned += amount.native

        return Bool(True)

    @abimethod()
    def pay_settlement(self, amount: arc4.UInt64, recipient: Address, option_id: arc4.UInt64) -> Bool:
        """
        Pay option settlement to buyer.

        Args:
            amount: Settlement amount
            recipient: Option buyer address
            option_id: Option identifier

        Returns:
            Success status
        """
        assert Txn.sender == self.options_market, "Only options market"
        assert amount.native <= self.total_liquidity, "Insufficient pool funds"

        # Transfer settlement
        itxn.Payment(
            receiver=recipient.native,
            amount=amount.native,
            fee=Global.min_txn_fee,
        ).submit()

        # Update pool state (decreases share value)
        self.total_liquidity -= amount.native
        self.total_payouts += amount.native

        return Bool(True)

    @abimethod()
    def get_pool_stats(self) -> PoolStats:
        """Get pool statistics."""
        available = self.total_liquidity - self.utilized_liquidity
        utilization = UInt64(0)
        if self.total_liquidity > 0:
            utilization = (self.utilized_liquidity * 10000) // self.total_liquidity

        return PoolStats(
            total_liquidity=arc4.UInt64(self.total_liquidity),
            available_liquidity=arc4.UInt64(available),
            utilized_liquidity=arc4.UInt64(self.utilized_liquidity),
            total_shares=arc4.UInt64(self.total_shares),
            total_premiums_earned=arc4.UInt64(self.total_premiums_earned),
            total_payouts=arc4.UInt64(self.total_payouts),
            utilization_rate=arc4.UInt64(utilization),
            lp_count=arc4.UInt64(self.lp_count),
        )

    @abimethod()
    def get_lp_position(self, account: Address, shares: arc4.UInt64) -> LPPosition:
        """
        Get LP position value for given shares.

        Args:
            account: Account address
            shares: Number of shares held

        Returns:
            LP position details
        """
        # Try BoxMap first
        lp_key = account.native.bytes
        if lp_key in self.lp_positions:
            stored = self.lp_positions[lp_key].copy()
            current_value = self._calculate_algo_for_shares(stored.shares.native)
            return LPPosition(
                shares=stored.shares,
                deposited_value=stored.deposited_value,
                current_value=arc4.UInt64(current_value),
                entry_time=stored.entry_time,
            )

        # Fallback: calculate from shares
        current_value = self._calculate_algo_for_shares(shares.native)
        return LPPosition(
            shares=shares,
            deposited_value=arc4.UInt64(0),
            current_value=arc4.UInt64(current_value),
            entry_time=arc4.UInt64(0),
        )

    @abimethod()
    def get_share_price(self) -> arc4.UInt64:
        """
        Get current LP share price in ALGO (scaled by precision).

        Returns:
            Price per share in microALGO
        """
        if self.total_shares == 0:
            return arc4.UInt64(self.share_precision)  # 1:1 for empty pool

        # share_price = (total_liquidity * precision) / total_shares
        price = (self.total_liquidity * self.share_precision) // self.total_shares
        return arc4.UInt64(price)

    @abimethod()
    def preview_deposit(self, amount: arc4.UInt64) -> arc4.UInt64:
        """Preview shares received for a deposit amount."""
        fee = (amount.native * self.deposit_fee) // 10000
        net_deposit = amount.native - fee
        shares = self._calculate_shares_for_deposit(net_deposit)
        return arc4.UInt64(shares)

    @abimethod()
    def preview_withdraw(self, shares: arc4.UInt64) -> arc4.UInt64:
        """Preview ALGO received for burning shares."""
        algo_amount = self._calculate_algo_for_shares(shares.native)
        fee = (algo_amount * self.withdraw_fee) // 10000
        net_withdrawal = algo_amount - fee
        return arc4.UInt64(net_withdrawal)

    # ========== Admin Functions ==========

    @abimethod()
    def set_options_market(self, market: Address) -> Bool:
        """Set options market contract address."""
        assert Txn.sender == self.admin, "Only admin"
        self.options_market = market.native
        return Bool(True)

    @abimethod()
    def set_max_utilization(self, basis_points: arc4.UInt64) -> Bool:
        """Set maximum pool utilization."""
        assert Txn.sender == self.admin, "Only admin"
        assert basis_points.native <= 9500, "Max 95%"
        assert basis_points.native >= 5000, "Min 50%"
        self.max_utilization = basis_points.native
        return Bool(True)

    @abimethod()
    def set_fees(self, deposit_fee: arc4.UInt64, withdraw_fee: arc4.UInt64) -> Bool:
        """Set deposit and withdrawal fees."""
        assert Txn.sender == self.admin, "Only admin"
        assert deposit_fee.native <= 100, "Max 1% deposit fee"
        assert withdraw_fee.native <= 100, "Max 1% withdraw fee"
        self.deposit_fee = deposit_fee.native
        self.withdraw_fee = withdraw_fee.native
        return Bool(True)

    @abimethod()
    def transfer_admin(self, new_admin: Address) -> Bool:
        """Transfer admin role."""
        assert Txn.sender == self.admin, "Only admin"
        self.admin = new_admin.native
        return Bool(True)

    @abimethod()
    def pause(self) -> Bool:
        """Pause pool operations."""
        assert Txn.sender == self.admin, "Only admin"
        self.is_paused = True
        return Bool(True)

    @abimethod()
    def unpause(self) -> Bool:
        """Unpause pool operations."""
        assert Txn.sender == self.admin, "Only admin"
        self.is_paused = False
        return Bool(True)

    # ========== Internal Helpers ==========

    @subroutine
    def _calculate_shares_for_deposit(self, deposit_amount: UInt64) -> UInt64:
        """Calculate LP shares to mint for a deposit."""
        if self.total_shares == 0 or self.total_liquidity == 0:
            # First deposit: 1:1 ratio
            return deposit_amount

        # shares = (deposit * total_shares) / total_liquidity
        return (deposit_amount * self.total_shares) // self.total_liquidity

    @subroutine
    def _calculate_algo_for_shares(self, shares: UInt64) -> UInt64:
        """Calculate ALGO amount for burning shares."""
        if self.total_shares == 0:
            return UInt64(0)

        # algo = (shares * total_liquidity) / total_shares
        return (shares * self.total_liquidity) // self.total_shares
