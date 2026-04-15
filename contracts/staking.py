"""
ChainStrike Staking Contract

STRIKE token staking for:
- Protocol fee distribution
- Governance participation
- Yield generation

Features:
- Flexible staking (no lock)
- Lock staking with bonus APY
- Auto-compounding rewards
- Fee distribution from options/perps trading
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


class StakeInfo(Struct):
    """Individual staking position"""

    staked_amount: arc4.UInt64
    lock_until: arc4.UInt64
    lock_multiplier: arc4.UInt64  # Basis points (10000 = 1x, 15000 = 1.5x)
    rewards_debt: arc4.UInt64  # For reward calculation
    pending_rewards: arc4.UInt64
    stake_time: arc4.UInt64


class StakingStats(Struct):
    """Global staking statistics"""

    total_staked: arc4.UInt64
    total_stakers: arc4.UInt64
    total_rewards_distributed: arc4.UInt64
    reward_rate: arc4.UInt64  # Rewards per second per staked token (scaled)
    last_update_time: arc4.UInt64
    acc_reward_per_share: arc4.UInt64  # Accumulated rewards per share (scaled)


class Staking(ARC4Contract):
    """
    STRIKE token staking contract.

    Reward Mechanism:
    - Protocol fees from trading are deposited into this contract
    - Fees distributed proportionally to stakers
    - Lock periods provide bonus multipliers

    Lock Tiers:
    - No lock: 1x rewards
    - 30 days: 1.25x rewards
    - 90 days: 1.5x rewards
    - 180 days: 2x rewards
    - 365 days: 3x rewards
    """

    def __init__(self) -> None:
        """Initialize staking contract"""
        # Token references
        self.strike_asset_id = UInt64(0)
        self.algo_rewards_balance = UInt64(0)

        # Global staking state
        self.total_staked = UInt64(0)
        self.total_weighted_stake = UInt64(0)  # With lock multipliers
        self.total_stakers = UInt64(0)
        self.total_rewards_distributed = UInt64(0)

        # Reward accumulator (scaled by 1e12 for precision)
        self.acc_reward_per_share = UInt64(0)
        self.last_reward_time = UInt64(0)
        self.reward_rate = UInt64(0)  # ALGO per second

        # Admin
        self.admin = Global.creator_address
        self.is_paused = False

        # Fee receivers (contracts that send fees)
        self.options_market = Global.zero_address
        self.perps_market = Global.zero_address

        # Constants
        self.precision = UInt64(1_000_000_000_000)  # 1e12
        self.min_stake = UInt64(1_000_000)  # 1 STRIKE minimum

        # Box storage for per-user stakes
        self.stakes = BoxMap(Bytes, StakeInfo, key_prefix=b"stk_")

    @abimethod()
    def initialize(
        self,
        strike_asset: arc4.UInt64,
        options_market: Address,
        perps_market: Address,
    ) -> Bool:
        """
        Initialize staking with STRIKE token and market contracts.

        Args:
            strike_asset: STRIKE token asset ID
            options_market: Options market contract address
            perps_market: Perpetuals market contract address

        Returns:
            Success status
        """
        assert Txn.sender == self.admin, "Only admin"
        assert self.strike_asset_id == 0, "Already initialized"

        self.strike_asset_id = strike_asset.native
        self.options_market = options_market.native
        self.perps_market = perps_market.native
        self.last_reward_time = Global.latest_timestamp

        # Opt into STRIKE token
        itxn.AssetTransfer(
            xfer_asset=strike_asset.native,
            asset_receiver=Global.current_application_address,
            asset_amount=0,
            fee=Global.min_txn_fee,
        ).submit()

        return Bool(True)

    @abimethod()
    def stake(self, amount: arc4.UInt64, lock_days: arc4.UInt64) -> Bool:
        """
        Stake STRIKE tokens.

        Args:
            amount: Amount to stake (must be sent in group txn)
            lock_days: Lock period in days (0, 30, 90, 180, 365)

        Returns:
            Success status
        """
        assert not self.is_paused, "Contract paused"
        assert self.strike_asset_id > 0, "Not initialized"
        assert amount.native >= self.min_stake, "Below minimum stake"

        # Validate lock period and get multiplier
        multiplier = self._get_lock_multiplier(lock_days.native)

        # Verify STRIKE transfer in group
        assert gtxn.AssetTransferTransaction(0).xfer_asset.id == self.strike_asset_id, "Wrong asset"
        assert gtxn.AssetTransferTransaction(0).asset_amount >= amount.native, "Insufficient amount"
        assert gtxn.AssetTransferTransaction(0).asset_receiver == Global.current_application_address, "Wrong receiver"

        # Update global rewards before changing stake
        self._update_rewards()

        # Calculate lock time
        lock_until = UInt64(0)
        if lock_days.native > 0:
            lock_until = Global.latest_timestamp + (lock_days.native * 86400)

        # Calculate weighted stake
        weighted_amount = (amount.native * multiplier) // 10000

        # Check if user already has a stake
        stake_key = Txn.sender.bytes
        if stake_key in self.stakes:
            # Update existing stake
            existing = self.stakes[stake_key].copy()
            new_amount = existing.staked_amount.native + amount.native
            # Use the longer lock
            new_lock = lock_until
            if existing.lock_until.native > lock_until:
                new_lock = existing.lock_until.native
            new_multiplier = multiplier
            if existing.lock_multiplier.native > multiplier:
                new_multiplier = existing.lock_multiplier.native

            self.stakes[stake_key] = StakeInfo(
                staked_amount=arc4.UInt64(new_amount),
                lock_until=arc4.UInt64(new_lock),
                lock_multiplier=arc4.UInt64(new_multiplier),
                rewards_debt=arc4.UInt64((new_amount * self.acc_reward_per_share) // self.precision),
                pending_rewards=existing.pending_rewards,
                stake_time=existing.stake_time,
            )
        else:
            # Create new stake
            self.stakes[stake_key] = StakeInfo(
                staked_amount=arc4.UInt64(amount.native),
                lock_until=arc4.UInt64(lock_until),
                lock_multiplier=arc4.UInt64(multiplier),
                rewards_debt=arc4.UInt64((amount.native * self.acc_reward_per_share) // self.precision),
                pending_rewards=arc4.UInt64(0),
                stake_time=arc4.UInt64(Global.latest_timestamp),
            )
            self.total_stakers += 1

        # Update global state
        self.total_staked += amount.native
        self.total_weighted_stake += weighted_amount

        return Bool(True)

    @abimethod()
    def unstake(self, amount: arc4.UInt64) -> Bool:
        """
        Unstake STRIKE tokens.

        Args:
            amount: Amount to unstake

        Returns:
            Success status
        """
        assert not self.is_paused, "Contract paused"
        assert self.strike_asset_id > 0, "Not initialized"

        # Fetch user's stake from BoxMap
        stake_key = Txn.sender.bytes
        assert stake_key in self.stakes, "No stake found"
        stake_info = self.stakes[stake_key].copy()

        assert stake_info.staked_amount.native >= amount.native, "Insufficient stake"

        # Check lock period
        if stake_info.lock_until.native > 0:
            assert Global.latest_timestamp >= stake_info.lock_until.native, "Lock period not ended"

        # Update global rewards
        self._update_rewards()

        # Calculate pending rewards before unstaking
        pending = UInt64(0)
        if self.acc_reward_per_share > 0 and stake_info.staked_amount.native > 0:
            pending = (stake_info.staked_amount.native * self.acc_reward_per_share) // self.precision
            if pending > stake_info.rewards_debt.native:
                pending -= stake_info.rewards_debt.native
            else:
                pending = UInt64(0)

        # Transfer STRIKE back to user
        itxn.AssetTransfer(
            xfer_asset=self.strike_asset_id,
            asset_receiver=Txn.sender,
            asset_amount=amount.native,
            fee=Global.min_txn_fee,
        ).submit()

        # Update or remove stake in BoxMap
        new_amount = stake_info.staked_amount.native - amount.native
        if new_amount > 0:
            self.stakes[stake_key] = StakeInfo(
                staked_amount=arc4.UInt64(new_amount),
                lock_until=stake_info.lock_until,
                lock_multiplier=stake_info.lock_multiplier,
                rewards_debt=arc4.UInt64((new_amount * self.acc_reward_per_share) // self.precision),
                pending_rewards=arc4.UInt64(pending + stake_info.pending_rewards.native),
                stake_time=stake_info.stake_time,
            )
        else:
            # Remove stake entirely
            del self.stakes[stake_key]
            if self.total_stakers > 0:
                self.total_stakers -= 1

        # Update global state
        if self.total_staked >= amount.native:
            self.total_staked -= amount.native

        # Calculate weighted amount to remove
        weighted_remove = (amount.native * stake_info.lock_multiplier.native) // 10000
        if self.total_weighted_stake >= weighted_remove:
            self.total_weighted_stake -= weighted_remove

        return Bool(True)

    @abimethod()
    def claim_rewards(self) -> arc4.UInt64:
        """
        Claim pending staking rewards in ALGO.

        Returns:
            Amount claimed
        """
        assert not self.is_paused, "Contract paused"

        # Update global rewards
        self._update_rewards()

        # Calculate pending rewards from BoxMap
        stake_key = Txn.sender.bytes
        assert stake_key in self.stakes, "No stake found"
        stake_info = self.stakes[stake_key].copy()

        pending = UInt64(0)
        if self.acc_reward_per_share > 0 and stake_info.staked_amount.native > 0:
            total_reward = (stake_info.staked_amount.native * self.acc_reward_per_share) // self.precision
            if total_reward > stake_info.rewards_debt.native:
                pending = total_reward - stake_info.rewards_debt.native

        # Add any accumulated pending rewards
        pending += stake_info.pending_rewards.native

        if pending > 0 and pending <= self.algo_rewards_balance:
            # Transfer ALGO rewards
            itxn.Payment(
                receiver=Txn.sender,
                amount=pending,
                fee=Global.min_txn_fee,
            ).submit()

            self.total_rewards_distributed += pending
            self.algo_rewards_balance -= pending

            # Update rewards debt in BoxMap
            self.stakes[stake_key] = StakeInfo(
                staked_amount=stake_info.staked_amount,
                lock_until=stake_info.lock_until,
                lock_multiplier=stake_info.lock_multiplier,
                rewards_debt=arc4.UInt64(
                    (stake_info.staked_amount.native * self.acc_reward_per_share) // self.precision
                ),
                pending_rewards=arc4.UInt64(0),
                stake_time=stake_info.stake_time,
            )

        return arc4.UInt64(pending)

    @abimethod()
    def deposit_rewards(self, amount: arc4.UInt64) -> Bool:
        """
        Deposit ALGO rewards for distribution.
        Called by market contracts when collecting fees.

        Args:
            amount: ALGO amount (must be sent in group txn)

        Returns:
            Success status
        """
        # Verify payment
        assert gtxn.PaymentTransaction(0).amount >= amount.native, "Insufficient payment"
        assert gtxn.PaymentTransaction(0).receiver == Global.current_application_address, "Wrong receiver"

        # Add to rewards balance
        self.algo_rewards_balance += amount.native

        # Update reward rate based on new balance and distribution period
        # Distribute rewards over 7 days
        distribution_period = UInt64(604800)  # 7 days in seconds
        if self.total_weighted_stake > 0:
            self.reward_rate = self.algo_rewards_balance // distribution_period

        return Bool(True)

    @abimethod()
    def compound(self) -> Bool:
        """
        Compound pending ALGO rewards back into the staking pool.
        Instead of withdrawing rewards, they are added to the staker's
        staked balance, increasing future reward earnings.

        Returns:
            Success status
        """
        assert not self.is_paused, "Contract paused"

        # Update global rewards
        self._update_rewards()

        stake_key = Txn.sender.bytes
        assert stake_key in self.stakes, "No stake found"
        stake_info = self.stakes[stake_key].copy()
        assert stake_info.staked_amount.native > 0, "Nothing staked"

        # Calculate pending ALGO rewards
        pending = UInt64(0)
        if self.acc_reward_per_share > 0:
            total_reward = (stake_info.staked_amount.native * self.acc_reward_per_share) // self.precision
            if total_reward > stake_info.rewards_debt.native:
                pending = total_reward - stake_info.rewards_debt.native

        pending += stake_info.pending_rewards.native

        if pending == 0:
            return Bool(True)

        # Ensure the contract has enough balance
        assert pending <= self.algo_rewards_balance, "Insufficient reward balance"

        # Deduct from rewards pool
        self.algo_rewards_balance -= pending
        self.total_rewards_distributed += pending

        # Add compounded rewards to staked amount
        new_staked = stake_info.staked_amount.native + pending
        self.total_staked += pending

        # Recalculate weighted stake with existing multiplier
        old_weighted = (stake_info.staked_amount.native * stake_info.lock_multiplier.native) // 10000
        new_weighted = (new_staked * stake_info.lock_multiplier.native) // 10000
        if self.total_weighted_stake >= old_weighted:
            self.total_weighted_stake = self.total_weighted_stake - old_weighted + new_weighted

        # Update new rewards debt
        new_rewards_debt = (new_staked * self.acc_reward_per_share) // self.precision

        # Persist updated stake
        self.stakes[stake_key] = StakeInfo(
            staked_amount=arc4.UInt64(new_staked),
            lock_until=stake_info.lock_until,
            lock_multiplier=stake_info.lock_multiplier,
            rewards_debt=arc4.UInt64(new_rewards_debt),
            pending_rewards=arc4.UInt64(0),
            stake_time=stake_info.stake_time,
        )

        return Bool(True)

    @abimethod()
    def extend_lock(self, new_lock_days: arc4.UInt64) -> Bool:
        """
        Extend lock period for bonus multiplier.

        Args:
            new_lock_days: New lock period (must be longer than current)

        Returns:
            Success status
        """
        assert not self.is_paused, "Contract paused"

        # Fetch current stake from box
        stake_key = Txn.sender.bytes
        assert stake_key in self.stakes, "No stake found"
        stake_info = self.stakes[stake_key].copy()
        assert stake_info.staked_amount.native > 0, "Nothing staked"

        # Calculate new lock expiry
        new_lock_until = Global.latest_timestamp + new_lock_days.native * 86400

        # New lock must extend beyond current lock
        assert new_lock_until > stake_info.lock_until.native, "Must extend beyond current lock"

        # New multiplier from the new lock period
        new_multiplier = self._get_lock_multiplier(new_lock_days.native)

        # New multiplier must be >= current (can't downgrade)
        assert new_multiplier >= stake_info.lock_multiplier.native, "Cannot reduce multiplier"

        # Update global weighted stake
        old_weighted = (stake_info.staked_amount.native * stake_info.lock_multiplier.native) // 10000
        new_weighted = (stake_info.staked_amount.native * new_multiplier) // 10000
        if self.total_weighted_stake >= old_weighted:
            self.total_weighted_stake = self.total_weighted_stake - old_weighted + new_weighted

        # Persist updated stake with new lock
        self.stakes[stake_key] = StakeInfo(
            staked_amount=stake_info.staked_amount,
            lock_until=arc4.UInt64(new_lock_until),
            lock_multiplier=arc4.UInt64(new_multiplier),
            rewards_debt=stake_info.rewards_debt,
            pending_rewards=stake_info.pending_rewards,
            stake_time=stake_info.stake_time,
        )

        return Bool(True)

    @abimethod()
    def get_stake_info(self, account: Address) -> StakeInfo:
        """
        Get staking information for an account.

        Args:
            account: Account to query

        Returns:
            Stake info
        """
        # Fetch from BoxMap
        stake_key = account.native.bytes
        if stake_key in self.stakes:
            return self.stakes[stake_key].copy()

        # Return empty if not staked
        return StakeInfo(
            staked_amount=arc4.UInt64(0),
            lock_until=arc4.UInt64(0),
            lock_multiplier=arc4.UInt64(10000),
            rewards_debt=arc4.UInt64(0),
            pending_rewards=arc4.UInt64(0),
            stake_time=arc4.UInt64(0),
        )

    @abimethod()
    def get_pending_rewards(self, account: Address) -> arc4.UInt64:
        """
        Calculate pending rewards for an account.

        Args:
            account: Account to query

        Returns:
            Pending rewards in ALGO
        """
        stake_key = account.native.bytes
        if stake_key not in self.stakes:
            return arc4.UInt64(0)

        stake_info = self.stakes[stake_key].copy()
        pending = UInt64(0)
        if self.acc_reward_per_share > 0 and stake_info.staked_amount.native > 0:
            total_reward = (stake_info.staked_amount.native * self.acc_reward_per_share) // self.precision
            if total_reward > stake_info.rewards_debt.native:
                pending = total_reward - stake_info.rewards_debt.native

        pending += stake_info.pending_rewards.native
        return arc4.UInt64(pending)

    @abimethod()
    def get_staking_stats(self) -> StakingStats:
        """
        Get global staking statistics.

        Returns:
            Staking stats
        """
        return StakingStats(
            total_staked=arc4.UInt64(self.total_staked),
            total_stakers=arc4.UInt64(self.total_stakers),
            total_rewards_distributed=arc4.UInt64(self.total_rewards_distributed),
            reward_rate=arc4.UInt64(self.reward_rate),
            last_update_time=arc4.UInt64(self.last_reward_time),
            acc_reward_per_share=arc4.UInt64(self.acc_reward_per_share),
        )

    @abimethod()
    def get_apy(self, lock_days: arc4.UInt64) -> arc4.UInt64:
        """
        Calculate estimated APY for a lock period.

        Args:
            lock_days: Lock period in days

        Returns:
            APY in basis points (e.g., 1500 = 15%)
        """
        if self.total_staked == 0 or self.reward_rate == 0:
            return arc4.UInt64(0)

        # Annual rewards = reward_rate * seconds_per_year
        seconds_per_year = UInt64(31536000)
        annual_rewards = self.reward_rate * seconds_per_year

        # Base APY = (annual_rewards / total_staked) * 10000
        base_apy = (annual_rewards * 10000) // self.total_staked

        # Apply lock multiplier
        multiplier = self._get_lock_multiplier(lock_days.native)
        adjusted_apy = (base_apy * multiplier) // 10000

        return arc4.UInt64(adjusted_apy)

    # ========== Admin Functions ==========

    @abimethod()
    def set_market_contracts(
        self,
        options_market: Address,
        perps_market: Address,
    ) -> Bool:
        """Update market contract addresses."""
        assert Txn.sender == self.admin, "Only admin"
        self.options_market = options_market.native
        self.perps_market = perps_market.native
        return Bool(True)

    @abimethod()
    def transfer_admin(self, new_admin: Address) -> Bool:
        """Transfer admin role."""
        assert Txn.sender == self.admin, "Only admin"
        self.admin = new_admin.native
        return Bool(True)

    @abimethod()
    def pause(self) -> Bool:
        """Pause staking operations."""
        assert Txn.sender == self.admin, "Only admin"
        self.is_paused = True
        return Bool(True)

    @abimethod()
    def unpause(self) -> Bool:
        """Unpause staking operations."""
        assert Txn.sender == self.admin, "Only admin"
        self.is_paused = False
        return Bool(True)

    @abimethod()
    def emergency_withdraw(self, asset_id: arc4.UInt64, amount: arc4.UInt64) -> Bool:
        """Emergency asset withdrawal (admin only)."""
        assert Txn.sender == self.admin, "Only admin"

        if asset_id.native == 0:
            # ALGO
            itxn.Payment(
                receiver=self.admin,
                amount=amount.native,
                fee=Global.min_txn_fee,
            ).submit()
        else:
            # ASA
            itxn.AssetTransfer(
                xfer_asset=asset_id.native,
                asset_receiver=self.admin,
                asset_amount=amount.native,
                fee=Global.min_txn_fee,
            ).submit()

        return Bool(True)

    # ========== Internal Helpers ==========

    @subroutine
    def _get_lock_multiplier(self, lock_days: UInt64) -> UInt64:
        """Get reward multiplier for lock period."""
        if lock_days == 0:
            return UInt64(10000)  # 1x
        elif lock_days <= 30:
            return UInt64(12500)  # 1.25x
        elif lock_days <= 90:
            return UInt64(15000)  # 1.5x
        elif lock_days <= 180:
            return UInt64(20000)  # 2x
        else:
            return UInt64(30000)  # 3x for 365+ days

    @subroutine
    def _update_rewards(self) -> None:
        """Update accumulated rewards per share."""
        if self.total_weighted_stake == 0:
            self.last_reward_time = Global.latest_timestamp
            return

        current_time = Global.latest_timestamp
        time_elapsed = current_time - self.last_reward_time

        if time_elapsed > 0 and self.reward_rate > 0:
            # New rewards = time_elapsed * reward_rate
            new_rewards = time_elapsed * self.reward_rate

            # Update accumulated rewards per share
            # acc_reward_per_share += (new_rewards * precision) / total_weighted_stake
            reward_per_share = (new_rewards * self.precision) // self.total_weighted_stake
            self.acc_reward_per_share += reward_per_share

        self.last_reward_time = current_time
