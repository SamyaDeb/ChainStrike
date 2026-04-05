"""
ChainStrike Oracle Contract

Multi-source price oracle aggregating ALGO price from:
- Binance API
- CoinGecko API
- Vestige DEX

Provides reliable price feeds for options and perpetuals contracts.
Uses median calculation for manipulation resistance.
"""

from algopy import (
    ARC4Contract,
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


class PriceData(Struct):
    """Price data structure"""

    price: arc4.UInt64  # Price in microUSD (6 decimals) per ALGO
    timestamp: arc4.UInt64  # Unix timestamp of update
    source_count: arc4.UInt64  # Number of sources used
    confidence: arc4.UInt64  # Confidence score (0-100)


class SourcePrice(Struct):
    """Individual source price"""

    price: arc4.UInt64
    timestamp: arc4.UInt64
    is_valid: Bool


class Oracle(ARC4Contract):
    """
    Oracle contract for ALGO/USD price feeds.

    Features:
    - Multi-source price aggregation (3 sources)
    - Median calculation for manipulation resistance
    - Configurable staleness threshold
    - Admin controls for source management
    - Price deviation alerts

    Price Format:
    - All prices in microUSD (6 decimals)
    - Example: $0.15 = 150000 microUSD
    """

    def __init__(self) -> None:
        """Initialize oracle with default values"""
        # Current aggregated price
        self.current_price = UInt64(0)
        self.last_update = UInt64(0)
        self.source_count = UInt64(0)

        # Individual source prices
        self.binance_price = UInt64(0)
        self.binance_timestamp = UInt64(0)
        self.coingecko_price = UInt64(0)
        self.coingecko_timestamp = UInt64(0)
        self.vestige_price = UInt64(0)
        self.vestige_timestamp = UInt64(0)

        # Configuration
        self.admin = Global.creator_address
        self.max_staleness = UInt64(300)  # 5 minutes in seconds
        self.max_deviation = UInt64(500)  # 5% in basis points (500 = 5%)
        self.min_sources = UInt64(2)  # Minimum sources for valid price

        # Authorized updaters (keeper bots)
        self.updater_count = UInt64(0)

    @abimethod()
    def update_price(
        self,
        binance_price: arc4.UInt64,
        coingecko_price: arc4.UInt64,
        vestige_price: arc4.UInt64,
    ) -> PriceData:
        """
        Update ALGO price from multiple sources.

        Args:
            binance_price: Price from Binance (microUSD)
            coingecko_price: Price from CoinGecko (microUSD)
            vestige_price: Price from Vestige DEX (microUSD)

        Returns:
            Aggregated price data
        """
        # Store individual source prices
        current_time = Global.latest_timestamp

        # Update source prices (0 means source unavailable)
        if binance_price.native > 0:
            self.binance_price = binance_price.native
            self.binance_timestamp = current_time

        if coingecko_price.native > 0:
            self.coingecko_price = coingecko_price.native
            self.coingecko_timestamp = current_time

        if vestige_price.native > 0:
            self.vestige_price = vestige_price.native
            self.vestige_timestamp = current_time

        # Collect valid prices (not stale)
        prices = self._collect_valid_prices(current_time)
        valid_count = prices[0]
        price1 = prices[1]
        price2 = prices[2]
        price3 = prices[3]

        # Need at least min_sources valid prices
        assert valid_count >= self.min_sources, "Insufficient valid price sources"

        # Calculate median price
        median_price = self._calculate_median(price1, price2, price3, valid_count)

        # Check deviation from previous price (if exists)
        if self.current_price > 0:
            deviation = self._calculate_deviation(self.current_price, median_price)
            assert deviation <= self.max_deviation, "Price deviation too high"

        # Update state
        self.current_price = median_price
        self.last_update = current_time
        self.source_count = valid_count

        # Calculate confidence based on source agreement
        confidence = self._calculate_confidence(price1, price2, price3, valid_count, median_price)

        return PriceData(
            price=arc4.UInt64(median_price),
            timestamp=arc4.UInt64(current_time),
            source_count=arc4.UInt64(valid_count),
            confidence=arc4.UInt64(confidence),
        )

    @abimethod()
    def get_price(self) -> PriceData:
        """
        Get current ALGO price.

        Returns:
            Current price data
        """
        confidence = UInt64(0)
        if self.current_price > 0:
            confidence = UInt64(100)  # Full confidence if price exists

        return PriceData(
            price=arc4.UInt64(self.current_price),
            timestamp=arc4.UInt64(self.last_update),
            source_count=arc4.UInt64(self.source_count),
            confidence=arc4.UInt64(confidence),
        )

    @abimethod()
    def get_price_unsafe(self) -> arc4.UInt64:
        """
        Get current price without staleness check.
        Use only when staleness is checked externally.

        Returns:
            Current price in microUSD
        """
        return arc4.UInt64(self.current_price)

    @abimethod()
    def is_price_fresh(self, max_age: arc4.UInt64) -> Bool:
        """
        Check if current price is fresh (not stale).

        Args:
            max_age: Maximum age in seconds

        Returns:
            True if price is fresh
        """
        if self.last_update == 0:
            return Bool(False)

        age = Global.latest_timestamp - self.last_update
        return Bool(age <= max_age.native)

    @abimethod()
    def get_source_prices(self) -> arc4.DynamicArray[SourcePrice]:
        """
        Get individual source prices for transparency.

        Returns:
            Array of source prices
        """
        current_time = Global.latest_timestamp

        sources = arc4.DynamicArray[SourcePrice]()

        # Binance
        binance_valid = Bool(self.binance_price > 0 and (current_time - self.binance_timestamp) <= self.max_staleness)
        sources.append(
            SourcePrice(
                price=arc4.UInt64(self.binance_price),
                timestamp=arc4.UInt64(self.binance_timestamp),
                is_valid=binance_valid,
            )
        )

        # CoinGecko
        coingecko_valid = Bool(
            self.coingecko_price > 0 and (current_time - self.coingecko_timestamp) <= self.max_staleness
        )
        sources.append(
            SourcePrice(
                price=arc4.UInt64(self.coingecko_price),
                timestamp=arc4.UInt64(self.coingecko_timestamp),
                is_valid=coingecko_valid,
            )
        )

        # Vestige
        vestige_valid = Bool(self.vestige_price > 0 and (current_time - self.vestige_timestamp) <= self.max_staleness)
        sources.append(
            SourcePrice(
                price=arc4.UInt64(self.vestige_price),
                timestamp=arc4.UInt64(self.vestige_timestamp),
                is_valid=vestige_valid,
            )
        )

        return sources

    # ========== Admin Functions ==========

    @abimethod()
    def set_max_staleness(self, seconds: arc4.UInt64) -> Bool:
        """Set maximum price staleness threshold."""
        assert Txn.sender == self.admin, "Only admin"
        assert seconds.native >= 60, "Min staleness 60 seconds"
        assert seconds.native <= 3600, "Max staleness 1 hour"
        self.max_staleness = seconds.native
        return Bool(True)

    @abimethod()
    def set_max_deviation(self, basis_points: arc4.UInt64) -> Bool:
        """Set maximum allowed price deviation between updates."""
        assert Txn.sender == self.admin, "Only admin"
        assert basis_points.native >= 100, "Min deviation 1%"
        assert basis_points.native <= 2000, "Max deviation 20%"
        self.max_deviation = basis_points.native
        return Bool(True)

    @abimethod()
    def set_min_sources(self, count: arc4.UInt64) -> Bool:
        """Set minimum required valid sources."""
        assert Txn.sender == self.admin, "Only admin"
        assert count.native >= 1, "Min 1 source"
        assert count.native <= 3, "Max 3 sources"
        self.min_sources = count.native
        return Bool(True)

    @abimethod()
    def transfer_admin(self, new_admin: Address) -> Bool:
        """Transfer admin role."""
        assert Txn.sender == self.admin, "Only admin"
        self.admin = new_admin.native
        return Bool(True)

    @abimethod()
    def emergency_set_price(self, price: arc4.UInt64) -> Bool:
        """
        Emergency price override (admin only).
        Use only in extreme circumstances.
        """
        assert Txn.sender == self.admin, "Only admin"
        assert price.native > 0, "Invalid price"
        self.current_price = price.native
        self.last_update = Global.latest_timestamp
        self.source_count = UInt64(1)
        return Bool(True)

    # ========== Internal Helpers ==========

    @subroutine
    def _collect_valid_prices(self, current_time: UInt64) -> tuple[UInt64, UInt64, UInt64, UInt64]:
        """Collect valid (non-stale) prices from sources."""
        valid_count = UInt64(0)
        price1 = UInt64(0)
        price2 = UInt64(0)
        price3 = UInt64(0)

        # Check Binance
        if self.binance_price > 0:
            age = current_time - self.binance_timestamp
            if age <= self.max_staleness:
                valid_count += 1
                price1 = self.binance_price

        # Check CoinGecko
        if self.coingecko_price > 0:
            age = current_time - self.coingecko_timestamp
            if age <= self.max_staleness:
                valid_count += 1
                if price1 == 0:
                    price1 = self.coingecko_price
                else:
                    price2 = self.coingecko_price

        # Check Vestige
        if self.vestige_price > 0:
            age = current_time - self.vestige_timestamp
            if age <= self.max_staleness:
                valid_count += 1
                if price1 == 0:
                    price1 = self.vestige_price
                elif price2 == 0:
                    price2 = self.vestige_price
                else:
                    price3 = self.vestige_price

        return (valid_count, price1, price2, price3)

    @subroutine
    def _calculate_median(self, p1: UInt64, p2: UInt64, p3: UInt64, count: UInt64) -> UInt64:
        """Calculate median of valid prices."""
        if count == 1:
            return p1
        elif count == 2:
            # Average of two prices
            return (p1 + p2) // 2
        else:
            # Median of three - sort and take middle
            # Simple bubble sort for 3 elements
            a = p1
            b = p2
            c = p3

            # Sort: ensure a <= b <= c
            if a > b:
                temp = a
                a = b
                b = temp
            if b > c:
                temp = b
                b = c
                c = temp
            if a > b:
                temp = a
                a = b
                b = temp

            # Return middle value
            return b

    @subroutine
    def _calculate_deviation(self, old_price: UInt64, new_price: UInt64) -> UInt64:
        """Calculate price deviation in basis points."""
        if old_price == 0:
            return UInt64(0)

        if new_price >= old_price:
            diff = new_price - old_price
        else:
            diff = old_price - new_price

        # deviation = (diff * 10000) / old_price
        return (diff * 10000) // old_price

    @subroutine
    def _calculate_confidence(
        self,
        p1: UInt64,
        p2: UInt64,
        p3: UInt64,
        count: UInt64,
        median: UInt64,
    ) -> UInt64:
        """
        Calculate confidence score based on source agreement.
        100 = all sources agree within 1%
        Lower scores for higher disagreement
        """
        if count == 1:
            return UInt64(50)  # Single source = 50% confidence

        if median == 0:
            return UInt64(0)

        # Calculate max deviation from median
        max_dev = UInt64(0)

        if p1 > 0:
            dev1 = self._calculate_deviation(median, p1)
            if dev1 > max_dev:
                max_dev = dev1

        if p2 > 0:
            dev2 = self._calculate_deviation(median, p2)
            if dev2 > max_dev:
                max_dev = dev2

        if p3 > 0:
            dev3 = self._calculate_deviation(median, p3)
            if dev3 > max_dev:
                max_dev = dev3

        # Confidence: 100 if deviation < 1%, decreases linearly
        # max_dev is in basis points (100 = 1%)
        if max_dev <= 100:
            return UInt64(100)
        elif max_dev >= 1000:
            return UInt64(10)  # Minimum confidence
        else:
            # Linear interpolation: 100 at 1%, 10 at 10%
            return UInt64(100) - ((max_dev - 100) * 90) // 900
