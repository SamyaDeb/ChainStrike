"""
ChainStrike Perpetuals Pool Contract

Liquidity pool for perpetual contracts:
- Users deposit ALGO to provide liquidity
- Acts as counterparty to all perpetual positions
- Collects funding rates and trading fees
- Manages pool exposure and risk

Features:
- Deposit/withdraw ALGO
- Fee distribution to LPs
- Dynamic funding rates based on OI imbalance
- Net position (delta) management
- Risk exposure limits
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


class PerpPoolStats(Struct):
    """Perpetuals pool statistics"""

    total_liquidity: arc4.UInt64
    available_liquidity: arc4.UInt64
    reserved_liquidity: arc4.UInt64  # Locked for positions
    total_shares: arc4.UInt64
    long_open_interest: arc4.UInt64  # Total long exposure in ALGO
    short_open_interest: arc4.UInt64  # Total short exposure in ALGO
    net_exposure: arc4.UInt64  # Net position (long - short)
    is_net_long: Bool  # True if net long, false if net short
    total_fees_earned: arc4.UInt64
    pool_pnl: arc4.UInt64  # Cumulative PnL
    funding_rate: arc4.UInt64  # Current funding rate (basis points/hour)
    lp_count: arc4.UInt64


class PerpLPPosition(Struct):
    """LP position in perpetuals pool"""

    shares: arc4.UInt64
    deposited_value: arc4.UInt64
    current_value: arc4.UInt64
    share_of_pool: arc4.UInt64  # Basis points
    entry_time: arc4.UInt64


class PerpetualsPool(ARC4Contract):
    """
    Perpetuals liquidity pool contract.

    Acts as counterparty to all perpetual positions.
    When traders go long, pool is short (and vice versa).

    PnL Mechanism:
    - Trader profits = Pool losses
    - Trader losses = Pool profits
    - Funding rates balance long/short imbalance

    Risk Management:
    - Maximum net exposure limits
    - Dynamic funding rates incentivize balance
    - Gradual liquidation threshold adjustments
    """

    def __init__(self) -> None:
        """Initialize perpetuals pool"""
        # Pool state
        self.total_liquidity = UInt64(0)
        self.reserved_liquidity = UInt64(0)
        self.total_shares = UInt64(0)
        self.lp_count = UInt64(0)

        # Open interest tracking
        self.long_open_interest = UInt64(0)
        self.short_open_interest = UInt64(0)

        # PnL tracking (can be negative in practice - stored as absolute with sign flag)
        self.cumulative_pnl = UInt64(0)
        self.is_pnl_positive = True

        # Fee tracking
        self.total_trading_fees = UInt64(0)
        self.total_funding_collected = UInt64(0)

        # Funding rate
        self.current_funding_rate = UInt64(0)  # Basis points per hour
        self.funding_rate_is_positive = True  # True = longs pay shorts
        self.last_funding_update = UInt64(0)

        # LP token
        self.lp_token_id = UInt64(0)

        # Configuration
        self.max_utilization = UInt64(9000)  # 90% max
        self.max_net_exposure = UInt64(5000)  # 50% of pool max net exposure
        self.base_funding_rate = UInt64(1)  # 0.01% per hour base
        self.max_funding_rate = UInt64(100)  # 1% per hour max
        self.deposit_fee = UInt64(10)  # 0.1%
        self.withdraw_fee = UInt64(10)  # 0.1%
        self.min_deposit = UInt64(10_000_000)  # 10 ALGO minimum

        # Contract references
        self.admin = Global.creator_address
        self.perps_market = Global.zero_address
        self.staking_contract = Global.zero_address

        # State
        self.is_paused = False

        # Precision
        self.share_precision = UInt64(1_000_000)
        self.funding_precision = UInt64(1_000_000)

        # Box storage for per-LP positions
        self.lp_positions = BoxMap(Bytes, PerpLPPosition, key_prefix=b"plp_")

    @abimethod()
    def initialize(
        self,
        perps_market: Address,
        staking_contract: Address,
    ) -> arc4.UInt64:
        """
        Initialize pool and create LP token.

        Args:
            perps_market: Perpetuals market contract address
            staking_contract: Staking contract for fee distribution

        Returns:
            LP token asset ID
        """
        assert Txn.sender == self.admin, "Only admin"
        assert self.lp_token_id == 0, "Already initialized"

        self.perps_market = perps_market.native
        self.staking_contract = staking_contract.native
        self.last_funding_update = Global.latest_timestamp

        # Create LP token ASA
        result = itxn.AssetConfig(
            total=UInt64(10_000_000_000_000_000),  # Large supply
            decimals=6,
            default_frozen=False,
            unit_name="csPERP",
            asset_name="ChainStrike Perps LP",
            url="https://chainstrike.io/pool/perps",
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

        # Calculate fee
        fee = (payment_amount * self.deposit_fee) // 10000
        net_deposit = payment_amount - fee

        # Calculate shares to mint
        shares_to_mint = self._calculate_shares_for_deposit(net_deposit)

        # Mint LP tokens
        itxn.AssetTransfer(
            xfer_asset=self.lp_token_id,
            asset_receiver=Txn.sender,
            asset_amount=shares_to_mint,
            fee=Global.min_txn_fee,
        ).submit()

        # Update pool state
        self.total_liquidity += net_deposit
        self.total_shares += shares_to_mint
        self.total_trading_fees += fee

        # Update LP position in BoxMap
        lp_key = Txn.sender.bytes
        if lp_key in self.lp_positions:
            existing = self.lp_positions[lp_key].copy()
            new_shares = existing.shares.native + shares_to_mint
            new_deposited = existing.deposited_value.native + net_deposit
            new_value = self._calculate_algo_for_shares(new_shares)
            share_of_pool = UInt64(0)
            if self.total_shares > 0:
                share_of_pool = (new_shares * 10000) // self.total_shares
            self.lp_positions[lp_key] = PerpLPPosition(
                shares=arc4.UInt64(new_shares),
                deposited_value=arc4.UInt64(new_deposited),
                current_value=arc4.UInt64(new_value),
                share_of_pool=arc4.UInt64(share_of_pool),
                entry_time=existing.entry_time,
            )
        else:
            share_of_pool = UInt64(0)
            if self.total_shares > 0:
                share_of_pool = (shares_to_mint * 10000) // self.total_shares
            self.lp_positions[lp_key] = PerpLPPosition(
                shares=arc4.UInt64(shares_to_mint),
                deposited_value=arc4.UInt64(net_deposit),
                current_value=arc4.UInt64(net_deposit),
                share_of_pool=arc4.UInt64(share_of_pool),
                entry_time=arc4.UInt64(Global.latest_timestamp),
            )
            self.lp_count += 1

        # Send fee to staking
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

        # Calculate ALGO amount
        algo_amount = self._calculate_algo_for_shares(shares.native)

        # Check available liquidity
        available = self.total_liquidity - self.reserved_liquidity
        assert algo_amount <= available, "Insufficient available liquidity"

        # Calculate fee
        fee = (algo_amount * self.withdraw_fee) // 10000
        net_withdrawal = algo_amount - fee

        # Transfer ALGO
        itxn.Payment(
            receiver=Txn.sender,
            amount=net_withdrawal,
            fee=Global.min_txn_fee,
        ).submit()

        # Update pool state
        self.total_liquidity -= algo_amount
        self.total_shares -= shares.native
        self.total_trading_fees += fee

        # Update LP position in BoxMap
        lp_key = Txn.sender.bytes
        if lp_key in self.lp_positions:
            existing = self.lp_positions[lp_key].copy()
            if existing.shares.native > shares.native:
                new_shares = existing.shares.native - shares.native
                new_value = self._calculate_algo_for_shares(new_shares)
                new_deposited = (existing.deposited_value.native * new_shares) // existing.shares.native
                share_of_pool = UInt64(0)
                if self.total_shares > 0:
                    share_of_pool = (new_shares * 10000) // self.total_shares
                self.lp_positions[lp_key] = PerpLPPosition(
                    shares=arc4.UInt64(new_shares),
                    deposited_value=arc4.UInt64(new_deposited),
                    current_value=arc4.UInt64(new_value),
                    share_of_pool=arc4.UInt64(share_of_pool),
                    entry_time=existing.entry_time,
                )
            else:
                del self.lp_positions[lp_key]
                if self.lp_count > 0:
                    self.lp_count -= 1

        return arc4.UInt64(net_withdrawal)

    @abimethod()
    def reserve_liquidity(self, amount: arc4.UInt64, position_id: arc4.UInt64) -> Bool:
        """
        Reserve liquidity for a perpetual position (called by PerpsMarket).

        Args:
            amount: Amount to reserve
            position_id: Position identifier

        Returns:
            Success status
        """
        assert Txn.sender == self.perps_market, "Only perps market"

        # Check utilization
        new_reserved = self.reserved_liquidity + amount.native
        utilization = (new_reserved * 10000) // self.total_liquidity
        assert utilization <= self.max_utilization, "Exceeds max utilization"

        # Check available
        available = self.total_liquidity - self.reserved_liquidity
        assert amount.native <= available, "Insufficient liquidity"

        self.reserved_liquidity = new_reserved

        return Bool(True)

    @abimethod()
    def release_liquidity(self, amount: arc4.UInt64, position_id: arc4.UInt64) -> Bool:
        """
        Release reserved liquidity when position closes.

        Args:
            amount: Amount to release
            position_id: Position identifier

        Returns:
            Success status
        """
        assert Txn.sender == self.perps_market, "Only perps market"

        if self.reserved_liquidity >= amount.native:
            self.reserved_liquidity -= amount.native
        else:
            self.reserved_liquidity = UInt64(0)

        return Bool(True)

    @abimethod()
    def update_open_interest(
        self,
        long_delta: arc4.UInt64,
        short_delta: arc4.UInt64,
        is_increase: Bool,
    ) -> Bool:
        """
        Update open interest when positions change.

        Args:
            long_delta: Change in long OI
            short_delta: Change in short OI
            is_increase: True for increase, False for decrease

        Returns:
            Success status
        """
        assert Txn.sender == self.perps_market, "Only perps market"

        if is_increase.native:
            self.long_open_interest += long_delta.native
            self.short_open_interest += short_delta.native
        else:
            if self.long_open_interest >= long_delta.native:
                self.long_open_interest -= long_delta.native
            if self.short_open_interest >= short_delta.native:
                self.short_open_interest -= short_delta.native

        # Recalculate funding rate based on new OI imbalance
        self._update_funding_rate()

        return Bool(True)

    @abimethod()
    def collect_trading_fee(self, amount: arc4.UInt64) -> Bool:
        """
        Collect trading fee from market contract.
        Fee ALGO must be sent in group transaction.

        Args:
            amount: Fee amount

        Returns:
            Success status
        """
        # Verify payment
        assert gtxn.PaymentTransaction(0).amount >= amount.native, "Insufficient payment"
        assert gtxn.PaymentTransaction(0).receiver == Global.current_application_address, "Wrong receiver"

        self.total_trading_fees += amount.native
        self.total_liquidity += amount.native  # Fees add to pool

        return Bool(True)

    @abimethod()
    def process_pnl(self, amount: arc4.UInt64, is_profit: Bool, recipient: Address) -> Bool:
        """
        Process trader PnL (profit goes from pool to trader, loss to pool).

        Args:
            amount: PnL amount
            is_profit: True if trader profit (pool pays), False if loss (pool receives)
            recipient: Trader address (for profits)

        Returns:
            Success status
        """
        assert Txn.sender == self.perps_market, "Only perps market"

        if is_profit.native:
            # Trader profit = Pool pays out
            assert amount.native <= self.total_liquidity, "Insufficient pool funds"

            itxn.Payment(
                receiver=recipient.native,
                amount=amount.native,
                fee=Global.min_txn_fee,
            ).submit()

            self.total_liquidity -= amount.native

            # Track pool loss
            if self.is_pnl_positive and self.cumulative_pnl >= amount.native:
                self.cumulative_pnl -= amount.native
            else:
                if self.is_pnl_positive:
                    self.cumulative_pnl = amount.native - self.cumulative_pnl
                    self.is_pnl_positive = False
                else:
                    self.cumulative_pnl += amount.native
        else:
            # Trader loss = Pool receives (already received via payment in group)
            assert gtxn.PaymentTransaction(0).amount >= amount.native, "Insufficient payment"

            self.total_liquidity += amount.native

            # Track pool profit
            if self.is_pnl_positive:
                self.cumulative_pnl += amount.native
            else:
                if self.cumulative_pnl >= amount.native:
                    self.cumulative_pnl -= amount.native
                else:
                    self.cumulative_pnl = amount.native - self.cumulative_pnl
                    self.is_pnl_positive = True

        return Bool(True)

    @abimethod()
    def process_funding(self, amount: arc4.UInt64, from_longs: Bool) -> Bool:
        """
        Process funding rate payments.

        Args:
            amount: Funding amount
            from_longs: True if longs pay, False if shorts pay

        Returns:
            Success status
        """
        assert Txn.sender == self.perps_market, "Only perps market"

        # Funding payments flow through the pool
        # Net effect on pool depends on OI imbalance
        self.total_funding_collected += amount.native

        return Bool(True)

    @abimethod()
    def get_funding_rate(self) -> arc4.UInt64:
        """
        Get current funding rate.

        Returns:
            Funding rate in basis points per hour
        """
        return arc4.UInt64(self.current_funding_rate)

    @abimethod()
    def is_funding_positive(self) -> Bool:
        """
        Check if funding rate is positive (longs pay shorts).

        Returns:
            True if longs pay shorts
        """
        return Bool(self.funding_rate_is_positive)

    @abimethod()
    def get_pool_stats(self) -> PerpPoolStats:
        """Get pool statistics."""
        available = self.total_liquidity - self.reserved_liquidity

        # Calculate net exposure
        if self.long_open_interest >= self.short_open_interest:
            net_exposure = self.long_open_interest - self.short_open_interest
            is_net_long = Bool(True)
        else:
            net_exposure = self.short_open_interest - self.long_open_interest
            is_net_long = Bool(False)

        return PerpPoolStats(
            total_liquidity=arc4.UInt64(self.total_liquidity),
            available_liquidity=arc4.UInt64(available),
            reserved_liquidity=arc4.UInt64(self.reserved_liquidity),
            total_shares=arc4.UInt64(self.total_shares),
            long_open_interest=arc4.UInt64(self.long_open_interest),
            short_open_interest=arc4.UInt64(self.short_open_interest),
            net_exposure=arc4.UInt64(net_exposure),
            is_net_long=is_net_long,
            total_fees_earned=arc4.UInt64(self.total_trading_fees),
            pool_pnl=arc4.UInt64(self.cumulative_pnl),
            funding_rate=arc4.UInt64(self.current_funding_rate),
            lp_count=arc4.UInt64(self.lp_count),
        )

    @abimethod()
    def get_lp_position(self, account: Address, shares: arc4.UInt64) -> PerpLPPosition:
        """Get LP position details."""
        # Try BoxMap first
        lp_key = account.native.bytes
        if lp_key in self.lp_positions:
            stored = self.lp_positions[lp_key].copy()
            current_value = self._calculate_algo_for_shares(stored.shares.native)
            share_of_pool = UInt64(0)
            if self.total_shares > 0:
                share_of_pool = (stored.shares.native * 10000) // self.total_shares
            return PerpLPPosition(
                shares=stored.shares,
                deposited_value=stored.deposited_value,
                current_value=arc4.UInt64(current_value),
                share_of_pool=arc4.UInt64(share_of_pool),
                entry_time=stored.entry_time,
            )

        # Fallback: calculate from shares parameter
        current_value = self._calculate_algo_for_shares(shares.native)
        share_of_pool = UInt64(0)
        if self.total_shares > 0:
            share_of_pool = (shares.native * 10000) // self.total_shares

        return PerpLPPosition(
            shares=shares,
            deposited_value=arc4.UInt64(0),
            current_value=arc4.UInt64(current_value),
            share_of_pool=arc4.UInt64(share_of_pool),
            entry_time=arc4.UInt64(0),
        )

    @abimethod()
    def get_share_price(self) -> arc4.UInt64:
        """Get current LP share price in ALGO."""
        if self.total_shares == 0:
            return arc4.UInt64(self.share_precision)

        price = (self.total_liquidity * self.share_precision) // self.total_shares
        return arc4.UInt64(price)

    # ========== Admin Functions ==========

    @abimethod()
    def set_max_utilization(self, basis_points: arc4.UInt64) -> Bool:
        """Set maximum pool utilization."""
        assert Txn.sender == self.admin, "Only admin"
        assert basis_points.native <= 9500, "Max 95%"
        assert basis_points.native >= 5000, "Min 50%"
        self.max_utilization = basis_points.native
        return Bool(True)

    @abimethod()
    def set_funding_params(
        self,
        base_rate: arc4.UInt64,
        max_rate: arc4.UInt64,
    ) -> Bool:
        """Set funding rate parameters."""
        assert Txn.sender == self.admin, "Only admin"
        assert max_rate.native <= 500, "Max 5% per hour"
        self.base_funding_rate = base_rate.native
        self.max_funding_rate = max_rate.native
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
            return deposit_amount

        return (deposit_amount * self.total_shares) // self.total_liquidity

    @subroutine
    def _calculate_algo_for_shares(self, shares: UInt64) -> UInt64:
        """Calculate ALGO amount for burning shares."""
        if self.total_shares == 0:
            return UInt64(0)

        return (shares * self.total_liquidity) // self.total_shares

    @subroutine
    def _update_funding_rate(self) -> None:
        """
        Update funding rate based on OI imbalance.

        Funding incentivizes balance:
        - More longs than shorts = positive funding (longs pay shorts)
        - More shorts than longs = negative funding (shorts pay longs)
        """
        total_oi = self.long_open_interest + self.short_open_interest

        if total_oi == 0:
            self.current_funding_rate = UInt64(0)
            return

        # Calculate imbalance ratio
        if self.long_open_interest >= self.short_open_interest:
            imbalance = self.long_open_interest - self.short_open_interest
            self.funding_rate_is_positive = True
        else:
            imbalance = self.short_open_interest - self.long_open_interest
            self.funding_rate_is_positive = False

        # Funding rate = base_rate * (imbalance / total_oi)
        # Scaled: funding_rate = base_rate + (imbalance * max_rate) / total_oi
        imbalance_ratio = (imbalance * 10000) // total_oi
        funding_rate = self.base_funding_rate + ((imbalance_ratio * self.max_funding_rate) // 10000)

        # Cap at max
        if funding_rate > self.max_funding_rate:
            funding_rate = self.max_funding_rate

        self.current_funding_rate = funding_rate
        self.last_funding_update = Global.latest_timestamp
