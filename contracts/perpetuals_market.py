"""
ChainStrike Perpetuals Market Contract

Manages perpetual futures contracts on ALGO:
- Long and short positions
- Leverage up to 20x
- Funding rate mechanism
- Automated liquidations

Features:
- Open/close positions
- Add/remove margin
- Funding rate payments
- Liquidation engine with rewards
- PnL calculation and settlement
"""

from algopy import (
    ARC4Contract,
    Account,
    Application,
    Asset,
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


class Position(Struct):
    """Perpetual position information"""

    position_id: arc4.UInt64
    trader: Address
    is_long: Bool  # True for long, False for short
    size: arc4.UInt64  # Position size in microALGO
    collateral: arc4.UInt64  # Margin/collateral posted
    leverage: arc4.UInt64  # Leverage multiplier (100 = 1x, 2000 = 20x)
    entry_price: arc4.UInt64  # Entry price in microUSD
    liquidation_price: arc4.UInt64  # Auto-liquidation price
    last_funding_time: arc4.UInt64  # Last funding payment timestamp
    accumulated_funding: arc4.UInt64  # Total funding paid/received
    open_time: arc4.UInt64
    is_open: Bool


class PositionPnL(Struct):
    """Position profit/loss calculation"""

    unrealized_pnl: arc4.UInt64
    is_profit: Bool
    funding_pnl: arc4.UInt64
    funding_is_positive: Bool
    liquidation_price: arc4.UInt64
    margin_ratio: arc4.UInt64  # Current margin ratio in basis points


class MarketStats(Struct):
    """Perpetuals market statistics"""

    total_positions: arc4.UInt64
    active_positions: arc4.UInt64
    total_volume: arc4.UInt64
    total_long_oi: arc4.UInt64
    total_short_oi: arc4.UInt64
    total_liquidations: arc4.UInt64
    total_fees_collected: arc4.UInt64
    current_price: arc4.UInt64
    funding_rate: arc4.UInt64


class PerpetualsMarket(ARC4Contract):
    """
    Perpetual futures market contract.

    Enables leveraged trading on ALGO price with no expiry.
    Pool acts as counterparty to all positions.

    Position Mechanics:
    - Long: Profit when price increases, loss when decreases
    - Short: Profit when price decreases, loss when increases
    - Leverage amplifies both profits and losses

    Liquidation:
    - Triggered when margin ratio falls below maintenance margin
    - Liquidator receives reward (percentage of remaining margin)
    - Remaining margin goes to pool

    Funding:
    - Paid every hour
    - Rate determined by OI imbalance
    - Incentivizes balanced market
    """

    def __init__(self) -> None:
        """Initialize perpetuals market"""
        # Contract references
        self.oracle = Global.zero_address
        self.perps_pool = Global.zero_address
        self.staking_contract = Global.zero_address
        self.oracle_app_id = UInt64(0)
        self.perps_pool_app_id = UInt64(0)

        # Position tracking
        self.next_position_id = UInt64(1)
        self.total_positions = UInt64(0)
        self.active_positions = UInt64(0)
        self.total_long_oi = UInt64(0)
        self.total_short_oi = UInt64(0)

        # Volume and fees
        self.total_volume = UInt64(0)
        self.total_fees_collected = UInt64(0)
        self.total_liquidations = UInt64(0)

        # Configuration
        self.admin = Global.creator_address
        self.min_leverage = UInt64(100)  # 1x (scaled by 100)
        self.max_leverage = UInt64(2000)  # 20x
        self.min_margin = UInt64(1_000_000)  # 1 ALGO minimum margin
        self.min_position_size = UInt64(10_000_000)  # 10 ALGO minimum size

        # Fee structure (basis points)
        self.open_fee = UInt64(10)  # 0.1% opening fee
        self.close_fee = UInt64(10)  # 0.1% closing fee
        self.liquidation_fee = UInt64(100)  # 1% liquidation penalty
        self.liquidator_reward = UInt64(50)  # 0.5% to liquidator

        # Dynamic fee routing thresholds (Model 1)
        self.min_operational_balance = UInt64(1_000_000)  # 1 ALGO - critical threshold
        self.reserve_target = UInt64(10_000_000)  # 10 ALGO - healthy threshold

        # Fee split percentages (basis points) for different states
        # CRITICAL (<1 ALGO): 100% operational, 0% staking
        # BUILDING (1-10 ALGO): 50% operational, 50% staking
        # HEALTHY (>10 ALGO): 10% operational, 90% staking
        self.critical_operational_share = UInt64(10000)  # 100%
        self.building_operational_share = UInt64(5000)  # 50%
        self.healthy_operational_share = UInt64(1000)  # 10%

        # Operational reserve tracking
        self.operational_reserve = UInt64(0)

        # Margin requirements (basis points)
        self.initial_margin = UInt64(500)  # 5% initial margin
        self.maintenance_margin = UInt64(250)  # 2.5% maintenance margin

        # State
        self.is_paused = False

        # Precision
        self.price_precision = UInt64(1_000_000)  # 6 decimals
        self.leverage_precision = UInt64(100)  # 100 = 1x

        # Box storage for positions
        self.positions = BoxMap(arc4.UInt64, Position, key_prefix=b"pos_")

    @abimethod()
    def initialize(
        self,
        oracle: Address,
        perps_pool: Address,
        staking_contract: Address,
        oracle_app: arc4.UInt64,
        perps_pool_app: arc4.UInt64,
    ) -> Bool:
        """
        Initialize market with contract references.

        Args:
            oracle: Oracle contract address
            perps_pool: Perpetuals pool contract address
            staking_contract: Staking contract for fees
            oracle_app: Oracle application ID for reading price
            perps_pool_app: Perpetuals pool application ID for PnL calls

        Returns:
            Success status
        """
        assert Txn.sender == self.admin, "Only admin"

        self.oracle = oracle.native
        self.perps_pool = perps_pool.native
        self.staking_contract = staking_contract.native
        self.oracle_app_id = oracle_app.native
        self.perps_pool_app_id = perps_pool_app.native

        return Bool(True)

    @abimethod()
    def open_position(
        self,
        is_long: Bool,
        size: arc4.UInt64,
        leverage: arc4.UInt64,
    ) -> arc4.UInt64:
        """
        Open a perpetual position.
        Margin must be sent as ALGO payment in group transaction.

        Args:
            is_long: True for long, False for short
            size: Position size in microALGO
            leverage: Leverage multiplier (100-2000)

        Returns:
            Position ID
        """
        assert not self.is_paused, "Market paused"
        assert self.oracle != Global.zero_address, "Not initialized"

        # Validate leverage
        assert leverage.native >= self.min_leverage, "Leverage too low"
        assert leverage.native <= self.max_leverage, "Leverage too high"

        # Validate size
        assert size.native >= self.min_position_size, "Position too small"

        # Calculate required margin
        # margin = size / leverage
        required_margin = (size.native * self.leverage_precision) // leverage.native
        assert required_margin >= self.min_margin, "Margin too low"

        # Verify margin payment
        payment_amount = gtxn.PaymentTransaction(0).amount
        assert payment_amount >= required_margin, "Insufficient margin"
        assert gtxn.PaymentTransaction(0).receiver == Global.current_application_address, "Wrong receiver"

        # Get current price
        current_price = self._get_oracle_price()
        assert current_price > 0, "Invalid oracle price"

        # Calculate opening fee
        total_fee = (size.native * self.open_fee) // 10000
        net_margin = payment_amount - total_fee

        # Dynamic fee routing based on contract balance
        operational_fee, staking_fee = self._route_fee(total_fee)

        # Calculate liquidation price
        liquidation_price = self._calculate_liquidation_price(
            is_long.native,
            current_price,
            net_margin,
            size.native,
        )

        # Create position
        position_id = self.next_position_id
        self.next_position_id += 1

        # Store position in BoxMap
        position_key = arc4.UInt64(position_id)
        self.positions[position_key] = Position(
            position_id=arc4.UInt64(position_id),
            trader=Address(Txn.sender),
            is_long=is_long,
            size=size,
            collateral=arc4.UInt64(net_margin),
            leverage=leverage,
            entry_price=arc4.UInt64(current_price),
            liquidation_price=arc4.UInt64(liquidation_price),
            last_funding_time=arc4.UInt64(Global.latest_timestamp),
            accumulated_funding=arc4.UInt64(0),
            open_time=arc4.UInt64(Global.latest_timestamp),
            is_open=Bool(True),
        )

        # Update market state
        self.total_positions += 1
        self.active_positions += 1
        self.total_volume += size.native

        if is_long.native:
            self.total_long_oi += size.native
        else:
            self.total_short_oi += size.native

        # Transfer margin to pool
        itxn.Payment(
            receiver=self.perps_pool,
            amount=net_margin,
            fee=Global.min_txn_fee,
        ).submit()

        # Keep operational fee in contract (no action needed - stays in balance)
        self.operational_reserve += operational_fee

        # Transfer only staking portion to staking contract
        if staking_fee > 0:
            itxn.Payment(
                receiver=self.staking_contract,
                amount=staking_fee,
                fee=Global.min_txn_fee,
            ).submit()

        self.total_fees_collected += total_fee

        return arc4.UInt64(position_id)

    @abimethod()
    def close_position(self, position_id: arc4.UInt64) -> arc4.UInt64:
        """
        Close an open position.

        Args:
            position_id: Position to close

        Returns:
            Amount returned to trader (margin +/- PnL - fees)
        """
        assert not self.is_paused, "Market paused"

        # Fetch position from BoxMap
        position_key = position_id
        assert position_key in self.positions, "Position not found"
        pos = self.positions[position_key].copy()

        assert pos.is_open.native, "Position already closed"
        assert Txn.sender == pos.trader.native, "Not position owner"

        # Get current price
        current_price = self._get_oracle_price()
        assert current_price > 0, "Invalid oracle price"

        # Calculate PnL
        pnl = UInt64(0)
        is_profit = True

        if pos.is_long.native:
            if current_price >= pos.entry_price.native:
                price_diff = current_price - pos.entry_price.native
                is_profit = True
            else:
                price_diff = pos.entry_price.native - current_price
                is_profit = False
        else:
            if pos.entry_price.native >= current_price:
                price_diff = pos.entry_price.native - current_price
                is_profit = True
            else:
                price_diff = current_price - pos.entry_price.native
                is_profit = False

        if pos.entry_price.native > 0:
            pnl = (price_diff * pos.size.native) // pos.entry_price.native

        # Calculate closing fee
        total_fee = (pos.size.native * self.close_fee) // 10000

        # Dynamic fee routing based on contract balance
        operational_fee, staking_fee = self._route_fee(total_fee)

        # Calculate net return
        net_return = UInt64(0)
        if is_profit:
            net_return = pos.collateral.native + pnl
            if net_return > total_fee:
                net_return -= total_fee
            else:
                net_return = UInt64(0)
        else:
            if pos.collateral.native > pnl:
                net_return = pos.collateral.native - pnl
                if net_return > total_fee:
                    net_return -= total_fee
                else:
                    net_return = UInt64(0)
            else:
                net_return = UInt64(0)

        # Mark position as closed in BoxMap
        self.positions[position_key] = Position(
            position_id=pos.position_id,
            trader=pos.trader,
            is_long=pos.is_long,
            size=pos.size,
            collateral=pos.collateral,
            leverage=pos.leverage,
            entry_price=pos.entry_price,
            liquidation_price=pos.liquidation_price,
            last_funding_time=pos.last_funding_time,
            accumulated_funding=pos.accumulated_funding,
            open_time=pos.open_time,
            is_open=Bool(False),
        )

        # Process PnL and return funds through pool
        # Pool handles the payout to trader if profitable
        if net_return > 0:
            # Call pool's process_pnl method to handle trader payout
            # For profit: pool pays trader
            # For loss: collateral stays in pool (already transferred during open)
            itxn.ApplicationCall(
                app_id=Application(self.perps_pool_app_id),
                app_args=(
                    arc4.arc4_signature("process_pnl(uint64,bool,address)bool"),
                    arc4.UInt64(net_return),
                    arc4.Bool(is_profit),
                    pos.trader,
                ),
                fee=Global.min_txn_fee,
            ).submit()

        # Keep operational fee in contract (no action needed - stays in balance)
        self.operational_reserve += operational_fee

        # Transfer only staking portion to staking contract
        if staking_fee > 0:
            itxn.Payment(
                receiver=self.staking_contract,
                amount=staking_fee,
                fee=Global.min_txn_fee,
            ).submit()

        # Update market state
        self.active_positions -= 1
        self.total_fees_collected += total_fee

        if pos.is_long.native:
            if self.total_long_oi >= pos.size.native:
                self.total_long_oi -= pos.size.native
        else:
            if self.total_short_oi >= pos.size.native:
                self.total_short_oi -= pos.size.native

        return arc4.UInt64(net_return)

    @abimethod()
    def add_margin(self, position_id: arc4.UInt64, amount: arc4.UInt64) -> Bool:
        """
        Add margin to an existing position.
        ALGO must be sent in group transaction.

        Args:
            position_id: Position to add margin to
            amount: Amount of margin to add

        Returns:
            Success status
        """
        assert not self.is_paused, "Market paused"

        # Verify payment
        assert gtxn.PaymentTransaction(0).amount >= amount.native, "Insufficient payment"
        assert gtxn.PaymentTransaction(0).receiver == Global.current_application_address, "Wrong receiver"

        # In production:
        # 1. Verify caller is position owner
        # 2. Fetch position from box
        # 3. Add margin to collateral
        # 4. Recalculate liquidation price
        # 5. Update position in box

        # Transfer margin to pool
        itxn.Payment(
            receiver=self.perps_pool,
            amount=amount.native,
            fee=Global.min_txn_fee,
        ).submit()

        return Bool(True)

    @abimethod()
    def remove_margin(self, position_id: arc4.UInt64, amount: arc4.UInt64) -> Bool:
        """
        Remove margin from a position.

        Args:
            position_id: Position to remove margin from
            amount: Amount of margin to remove

        Returns:
            Success status
        """
        assert not self.is_paused, "Market paused"

        # In production:
        # 1. Verify caller is position owner
        # 2. Fetch position from box
        # 3. Calculate new margin after removal
        # 4. Verify new margin meets maintenance requirement
        # 5. Recalculate liquidation price
        # 6. Transfer margin back to trader

        return Bool(True)

    @abimethod()
    def liquidate(self, position_id: arc4.UInt64) -> Bool:
        """
        Liquidate an underwater position.
        Anyone can call this to liquidate positions below maintenance margin.
        Liquidator receives a reward.

        Args:
            position_id: Position to liquidate

        Returns:
            Success status
        """
        assert not self.is_paused, "Market paused"

        # Get current price
        current_price = self._get_oracle_price()
        assert current_price > 0, "Invalid oracle price"

        # Fetch position from BoxMap
        position_key = position_id
        assert position_key in self.positions, "Position not found"
        pos = self.positions[position_key].copy()

        assert pos.is_open.native, "Position already closed"

        # Calculate current PnL
        pnl = UInt64(0)
        is_profit = True

        if pos.is_long.native:
            if current_price >= pos.entry_price.native:
                is_profit = True
                price_diff = current_price - pos.entry_price.native
            else:
                is_profit = False
                price_diff = pos.entry_price.native - current_price
        else:
            if pos.entry_price.native >= current_price:
                is_profit = True
                price_diff = pos.entry_price.native - current_price
            else:
                is_profit = False
                price_diff = current_price - pos.entry_price.native

        if pos.entry_price.native > 0:
            pnl = (price_diff * pos.size.native) // pos.entry_price.native

        # Calculate effective margin
        effective_margin = pos.collateral.native
        if is_profit:
            effective_margin += pnl
        else:
            if effective_margin > pnl:
                effective_margin -= pnl
            else:
                effective_margin = UInt64(0)

        # Verify position is liquidatable
        margin_ratio = UInt64(0)
        if pos.size.native > 0:
            margin_ratio = (effective_margin * 10000) // pos.size.native
        assert margin_ratio < self.maintenance_margin, "Position not liquidatable"

        # Calculate liquidator reward
        reward = UInt64(0)
        if effective_margin > 0:
            reward = (effective_margin * self.liquidator_reward) // 10000

        # Remainder goes to pool
        remainder = UInt64(0)
        if effective_margin > reward:
            remainder = effective_margin - reward

        # Mark position as closed
        self.positions[position_key] = Position(
            position_id=pos.position_id,
            trader=pos.trader,
            is_long=pos.is_long,
            size=pos.size,
            collateral=pos.collateral,
            leverage=pos.leverage,
            entry_price=pos.entry_price,
            liquidation_price=pos.liquidation_price,
            last_funding_time=pos.last_funding_time,
            accumulated_funding=pos.accumulated_funding,
            open_time=pos.open_time,
            is_open=Bool(False),
        )

        # Pay liquidator reward
        if reward > 0:
            itxn.Payment(
                receiver=Txn.sender,
                amount=reward,
                fee=Global.min_txn_fee,
            ).submit()

        # Send remainder to pool
        if remainder > 0:
            itxn.Payment(
                receiver=self.perps_pool,
                amount=remainder,
                fee=Global.min_txn_fee,
            ).submit()

        # Update market state
        self.total_liquidations += 1
        self.active_positions -= 1

        if pos.is_long.native:
            if self.total_long_oi >= pos.size.native:
                self.total_long_oi -= pos.size.native
        else:
            if self.total_short_oi >= pos.size.native:
                self.total_short_oi -= pos.size.native

        return Bool(True)

    @abimethod()
    def apply_funding(self, position_id: arc4.UInt64) -> Bool:
        """
        Apply accumulated funding to a position.
        Can be called by anyone (keeper bot).

        Args:
            position_id: Position to apply funding to

        Returns:
            Success status
        """
        # In production:
        # 1. Fetch position from box
        # 2. Get funding rate from pool
        # 3. Calculate time since last funding
        # 4. Calculate funding payment
        # 5. Update position margin (add or subtract)
        # 6. Update accumulated_funding and last_funding_time
        # 7. Update liquidation price if needed

        return Bool(True)

    @abimethod()
    def calculate_pnl(
        self,
        is_long: Bool,
        entry_price: arc4.UInt64,
        current_price: arc4.UInt64,
        size: arc4.UInt64,
    ) -> PositionPnL:
        """
        Calculate position PnL.

        Args:
            is_long: Position direction
            entry_price: Entry price in microUSD
            current_price: Current price in microUSD
            size: Position size in microALGO

        Returns:
            PnL details
        """
        pnl = UInt64(0)
        is_profit = True

        if is_long.native:
            # Long PnL = (current - entry) / entry * size
            if current_price.native >= entry_price.native:
                price_diff = current_price.native - entry_price.native
                is_profit = True
            else:
                price_diff = entry_price.native - current_price.native
                is_profit = False
        else:
            # Short PnL = (entry - current) / entry * size
            if entry_price.native >= current_price.native:
                price_diff = entry_price.native - current_price.native
                is_profit = True
            else:
                price_diff = current_price.native - entry_price.native
                is_profit = False

        # Calculate PnL in ALGO
        # pnl = (price_diff * size) / entry_price
        if entry_price.native > 0:
            pnl = (price_diff * size.native) // entry_price.native

        return PositionPnL(
            unrealized_pnl=arc4.UInt64(pnl),
            is_profit=Bool(is_profit),
            funding_pnl=arc4.UInt64(0),
            funding_is_positive=Bool(True),
            liquidation_price=arc4.UInt64(0),
            margin_ratio=arc4.UInt64(0),
        )

    @abimethod()
    def is_liquidatable(
        self,
        is_long: Bool,
        entry_price: arc4.UInt64,
        collateral: arc4.UInt64,
        size: arc4.UInt64,
        current_price: arc4.UInt64,
    ) -> Bool:
        """
        Check if a position is liquidatable.

        Args:
            is_long: Position direction
            entry_price: Entry price
            collateral: Current margin
            size: Position size
            current_price: Current price

        Returns:
            True if liquidatable
        """
        # Calculate current PnL
        pnl_result = self.calculate_pnl(is_long, entry_price, current_price, size)

        # Calculate current margin
        effective_margin = collateral.native
        if pnl_result.is_profit.native:
            effective_margin += pnl_result.unrealized_pnl.native
        else:
            if effective_margin > pnl_result.unrealized_pnl.native:
                effective_margin -= pnl_result.unrealized_pnl.native
            else:
                # Negative margin = definitely liquidatable
                return Bool(True)

        # Calculate margin ratio
        # margin_ratio = (effective_margin * 10000) / size
        margin_ratio = (effective_margin * 10000) // size.native

        # Liquidatable if below maintenance margin
        return Bool(margin_ratio < self.maintenance_margin)

    @abimethod()
    def get_position(self, position_id: arc4.UInt64) -> Position:
        """Get position details."""
        # Fetch from BoxMap
        position_key = position_id
        assert position_key in self.positions, "Position not found"
        return self.positions[position_key].copy()

    @abimethod()
    def get_market_stats(self) -> MarketStats:
        """Get market statistics."""
        current_price = self._get_oracle_price()

        # Get funding rate from pool (would be inner transaction)
        funding_rate = UInt64(0)

        return MarketStats(
            total_positions=arc4.UInt64(self.total_positions),
            active_positions=arc4.UInt64(self.active_positions),
            total_volume=arc4.UInt64(self.total_volume),
            total_long_oi=arc4.UInt64(self.total_long_oi),
            total_short_oi=arc4.UInt64(self.total_short_oi),
            total_liquidations=arc4.UInt64(self.total_liquidations),
            total_fees_collected=arc4.UInt64(self.total_fees_collected),
            current_price=arc4.UInt64(current_price),
            funding_rate=arc4.UInt64(funding_rate),
        )

    @abimethod()
    def get_current_price(self) -> arc4.UInt64:
        """Get current ALGO price from oracle."""
        price = self._get_oracle_price()
        return arc4.UInt64(price)

    @abimethod()
    def calculate_required_margin(
        self,
        size: arc4.UInt64,
        leverage: arc4.UInt64,
    ) -> arc4.UInt64:
        """
        Calculate required margin for a position.

        Args:
            size: Position size in microALGO
            leverage: Leverage multiplier (100 = 1x)

        Returns:
            Required margin in microALGO
        """
        margin = (size.native * self.leverage_precision) // leverage.native
        if margin < self.min_margin:
            margin = self.min_margin
        return arc4.UInt64(margin)

    @abimethod()
    def calculate_liquidation_price_view(
        self,
        is_long: Bool,
        entry_price: arc4.UInt64,
        collateral: arc4.UInt64,
        size: arc4.UInt64,
    ) -> arc4.UInt64:
        """
        Calculate liquidation price for a position.

        Args:
            is_long: Position direction
            entry_price: Entry price
            collateral: Margin posted
            size: Position size

        Returns:
            Liquidation price in microUSD
        """
        liq_price = self._calculate_liquidation_price(
            is_long.native,
            entry_price.native,
            collateral.native,
            size.native,
        )
        return arc4.UInt64(liq_price)

    # ========== Admin Functions ==========

    @abimethod()
    def set_leverage_limits(self, min_lev: arc4.UInt64, max_lev: arc4.UInt64) -> Bool:
        """Set leverage limits."""
        assert Txn.sender == self.admin, "Only admin"
        assert min_lev.native >= 100, "Min 1x leverage"
        assert max_lev.native <= 10000, "Max 100x leverage"
        self.min_leverage = min_lev.native
        self.max_leverage = max_lev.native
        return Bool(True)

    @abimethod()
    def set_fees(
        self,
        open_fee: arc4.UInt64,
        close_fee: arc4.UInt64,
        liquidation_fee: arc4.UInt64,
    ) -> Bool:
        """Set trading fees."""
        assert Txn.sender == self.admin, "Only admin"
        assert open_fee.native <= 100, "Max 1% open fee"
        assert close_fee.native <= 100, "Max 1% close fee"
        assert liquidation_fee.native <= 500, "Max 5% liquidation fee"
        self.open_fee = open_fee.native
        self.close_fee = close_fee.native
        self.liquidation_fee = liquidation_fee.native
        return Bool(True)

    @abimethod()
    def set_margin_requirements(
        self,
        initial: arc4.UInt64,
        maintenance: arc4.UInt64,
    ) -> Bool:
        """Set margin requirements."""
        assert Txn.sender == self.admin, "Only admin"
        assert initial.native > maintenance.native, "Initial > maintenance"
        assert maintenance.native >= 100, "Min 1% maintenance"
        self.initial_margin = initial.native
        self.maintenance_margin = maintenance.native
        return Bool(True)

    @abimethod()
    def update_pool_app_id(self, pool_app_id: arc4.UInt64) -> Bool:
        """Update pool application ID (for contract upgrades)."""
        assert Txn.sender == self.admin, "Only admin"
        self.perps_pool_app_id = pool_app_id.native
        return Bool(True)

    @abimethod()
    def transfer_admin(self, new_admin: Address) -> Bool:
        """Transfer admin role."""
        assert Txn.sender == self.admin, "Only admin"
        self.admin = new_admin.native
        return Bool(True)

    @abimethod()
    def pause(self) -> Bool:
        """Pause market operations."""
        assert Txn.sender == self.admin, "Only admin"
        self.is_paused = True
        return Bool(True)

    @abimethod()
    def unpause(self) -> Bool:
        """Unpause market operations."""
        assert Txn.sender == self.admin, "Only admin"
        self.is_paused = False
        return Bool(True)

    # ========== Fee Routing & Monitoring ==========

    @abimethod(readonly=True)
    def get_operational_stats(self) -> tuple[arc4.UInt64, arc4.UInt64, arc4.UInt64]:
        """
        Get operational health metrics.

        Returns:
            (contract_balance, operational_reserve, reserve_target)
        """
        return (
            arc4.UInt64(op.balance(Global.current_application_address)),
            arc4.UInt64(self.operational_reserve),
            arc4.UInt64(self.reserve_target),
        )

    @abimethod(readonly=True)
    def get_current_fee_split(self) -> tuple[arc4.UInt64, arc4.UInt64]:
        """
        Get current fee split percentages based on contract health.

        Returns:
            (operational_percentage, staking_percentage) in basis points
        """
        current_balance = op.balance(Global.current_application_address)

        if current_balance < self.min_operational_balance:
            return (arc4.UInt64(10000), arc4.UInt64(0))  # 100/0 - Critical
        elif current_balance < self.reserve_target:
            return (arc4.UInt64(5000), arc4.UInt64(5000))  # 50/50 - Building
        else:
            return (arc4.UInt64(1000), arc4.UInt64(9000))  # 10/90 - Healthy

    @abimethod()
    def set_fee_routing_thresholds(
        self,
        min_operational: arc4.UInt64,
        reserve_target: arc4.UInt64,
    ) -> Bool:
        """
        Set fee routing thresholds (admin only).

        Args:
            min_operational: Minimum balance before critical mode (default 1 ALGO)
            reserve_target: Target balance for healthy mode (default 10 ALGO)

        Returns:
            Success status
        """
        assert Txn.sender == self.admin, "Only admin"
        assert min_operational.native >= 100_000, "Min 0.1 ALGO"
        assert reserve_target.native > min_operational.native, "Target > min"

        self.min_operational_balance = min_operational.native
        self.reserve_target = reserve_target.native
        return Bool(True)

    # ========== Internal Helpers ==========

    @subroutine
    def _route_fee(self, total_fee: UInt64) -> tuple[UInt64, UInt64]:
        """
        Dynamically route fees based on contract balance.

        Returns:
            (operational_fee, staking_fee)
        """
        current_balance = op.balance(Global.current_application_address)

        operational_fee = UInt64(0)

        if current_balance < self.min_operational_balance:
            # CRITICAL: Keep all fees for operations
            operational_fee = total_fee
        elif current_balance < self.reserve_target:
            # BUILDING: 50/50 split
            operational_fee = (total_fee * self.building_operational_share) // 10000
        else:
            # HEALTHY: 10% operational, 90% staking
            operational_fee = (total_fee * self.healthy_operational_share) // 10000

        staking_fee = total_fee - operational_fee

        return operational_fee, staking_fee

    @subroutine
    def _get_oracle_price(self) -> UInt64:
        """Get current ALGO price from oracle contract via app_global_get_ex."""
        assert self.oracle_app_id > 0, "Oracle not configured"
        price, exists = op.AppGlobal.get_ex_uint64(self.oracle_app_id, b"current_price")
        assert exists, "Oracle price not available"
        assert price > 0, "Oracle price is zero"
        return price

    @subroutine
    def _calculate_liquidation_price(
        self,
        is_long: bool,
        entry_price: UInt64,
        collateral: UInt64,
        size: UInt64,
    ) -> UInt64:
        """
        Calculate liquidation price.

        Liquidation occurs when:
        - Position value - losses = maintenance_margin * size

        For long:
        - liq_price = entry_price * (1 - (collateral - maint_margin*size/10000) / size)

        For short:
        - liq_price = entry_price * (1 + (collateral - maint_margin*size/10000) / size)
        """
        if size == 0:
            return UInt64(0)

        # Maintenance margin amount
        maint_amount = (size * self.maintenance_margin) // 10000

        if collateral <= maint_amount:
            # Already liquidatable
            return entry_price

        # Buffer before liquidation
        buffer = collateral - maint_amount

        # Price movement that triggers liquidation
        # price_change = (buffer * entry_price) / size
        price_change = (buffer * entry_price) // size

        if is_long:
            # Long liquidates when price drops
            if entry_price > price_change:
                return entry_price - price_change
            else:
                return UInt64(1)  # Minimum price
        else:
            # Short liquidates when price rises
            return entry_price + price_change
