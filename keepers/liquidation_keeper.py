#!/usr/bin/env python3
"""
ChainStrike Liquidation Keeper Bot

Monitors perpetual positions and liquidates unhealthy positions.
Runs continuously to maintain protocol solvency.

Usage:
    python liquidation_keeper.py [--interval SECONDS] [--dry-run]

Environment:
    KEEPER_MNEMONIC: Keeper account mnemonic (needs ALGO for txn fees)
"""

import argparse
import asyncio
import base64
import json
import os
import ssl
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict

# Disable SSL verification for macOS Python 3.13+
ssl._create_default_https_context = ssl._create_unverified_context

try:
    from algosdk import account, mnemonic, encoding
    from algosdk.v2client import algod, indexer
    from algosdk.transaction import ApplicationNoOpTxn
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with: pip install py-algorand-sdk")
    sys.exit(1)


# Configuration
TESTNET_ALGOD = "https://testnet-api.4160.nodely.dev"
TESTNET_INDEXER = "https://testnet-idx.4160.nodely.dev"
ALGOD_TOKEN = ""
INDEXER_TOKEN = ""
DEFAULT_CHECK_INTERVAL = 30  # seconds between checks
LIQUIDATION_THRESHOLD = 8000  # 80% margin ratio (in basis points)
MIN_MARGIN_RATIO = 500  # 5% minimum margin

# Load deployed addresses
DEPLOYED_PATH = Path(__file__).parent.parent / "contracts" / "deployed_addresses.json"

# Default deployer mnemonic (TestNet only)
DEFAULT_MNEMONIC = "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss"


class Position:
    """Represents a perpetual position."""

    def __init__(self, address: str, data: dict):
        self.address = address
        self.size = data.get("size", 0)  # Position size in microALGO
        self.entry_price = data.get("entry_price", 0)  # Entry price in microUSD
        self.margin = data.get("margin", 0)  # Margin amount in microALGO
        self.is_long = data.get("is_long", True)
        self.leverage = data.get("leverage", 1)
        self.timestamp = data.get("timestamp", 0)

    def calculate_pnl(self, current_price: int) -> int:
        """Calculate unrealized PnL in microALGO."""
        if self.entry_price == 0 or self.size == 0:
            return 0

        # Price difference
        if self.is_long:
            pnl_bps = ((current_price - self.entry_price) * 10000) // self.entry_price
        else:
            pnl_bps = ((self.entry_price - current_price) * 10000) // self.entry_price

        # PnL = size * leverage * price_change
        pnl = (self.size * self.leverage * pnl_bps) // 10000
        return pnl

    def calculate_margin_ratio(self, current_price: int) -> int:
        """Calculate margin ratio in basis points."""
        if self.margin == 0:
            return 0

        pnl = self.calculate_pnl(current_price)
        effective_margin = self.margin + pnl

        if effective_margin <= 0:
            return 0  # Below liquidation

        # Margin ratio = effective_margin / position_value
        position_value = self.size * self.leverage
        if position_value == 0:
            return 10000  # Fully collateralized

        return (effective_margin * 10000) // position_value

    def is_liquidatable(self, current_price: int) -> bool:
        """Check if position should be liquidated."""
        margin_ratio = self.calculate_margin_ratio(current_price)
        return margin_ratio < MIN_MARGIN_RATIO

    def __repr__(self):
        direction = "LONG" if self.is_long else "SHORT"
        return f"Position({self.address[:8]}... {direction} {self.leverage}x, size={self.size / 1e6:.2f})"


class LiquidationKeeper:
    """Keeper bot for liquidating unhealthy positions."""

    def __init__(
        self,
        keeper_mnemonic: str,
        perps_market_app_id: int,
        oracle_app_id: int,
        dry_run: bool = False,
    ):
        self.algod_client = algod.AlgodClient(ALGOD_TOKEN, TESTNET_ALGOD)
        self.indexer_client = indexer.IndexerClient(INDEXER_TOKEN, TESTNET_INDEXER)
        self.private_key = mnemonic.to_private_key(keeper_mnemonic)
        self.address = account.address_from_private_key(self.private_key)
        self.perps_market_app_id = perps_market_app_id
        self.oracle_app_id = oracle_app_id
        self.dry_run = dry_run

        # Stats
        self.positions_checked = 0
        self.liquidations_executed = 0
        self.errors = 0

    def read_global_state(self, app_id: int) -> dict:
        """Read global state from an application."""
        try:
            app_info = self.algod_client.application_info(app_id)
            global_state = {}

            for item in app_info.get("params", {}).get("global-state", []):
                key = base64.b64decode(item["key"]).decode("utf-8", errors="ignore")
                value = item["value"]

                if value["type"] == 1:  # bytes
                    try:
                        global_state[key] = base64.b64decode(value["bytes"]).decode(
                            "utf-8", errors="ignore"
                        )
                    except:
                        global_state[key] = value["bytes"]
                else:  # uint
                    global_state[key] = value["uint"]

            return global_state
        except Exception as e:
            print(f"  [ERR] Error reading state for app {app_id}: {e}")
            return {}

    def get_current_price(self) -> int:
        """Get current price from oracle."""
        state = self.read_global_state(self.oracle_app_id)
        return state.get("current_price", 0)

    def get_all_positions(self) -> List[Position]:
        """Get all open positions from perps market."""
        positions = []

        try:
            # Get all accounts opted into the app
            response = self.indexer_client.accounts(
                application_id=self.perps_market_app_id
            )

            for acct in response.get("accounts", []):
                address = acct.get("address")

                # Read local state for this account
                for app_state in acct.get("apps-local-state", []):
                    if app_state.get("id") == self.perps_market_app_id:
                        local_state = {}
                        for kv in app_state.get("key-value", []):
                            key = base64.b64decode(kv["key"]).decode(
                                "utf-8", errors="ignore"
                            )
                            value = kv["value"]
                            if value["type"] == 2:  # uint
                                local_state[key] = value["uint"]

                        # Only add if position exists
                        if local_state.get("size", 0) > 0:
                            positions.append(Position(address, local_state))

        except Exception as e:
            print(f"  [ERR] Error fetching positions: {e}")

        return positions

    def wait_for_confirmation(self, txid: str, timeout: int = 10) -> dict:
        """Wait for transaction confirmation."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                txinfo = self.algod_client.pending_transaction_info(txid)
                if txinfo.get("confirmed-round", 0) > 0:
                    return txinfo
                if txinfo.get("pool-error", ""):
                    raise Exception(f"Transaction failed: {txinfo['pool-error']}")
            except Exception as e:
                if "pending" not in str(e).lower():
                    pass
            time.sleep(0.5)
        raise Exception(f"Transaction {txid} timed out")

    def liquidate_position(self, position: Position, current_price: int) -> bool:
        """Liquidate an unhealthy position."""
        if self.dry_run:
            print(f"  [DRY RUN] Would liquidate {position}")
            self.liquidations_executed += 1
            return True

        try:
            # Get suggested params
            sp = self.algod_client.suggested_params()

            # Build liquidation call
            # Method signature: liquidate(address)
            method_selector = bytes.fromhex("b1c5a5e2")  # Example selector
            address_bytes = encoding.decode_address(position.address)

            txn = ApplicationNoOpTxn(
                sender=self.address,
                sp=sp,
                index=self.perps_market_app_id,
                app_args=[method_selector, address_bytes],
                accounts=[position.address],
            )

            signed_txn = txn.sign(self.private_key)
            txid = self.algod_client.send_transaction(signed_txn)
            print(f"  [TX] Liquidating {position.address[:8]}... TX: {txid}")

            result = self.wait_for_confirmation(txid)
            print(
                f"  [OK] Liquidation confirmed in round {result.get('confirmed-round')}"
            )

            self.liquidations_executed += 1
            return True

        except Exception as e:
            print(f"  [ERR] Liquidation error: {e}")
            self.errors += 1
            return False

    def print_status(self, positions: List[Position], current_price: int):
        """Print current status."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        print(f"\n[{timestamp}] Position Check")
        print(f"  Current Price: ${current_price / 1_000_000:.4f}")
        print(f"  Total Positions: {len(positions)}")

        liquidatable = [p for p in positions if p.is_liquidatable(current_price)]
        print(f"  Liquidatable: {len(liquidatable)}")
        print(
            f"  Stats: Checked={self.positions_checked} | Liquidated={self.liquidations_executed} | Errors={self.errors}"
        )

    def check_balance(self) -> float:
        """Check keeper account balance."""
        account_info = self.algod_client.account_info(self.address)
        balance = account_info.get("amount", 0) / 1_000_000
        return balance

    async def run(self, interval: int):
        """Main keeper loop."""
        print("=" * 60)
        print("ChainStrike Liquidation Keeper")
        print("=" * 60)
        print(f"Keeper Address:    {self.address}")
        print(f"Perps Market ID:   {self.perps_market_app_id}")
        print(f"Oracle ID:         {self.oracle_app_id}")
        print(f"Check Interval:    {interval}s")
        print(f"Dry Run:           {self.dry_run}")

        balance = self.check_balance()
        print(f"Balance:           {balance:.6f} ALGO")

        if balance < 0.1 and not self.dry_run:
            print("\n[WARN] Low balance! Get TestNet ALGO from:")
            print("       https://bank.testnet.algorand.network/")

        print("=" * 60)

        while True:
            try:
                # Get current price
                current_price = self.get_current_price()

                if current_price == 0:
                    print(f"  [WARN] No price available from oracle")
                    await asyncio.sleep(interval)
                    continue

                # Get all positions
                positions = self.get_all_positions()
                self.positions_checked += len(positions)

                # Print status
                self.print_status(positions, current_price)

                # Check for liquidatable positions
                for position in positions:
                    if position.is_liquidatable(current_price):
                        margin_ratio = position.calculate_margin_ratio(current_price)
                        print(f"\n  [!] Liquidatable position found:")
                        print(f"      Address: {position.address}")
                        print(
                            f"      Direction: {'LONG' if position.is_long else 'SHORT'}"
                        )
                        print(f"      Leverage: {position.leverage}x")
                        print(f"      Margin Ratio: {margin_ratio / 100:.2f}%")

                        self.liquidate_position(position, current_price)

            except KeyboardInterrupt:
                print("\n\nShutting down...")
                break
            except Exception as e:
                print(f"  [ERR] Loop error: {e}")
                self.errors += 1

            # Wait for next check
            try:
                await asyncio.sleep(interval)
            except KeyboardInterrupt:
                print("\n\nShutting down...")
                break


def load_contract_ids() -> tuple:
    """Load contract IDs from deployed addresses."""
    perps_market_id = 0
    oracle_id = 0

    if DEPLOYED_PATH.exists():
        with open(DEPLOYED_PATH) as f:
            deployed = json.load(f)
            contracts = deployed.get("contracts", {})
            perps_market_id = contracts.get("perps_market", 0)
            oracle_id = contracts.get("oracle", 0)

    return perps_market_id, oracle_id


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="ChainStrike Liquidation Keeper Bot")
    parser.add_argument(
        "--interval",
        type=int,
        default=DEFAULT_CHECK_INTERVAL,
        help=f"Check interval in seconds (default: {DEFAULT_CHECK_INTERVAL})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run without sending transactions",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run once and exit",
    )
    args = parser.parse_args()

    # Get configuration from environment or use defaults
    keeper_mnemonic = os.getenv("KEEPER_MNEMONIC", DEFAULT_MNEMONIC)
    perps_market_id, oracle_id = load_contract_ids()

    perps_market_id = int(os.getenv("PERPS_MARKET_APP_ID", str(perps_market_id)))
    oracle_id = int(os.getenv("ORACLE_APP_ID", str(oracle_id)))

    if perps_market_id == 0 or oracle_id == 0:
        print("[WARN] Contract IDs not set, running in simulation mode")
        args.dry_run = True

    keeper = LiquidationKeeper(
        keeper_mnemonic, perps_market_id, oracle_id, dry_run=args.dry_run
    )

    if args.once:
        # Run once
        current_price = keeper.get_current_price()
        positions = keeper.get_all_positions()
        keeper.print_status(positions, current_price)

        for position in positions:
            if position.is_liquidatable(current_price):
                keeper.liquidate_position(position, current_price)
        return

    await keeper.run(args.interval)


if __name__ == "__main__":
    asyncio.run(main())
