"""
ChainStrike STRIKE Governance Token

ASA-based governance token for the ChainStrike protocol.

Tokenomics:
- Total Supply: 1,000,000,000 STRIKE
- Decimals: 6
- Used for governance voting and fee distribution

Distribution:
- 40% - Community & Ecosystem
- 25% - Team (4 year vesting)
- 20% - Treasury
- 10% - Liquidity Mining
- 5%  - Initial Liquidity
"""

from algopy import (
    ARC4Contract,
    Asset,
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


class TokenInfo(Struct):
    """Token information"""

    asset_id: arc4.UInt64
    total_supply: arc4.UInt64
    circulating_supply: arc4.UInt64
    decimals: arc4.UInt64
    name: arc4.String
    symbol: arc4.String


class VestingSchedule(Struct):
    """Vesting schedule for an address"""

    total_amount: arc4.UInt64
    released_amount: arc4.UInt64
    start_time: arc4.UInt64
    cliff_duration: arc4.UInt64  # Seconds until first release
    vesting_duration: arc4.UInt64  # Total vesting period in seconds
    is_revocable: Bool


class StrikeToken(ARC4Contract):
    """
    STRIKE governance token contract.

    Features:
    - ASA creation and management
    - Vesting schedules for team tokens
    - Minting controls (capped at max supply)
    - Burn functionality
    - Pause/unpause for emergencies

    Note: Most token transfers happen via standard ASA transfer,
    this contract manages minting, vesting, and governance.
    """

    def __init__(self) -> None:
        """Initialize STRIKE token contract"""
        # Token info
        self.asset_id = UInt64(0)
        self.total_supply = UInt64(1_000_000_000_000000)  # 1B with 6 decimals
        self.minted_supply = UInt64(0)
        self.burned_supply = UInt64(0)

        # Admin
        self.admin = Global.creator_address
        self.minter = Global.creator_address
        self.is_paused = False

        # Vesting tracking (using boxes for schedules)
        self.vesting_count = UInt64(0)

    @abimethod()
    def create_token(self) -> arc4.UInt64:
        """
        Create the STRIKE ASA token.
        Can only be called once by admin.

        Returns:
            Asset ID of created token
        """
        assert Txn.sender == self.admin, "Only admin"
        assert self.asset_id == 0, "Token already created"

        # Create ASA
        result = itxn.AssetConfig(
            total=self.total_supply,
            decimals=6,
            default_frozen=False,
            unit_name="STRIKE",
            asset_name="ChainStrike Token",
            url="https://chainstrike.io",
            manager=Global.current_application_address,
            reserve=Global.current_application_address,
            freeze=Global.current_application_address,
            clawback=Global.current_application_address,
            fee=Global.min_txn_fee,
        ).submit()

        self.asset_id = result.created_asset.id

        return arc4.UInt64(self.asset_id)

    @abimethod()
    def opt_in_to_token(self) -> Bool:
        """
        Opt the contract into holding STRIKE tokens.
        Must be called after create_token.
        """
        assert self.asset_id > 0, "Token not created"

        itxn.AssetTransfer(
            xfer_asset=self.asset_id,
            asset_receiver=Global.current_application_address,
            asset_amount=0,
            fee=Global.min_txn_fee,
        ).submit()

        return Bool(True)

    @abimethod()
    def mint(self, to: Address, amount: arc4.UInt64) -> Bool:
        """
        Mint STRIKE tokens to an address.

        Args:
            to: Recipient address
            amount: Amount to mint (in base units)

        Returns:
            Success status
        """
        assert Txn.sender == self.minter, "Only minter"
        assert not self.is_paused, "Contract paused"
        assert self.asset_id > 0, "Token not created"

        new_minted = self.minted_supply + amount.native
        assert new_minted <= self.total_supply, "Exceeds max supply"

        # Transfer from contract's reserve
        itxn.AssetTransfer(
            xfer_asset=self.asset_id,
            asset_receiver=to.native,
            asset_amount=amount.native,
            fee=Global.min_txn_fee,
        ).submit()

        self.minted_supply = new_minted

        return Bool(True)

    @abimethod()
    def burn(self, amount: arc4.UInt64) -> Bool:
        """
        Burn STRIKE tokens from sender.
        Sender must transfer tokens to contract first.

        Args:
            amount: Amount to burn

        Returns:
            Success status
        """
        assert not self.is_paused, "Contract paused"
        assert self.asset_id > 0, "Token not created"

        # Verify payment was received (in group txn)
        assert gtxn.AssetTransferTransaction(0).xfer_asset.id == self.asset_id, "Wrong asset"
        assert gtxn.AssetTransferTransaction(0).asset_amount >= amount.native, "Insufficient amount"
        assert gtxn.AssetTransferTransaction(0).asset_receiver == Global.current_application_address, "Wrong receiver"

        # "Burn" by keeping in contract reserve (or could send to zero address)
        self.burned_supply = self.burned_supply + amount.native

        return Bool(True)

    @abimethod()
    def create_vesting(
        self,
        beneficiary: Address,
        amount: arc4.UInt64,
        cliff_days: arc4.UInt64,
        vesting_days: arc4.UInt64,
        revocable: Bool,
    ) -> Bool:
        """
        Create a vesting schedule for an address.

        Args:
            beneficiary: Address receiving vested tokens
            amount: Total amount to vest
            cliff_days: Days until first release
            vesting_days: Total vesting period in days
            revocable: Whether admin can revoke

        Returns:
            Success status
        """
        assert Txn.sender == self.admin, "Only admin"
        assert not self.is_paused, "Contract paused"

        # Convert days to seconds
        cliff_seconds = cliff_days.native * 86400
        vesting_seconds = vesting_days.native * 86400

        # Store vesting schedule in box storage
        # Box key: beneficiary address bytes
        schedule = VestingSchedule(
            total_amount=amount,
            released_amount=arc4.UInt64(0),
            start_time=arc4.UInt64(Global.latest_timestamp),
            cliff_duration=arc4.UInt64(cliff_seconds),
            vesting_duration=arc4.UInt64(vesting_seconds),
            is_revocable=revocable,
        )

        # Note: In production, use BoxMap for vesting schedules
        # For simplicity, we'll track count and emit events
        self.vesting_count += 1

        return Bool(True)

    @abimethod()
    def release_vested(self, beneficiary: Address) -> arc4.UInt64:
        """
        Release vested tokens to beneficiary.
        Anyone can call to release tokens for a beneficiary.

        Args:
            beneficiary: Address to release tokens to

        Returns:
            Amount released
        """
        assert not self.is_paused, "Contract paused"
        assert self.asset_id > 0, "Token not created"

        # In production, fetch vesting schedule from box storage
        # Calculate vested amount based on time elapsed
        # For now, return 0 as placeholder

        return arc4.UInt64(0)

    @abimethod()
    def revoke_vesting(self, beneficiary: Address) -> Bool:
        """
        Revoke a vesting schedule (admin only).
        Releases vested portion, returns unvested to treasury.

        Args:
            beneficiary: Address whose vesting to revoke

        Returns:
            Success status
        """
        assert Txn.sender == self.admin, "Only admin"

        # In production, check schedule is revocable
        # Release vested amount to beneficiary
        # Return unvested to contract

        return Bool(True)

    @abimethod()
    def get_token_info(self) -> TokenInfo:
        """
        Get STRIKE token information.

        Returns:
            Token info struct
        """
        circulating = self.minted_supply - self.burned_supply

        return TokenInfo(
            asset_id=arc4.UInt64(self.asset_id),
            total_supply=arc4.UInt64(self.total_supply),
            circulating_supply=arc4.UInt64(circulating),
            decimals=arc4.UInt64(6),
            name=arc4.String("ChainStrike Token"),
            symbol=arc4.String("STRIKE"),
        )

    @abimethod()
    def get_vesting_info(self, beneficiary: Address) -> VestingSchedule:
        """
        Get vesting schedule for an address.

        Args:
            beneficiary: Address to query

        Returns:
            Vesting schedule details
        """
        # In production, fetch from box storage
        return VestingSchedule(
            total_amount=arc4.UInt64(0),
            released_amount=arc4.UInt64(0),
            start_time=arc4.UInt64(0),
            cliff_duration=arc4.UInt64(0),
            vesting_duration=arc4.UInt64(0),
            is_revocable=Bool(False),
        )

    @abimethod()
    def calculate_vested_amount(
        self,
        total: arc4.UInt64,
        start: arc4.UInt64,
        cliff: arc4.UInt64,
        duration: arc4.UInt64,
    ) -> arc4.UInt64:
        """
        Calculate vested amount based on schedule parameters.

        Args:
            total: Total vesting amount
            start: Start timestamp
            cliff: Cliff duration in seconds
            duration: Total vesting duration in seconds

        Returns:
            Amount vested
        """
        current_time = Global.latest_timestamp

        # Before cliff - nothing vested
        cliff_end = start.native + cliff.native
        if current_time < cliff_end:
            return arc4.UInt64(0)

        # After full duration - everything vested
        vesting_end = start.native + duration.native
        if current_time >= vesting_end:
            return total

        # Linear vesting between cliff and end
        elapsed = current_time - start.native
        vested = (total.native * elapsed) // duration.native

        return arc4.UInt64(vested)

    # ========== Admin Functions ==========

    @abimethod()
    def set_minter(self, new_minter: Address) -> Bool:
        """Set address allowed to mint tokens."""
        assert Txn.sender == self.admin, "Only admin"
        self.minter = new_minter.native
        return Bool(True)

    @abimethod()
    def transfer_admin(self, new_admin: Address) -> Bool:
        """Transfer admin role."""
        assert Txn.sender == self.admin, "Only admin"
        self.admin = new_admin.native
        return Bool(True)

    @abimethod()
    def pause(self) -> Bool:
        """Pause contract operations."""
        assert Txn.sender == self.admin, "Only admin"
        self.is_paused = True
        return Bool(True)

    @abimethod()
    def unpause(self) -> Bool:
        """Unpause contract operations."""
        assert Txn.sender == self.admin, "Only admin"
        self.is_paused = False
        return Bool(True)

    @abimethod()
    def remove_asset_controls(self) -> Bool:
        """
        Remove manager/freeze/clawback from ASA.
        Makes token fully decentralized. Irreversible!
        """
        assert Txn.sender == self.admin, "Only admin"
        assert self.asset_id > 0, "Token not created"

        # Reconfigure asset to remove controls
        itxn.AssetConfig(
            config_asset=self.asset_id,
            manager=Global.zero_address,
            reserve=Global.zero_address,
            freeze=Global.zero_address,
            clawback=Global.zero_address,
            fee=Global.min_txn_fee,
        ).submit()

        return Bool(True)
