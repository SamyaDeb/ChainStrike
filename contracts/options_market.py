"""
ChainStrike Options Market Contract

Handles options creation, trading, exercise, and settlement.

Option Types:
- Call options (right to buy ALGO at strike)
- Put options (right to sell ALGO at strike)

Features:
- User-defined expiry times
- European-style (exercise at expiry only)
- Automated settlement via oracle
- Pool-backed collateral
- Premium calculation using simplified Black-Scholes
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


class OptionInfo(Struct):
    """Option contract information"""

    option_id: arc4.UInt64
    is_call: Bool  # True for Call, False for Put
    strike_price: arc4.UInt64  # Strike in microUSD (6 decimals)
    expiry: arc4.UInt64  # Unix timestamp
    size: arc4.UInt64  # Contract size in microALGO
    premium: arc4.UInt64  # Premium paid in microALGO
    collateral: arc4.UInt64  # Collateral locked in pool
    buyer: Address
    creation_time: arc4.UInt64
    settlement_price: arc4.UInt64  # Price at settlement (0 if not settled)
    is_exercised: Bool
    is_settled: Bool


class OptionParams(Struct):
    """Parameters for creating an option"""

    is_call: Bool
    strike_price: arc4.UInt64
    expiry: arc4.UInt64
    size: arc4.UInt64


class PremiumQuote(Struct):
    """Premium quote for an option"""

    premium: arc4.UInt64
    collateral_required: arc4.UInt64
    implied_volatility: arc4.UInt64  # Basis points
    delta: arc4.UInt64  # Scaled by 10000


class MarketStats(Struct):
    """Options market statistics"""

    total_options_created: arc4.UInt64
    total_active_options: arc4.UInt64
    total_premium_volume: arc4.UInt64
    total_settled_volume: arc4.UInt64
    total_call_oi: arc4.UInt64  # Open interest in calls
    total_put_oi: arc4.UInt64  # Open interest in puts


class OptionsMarket(ARC4Contract):
    """
    Options market contract.

    Manages option lifecycle from creation to settlement.
    Integrates with OptionsPool for collateral and Oracle for prices.

    Premium Calculation:
    - Uses simplified Black-Scholes approximation
    - Factors: spot price, strike, time to expiry, volatility
    - Minimum premium floors to ensure pool profitability

    Settlement:
    - European style (exercise at expiry only)
    - Auto-exercise if ITM at expiry
    - Payoff: Call = max(0, spot - strike), Put = max(0, strike - spot)
    """

    def __init__(self) -> None:
        """Initialize options market"""
        # Contract references
        self.oracle = Global.zero_address
        self.options_pool = Global.zero_address
        self.staking_contract = Global.zero_address
        self.oracle_app_id = UInt64(0)
        self.options_pool_app_id = UInt64(0)

        # Market state
        self.next_option_id = UInt64(1)
        self.total_options_created = UInt64(0)
        self.total_active_options = UInt64(0)
        self.total_premium_volume = UInt64(0)
        self.total_settled_volume = UInt64(0)
        self.total_call_oi = UInt64(0)
        self.total_put_oi = UInt64(0)

        # Configuration
        self.admin = Global.creator_address
        self.trading_fee = UInt64(30)  # 0.3% in basis points
        self.min_expiry = UInt64(3600)  # 1 hour minimum
        self.max_expiry = UInt64(2592000)  # 30 days maximum
        self.min_size = UInt64(1_000_000)  # 1 ALGO minimum
        self.implied_volatility = UInt64(8000)  # 80% IV in basis points

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

        # State
        self.is_paused = False

        # Constants for premium calculation
        self.precision = UInt64(1_000_000)  # 6 decimals
        self.vol_precision = UInt64(10000)  # Basis points

        # Box storage for options
        self.options = BoxMap(arc4.UInt64, OptionInfo, key_prefix=b"opt_")

    @abimethod()
    def initialize(
        self,
        oracle: Address,
        options_pool: Address,
        staking_contract: Address,
        oracle_app: arc4.UInt64,
        options_pool_app: arc4.UInt64,
    ) -> Bool:
        """
        Initialize market with contract references.

        Args:
            oracle: Oracle contract address
            options_pool: Options pool contract address
            staking_contract: Staking contract for fees
            oracle_app: Oracle application ID for reading price
            options_pool_app: Options pool application ID for cross-contract calls

        Returns:
            Success status
        """
        assert Txn.sender == self.admin, "Only admin"

        self.oracle = oracle.native
        self.options_pool = options_pool.native
        self.staking_contract = staking_contract.native
        self.oracle_app_id = oracle_app.native
        self.options_pool_app_id = options_pool_app.native

        return Bool(True)

    @abimethod()
    def create_option(
        self,
        is_call: Bool,
        strike_price: arc4.UInt64,
        expiry: arc4.UInt64,
        size: arc4.UInt64,
    ) -> arc4.UInt64:
        """
        Create and buy a new option.
        Premium must be paid in ALGO via group transaction.

        Args:
            is_call: True for Call, False for Put
            strike_price: Strike price in microUSD
            expiry: Expiry timestamp
            size: Contract size in microALGO

        Returns:
            Option ID
        """
        assert not self.is_paused, "Market paused"
        assert self.oracle != Global.zero_address, "Not initialized"

        current_time = Global.latest_timestamp

        # Validate expiry
        time_to_expiry = expiry.native - current_time
        assert time_to_expiry >= self.min_expiry, "Expiry too soon"
        assert time_to_expiry <= self.max_expiry, "Expiry too far"

        # Validate size
        assert size.native >= self.min_size, "Size too small"

        # Get current price from oracle
        spot_price = self._get_oracle_price()
        assert spot_price > 0, "Invalid oracle price"

        # Calculate premium
        premium = self._calculate_premium(
            is_call.native,
            spot_price,
            strike_price.native,
            time_to_expiry,
            size.native,
        )

        # Calculate collateral required
        collateral = self._calculate_collateral(
            is_call.native,
            strike_price.native,
            size.native,
        )

        # Calculate trading fee
        total_fee = (premium * self.trading_fee) // 10000
        total_cost = premium + total_fee

        # Dynamic fee routing based on contract balance
        operational_fee, staking_fee = self._route_fee(total_fee)

        # Verify payment
        assert gtxn.PaymentTransaction(0).amount >= total_cost, "Insufficient payment"
        assert gtxn.PaymentTransaction(0).receiver == Global.current_application_address, "Wrong receiver"

        # Create option record
        option_id = self.next_option_id
        self.next_option_id += 1

        # Store option in BoxMap
        option_key = arc4.UInt64(option_id)
        self.options[option_key] = OptionInfo(
            option_id=arc4.UInt64(option_id),
            is_call=is_call,
            strike_price=strike_price,
            expiry=expiry,
            size=size,
            premium=arc4.UInt64(premium),
            collateral=arc4.UInt64(collateral),
            buyer=Address(Txn.sender),
            creation_time=arc4.UInt64(current_time),
            settlement_price=arc4.UInt64(0),
            is_exercised=Bool(False),
            is_settled=Bool(False),
        )

        # Update market state
        self.total_options_created += 1
        self.total_active_options += 1
        self.total_premium_volume += premium

        if is_call.native:
            self.total_call_oi += size.native
        else:
            self.total_put_oi += size.native

        # Transfer premium to pool via receive_premium method
        # This ensures proper pool accounting
        # The pool expects: payment at index 0, then app call
        itxn.Payment(
            receiver=self.options_pool,
            amount=premium,
            fee=Global.min_txn_fee,
        ).submit()

        # Call receive_premium to update pool state
        itxn.ApplicationCall(
            app_id=self.options_pool_app_id,
            app_args=(arc4.arc4_signature("receive_premium(uint64,uint64)bool"), arc4.UInt64(premium), option_key),
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

        return arc4.UInt64(option_id)

    @abimethod()
    def settle_option(self, option_id: arc4.UInt64) -> arc4.UInt64:
        """
        Settle an option at or after expiry.
        Can be called by anyone (keeper bot or option holder).

        Args:
            option_id: Option to settle

        Returns:
            Settlement payoff (0 if OTM)
        """
        assert not self.is_paused, "Market paused"

        # Fetch option from BoxMap
        option_key = option_id
        assert option_key in self.options, "Option not found"
        option = self.options[option_key].copy()

        current_time = Global.latest_timestamp
        assert option.expiry.native <= current_time, "Not expired yet"
        assert not option.is_settled.native, "Already settled"

        # Get settlement price from oracle
        settlement_price = self._get_oracle_price()
        assert settlement_price > 0, "Invalid oracle price"

        # Calculate payoff based on option type
        payoff = UInt64(0)
        if option.is_call.native:
            # Call payoff = max(0, spot - strike) * size / spot
            if settlement_price > option.strike_price.native:
                profit_per_algo = settlement_price - option.strike_price.native
                payoff = (profit_per_algo * option.size.native) // settlement_price
        else:
            # Put payoff = max(0, strike - spot) * size / strike
            if option.strike_price.native > settlement_price:
                profit_per_algo = option.strike_price.native - settlement_price
                payoff = (profit_per_algo * option.size.native) // option.strike_price.native

        # Update option record as settled
        self.options[option_key] = OptionInfo(
            option_id=option.option_id,
            is_call=option.is_call,
            strike_price=option.strike_price,
            expiry=option.expiry,
            size=option.size,
            premium=option.premium,
            collateral=option.collateral,
            buyer=option.buyer,
            creation_time=option.creation_time,
            settlement_price=arc4.UInt64(settlement_price),
            is_exercised=Bool(payoff > 0),
            is_settled=Bool(True),
        )

        # If ITM, pay buyer via pool's pay_settlement method
        # This ensures proper pool accounting
        if payoff > 0:
            itxn.ApplicationCall(
                app_id=self.options_pool_app_id,
                app_args=(
                    arc4.arc4_signature("pay_settlement(uint64,address,uint64)bool"),
                    arc4.UInt64(payoff),
                    option.buyer,
                    option_id,
                ),
                fee=Global.min_txn_fee,
            ).submit()

        # Update market state
        self.total_active_options -= 1
        self.total_settled_volume += option.size.native

        if option.is_call.native:
            if self.total_call_oi >= option.size.native:
                self.total_call_oi -= option.size.native
        else:
            if self.total_put_oi >= option.size.native:
                self.total_put_oi -= option.size.native

        return arc4.UInt64(payoff)

    @abimethod()
    def calculate_premium(
        self,
        is_call: Bool,
        strike_price: arc4.UInt64,
        expiry: arc4.UInt64,
        size: arc4.UInt64,
    ) -> PremiumQuote:
        """
        Calculate option premium (view function).

        Args:
            is_call: True for Call, False for Put
            strike_price: Strike price in microUSD
            expiry: Expiry timestamp
            size: Contract size in microALGO

        Returns:
            Premium quote with details
        """
        current_time = Global.latest_timestamp
        time_to_expiry = expiry.native - current_time

        # Get spot price
        spot_price = self._get_oracle_price()

        # Calculate premium
        premium = self._calculate_premium(
            is_call.native,
            spot_price,
            strike_price.native,
            time_to_expiry,
            size.native,
        )

        # Calculate collateral
        collateral = self._calculate_collateral(
            is_call.native,
            strike_price.native,
            size.native,
        )

        # Calculate delta (simplified)
        delta = self._calculate_delta(
            is_call.native,
            spot_price,
            strike_price.native,
            time_to_expiry,
        )

        return PremiumQuote(
            premium=arc4.UInt64(premium),
            collateral_required=arc4.UInt64(collateral),
            implied_volatility=arc4.UInt64(self.implied_volatility),
            delta=arc4.UInt64(delta),
        )

    @abimethod()
    def get_payoff(
        self,
        is_call: Bool,
        strike_price: arc4.UInt64,
        size: arc4.UInt64,
        current_price: arc4.UInt64,
    ) -> arc4.UInt64:
        """
        Calculate option payoff at a given price.

        Args:
            is_call: True for Call, False for Put
            strike_price: Strike price in microUSD
            size: Contract size in microALGO
            current_price: Current ALGO price in microUSD

        Returns:
            Payoff in microALGO
        """
        if is_call.native:
            # Call payoff = max(0, spot - strike) * size / strike
            if current_price.native > strike_price.native:
                profit_per_algo = current_price.native - strike_price.native
                # Payoff in ALGO = (profit_per_algo * size) / spot_price
                payoff = (profit_per_algo * size.native) // current_price.native
                return arc4.UInt64(payoff)
        else:
            # Put payoff = max(0, strike - spot) * size / strike
            if strike_price.native > current_price.native:
                profit_per_algo = strike_price.native - current_price.native
                payoff = (profit_per_algo * size.native) // strike_price.native
                return arc4.UInt64(payoff)

        return arc4.UInt64(0)

    @abimethod()
    def get_option_info(self, option_id: arc4.UInt64) -> OptionInfo:
        """
        Get option details.

        Args:
            option_id: Option to query

        Returns:
            Option information
        """
        # Fetch from BoxMap
        option_key = option_id
        assert option_key in self.options, "Option not found"
        return self.options[option_key].copy()

    @abimethod()
    def get_market_stats(self) -> MarketStats:
        """Get market statistics."""
        return MarketStats(
            total_options_created=arc4.UInt64(self.total_options_created),
            total_active_options=arc4.UInt64(self.total_active_options),
            total_premium_volume=arc4.UInt64(self.total_premium_volume),
            total_settled_volume=arc4.UInt64(self.total_settled_volume),
            total_call_oi=arc4.UInt64(self.total_call_oi),
            total_put_oi=arc4.UInt64(self.total_put_oi),
        )

    @abimethod()
    def get_current_price(self) -> arc4.UInt64:
        """Get current ALGO price from oracle."""
        price = self._get_oracle_price()
        return arc4.UInt64(price)

    # ========== Admin Functions ==========

    @abimethod()
    def set_implied_volatility(self, iv: arc4.UInt64) -> Bool:
        """Set implied volatility for premium calculation."""
        assert Txn.sender == self.admin, "Only admin"
        assert iv.native >= 1000, "Min IV 10%"
        assert iv.native <= 30000, "Max IV 300%"
        self.implied_volatility = iv.native
        return Bool(True)

    @abimethod()
    def set_trading_fee(self, fee: arc4.UInt64) -> Bool:
        """Set trading fee in basis points."""
        assert Txn.sender == self.admin, "Only admin"
        assert fee.native <= 100, "Max fee 1%"
        self.trading_fee = fee.native
        return Bool(True)

    @abimethod()
    def set_expiry_limits(self, min_expiry: arc4.UInt64, max_expiry: arc4.UInt64) -> Bool:
        """Set expiry time limits."""
        assert Txn.sender == self.admin, "Only admin"
        assert min_expiry.native >= 60, "Min expiry 1 minute"
        assert max_expiry.native <= 7776000, "Max expiry 90 days"
        self.min_expiry = min_expiry.native
        self.max_expiry = max_expiry.native
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
    def _calculate_premium(
        self,
        is_call: bool,
        spot_price: UInt64,
        strike_price: UInt64,
        time_to_expiry: UInt64,
        size: UInt64,
    ) -> UInt64:
        """
        Calculate option premium using simplified Black-Scholes.

        Approximation:
        - ATM options: premium ≈ 0.4 * spot * volatility * sqrt(time)
        - Adjust for moneyness (ITM/OTM)
        """
        if spot_price == 0 or time_to_expiry == 0:
            return UInt64(0)

        # Time factor: sqrt(time_to_expiry / year) * 10000
        # Approximation: sqrt(seconds / 31536000) * 10000
        time_factor = self._sqrt_approx((time_to_expiry * 10000) // 31536000)

        # Volatility factor with time-based scaling for short-term options
        # Short-term options have higher implied volatility (volatility smile)
        if time_to_expiry <= 60:
            # 1-minute options: double IV (e.g., 80% -> 160%)
            vol_factor = self.implied_volatility * 2
        elif time_to_expiry <= 300:
            # 5-minute options: 1.5x IV (e.g., 80% -> 120%)
            vol_factor = (self.implied_volatility * 3) // 2
        else:
            # Longer expiries: use base IV
            vol_factor = self.implied_volatility

        # Base premium for ATM option: 0.4 * spot * vol * sqrt(time)
        # Scaled: (spot * vol_factor * time_factor * 4) / (10000 * 10000 * 10)
        base_premium = (spot_price * vol_factor * time_factor * 4) // 1_000_000_000

        # Adjust for moneyness
        if is_call:
            if strike_price < spot_price:
                # ITM Call - add intrinsic value
                intrinsic = spot_price - strike_price
                base_premium += (intrinsic * size) // spot_price
            elif strike_price > spot_price:
                # OTM Call - reduce premium
                otm_ratio = ((strike_price - spot_price) * 10000) // spot_price
                if otm_ratio < 5000:  # Within 50% OTM
                    base_premium = (base_premium * (10000 - otm_ratio)) // 10000
                else:
                    base_premium = base_premium // 4  # Deep OTM
        else:
            if strike_price > spot_price:
                # ITM Put - add intrinsic value
                intrinsic = strike_price - spot_price
                base_premium += (intrinsic * size) // strike_price
            elif strike_price < spot_price:
                # OTM Put - reduce premium
                otm_ratio = ((spot_price - strike_price) * 10000) // spot_price
                if otm_ratio < 5000:
                    base_premium = (base_premium * (10000 - otm_ratio)) // 10000
                else:
                    base_premium = base_premium // 4

        # Scale by size
        premium = (base_premium * size) // self.precision

        # Minimum premium - higher for short-term options to prevent dust trades
        if time_to_expiry <= 300:
            # <5 minutes: 1% minimum
            min_premium = size // 100
        else:
            # Longer expiries: 0.5% minimum
            min_premium = size // 200

        if premium < min_premium:
            premium = min_premium

        return premium

    @subroutine
    def _calculate_collateral(
        self,
        is_call: bool,
        strike_price: UInt64,
        size: UInt64,
    ) -> UInt64:
        """
        Calculate collateral required from pool.

        Call: Full notional value (can lose unlimited)
        Put: Strike value (max loss is strike)
        """
        if is_call:
            # For calls, collateral = size (full notional in ALGO)
            return size
        else:
            # For puts, collateral = strike_value in ALGO
            # collateral = (strike_price * size) / current_price
            # Simplified: use size as collateral (conservative)
            return size

    @subroutine
    def _calculate_delta(
        self,
        is_call: bool,
        spot_price: UInt64,
        strike_price: UInt64,
        time_to_expiry: UInt64,
    ) -> UInt64:
        """
        Calculate option delta (simplified).
        Delta represents price sensitivity.
        """
        if spot_price == 0:
            return UInt64(5000)  # 0.5 default

        # Moneyness ratio
        if is_call:
            if spot_price >= strike_price:
                # ITM call: delta approaches 1
                itm_ratio = ((spot_price - strike_price) * 10000) // spot_price
                delta = 5000 + (itm_ratio // 2)  # 0.5 to 1.0
                if delta > 9500:
                    delta = UInt64(9500)
            else:
                # OTM call: delta approaches 0
                otm_ratio = ((strike_price - spot_price) * 10000) // spot_price
                delta = 5000 - (otm_ratio // 2)  # 0.5 to 0
                if delta < 500:
                    delta = UInt64(500)
        else:
            if strike_price >= spot_price:
                # ITM put: delta approaches -1 (absolute)
                itm_ratio = ((strike_price - spot_price) * 10000) // strike_price
                delta = 5000 + (itm_ratio // 2)
                if delta > 9500:
                    delta = UInt64(9500)
            else:
                # OTM put
                otm_ratio = ((spot_price - strike_price) * 10000) // spot_price
                delta = 5000 - (otm_ratio // 2)
                if delta < 500:
                    delta = UInt64(500)

        return delta

    @subroutine
    def _sqrt_approx(self, x: UInt64) -> UInt64:
        """
        Approximate square root using Newton's method.
        Returns sqrt(x) scaled appropriately.
        """
        if x == 0:
            return UInt64(0)
        if x < 100:
            return UInt64(10)  # Minimum

        # Initial guess
        z = x
        y = (z + 1) // 2

        # Newton's iterations (5 iterations for reasonable precision)
        while y < z:
            z = y
            y = (x // y + y) // 2

        return z
