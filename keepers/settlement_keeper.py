#!/usr/bin/env python3
"""
ChainStrike Settlement Keeper Bot

Settles expired options contracts automatically.
Runs continuously to ensure timely option settlements.

Usage:
    python settlement_keeper.py [--interval SECONDS] [--dry-run]

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
DEFAULT_CHECK_INTERVAL = (
    10  # seconds between checks (reduced for fast 1-min settlements)
)

# Load deployed addresses
DEPLOYED_PATH = Path(__file__).parent.parent / "contracts" / "deployed_addresses.json"

# Mnemonic MUST be provided via the KEEPER_MNEMONIC environment variable.
# Do NOT hardcode mnemonics in source code.
DEFAULT_MNEMONIC = ""  # Empty — set KEEPER_MNEMONIC env var before running


class Option:
    """Represents an options contract."""

    def __init__(self, option_id: int, data: dict):
        self.option_id = option_id
        self.holder = data.get("holder", "")
        self.strike_price = data.get("strike_price", 0)  # In microUSD
        self.expiry = data.get("expiry", 0)  # Unix timestamp
        self.size = data.get("size", 0)  # Contract size in microALGO
        self.premium_paid = data.get("premium", 0)  # Premium in microALGO
        self.is_call = data.get("is_call", True)
        self.is_settled = data.get("is_settled", False)

    def is_expired(self, current_time: int) -> bool:
        """Check if option has expired."""
        return current_time >= self.expiry

    def is_itm(self, current_price: int) -> bool:
        """Check if option is in-the-money."""
        if self.is_call:
            return current_price > self.strike_price
        else:
            return current_price < self.strike_price

    def calculate_payout(self, current_price: int) -> int:
        """Calculate settlement payout."""
        if not self.is_itm(current_price):
            return 0

        if self.is_call:
            # Call payout = (current_price - strike) * size / current_price
            diff = current_price - self.strike_price
        else:
            # Put payout = (strike - current_price) * size / current_price
            diff = self.strike_price - current_price

        # Payout in microALGO
        payout = (diff * self.size) // current_price
        return max(0, payout)

    def __repr__(self):
        option_type = "CALL" if self.is_call else "PUT"
        expiry_str = datetime.fromtimestamp(self.expiry).strftime("%Y-%m-%d %H:%M")
        return f"Option(#{self.option_id} {option_type} @${self.strike_price / 1e6:.2f}, exp={expiry_str})"


class SettlementKeeper:
    """Keeper bot for settling expired options."""

    def __init__(
        self,
        keeper_mnemonic: str,
        options_market_app_id: int,
        oracle_app_id: int,
        dry_run: bool = False,
    ):
        self.algod_client = algod.AlgodClient(ALGOD_TOKEN, TESTNET_ALGOD)
        self.indexer_client = indexer.IndexerClient(INDEXER_TOKEN, TESTNET_INDEXER)
        self.private_key = mnemonic.to_private_key(keeper_mnemonic)
        self.address = account.address_from_private_key(self.private_key)
        self.options_market_app_id = options_market_app_id
        self.oracle_app_id = oracle_app_id
        self.dry_run = dry_run

        # Stats
        self.options_checked = 0
        self.settlements_executed = 0
        self.total_payouts = 0
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

    def get_current_time(self) -> int:
        """Get current block timestamp."""
        try:
            status = self.algod_client.status()
            return status.get("last-round-time", int(time.time()))
        except:
            return int(time.time())

    def get_expired_options(self, current_time: int) -> List[Option]:
        """Get all expired but unsettled options by reading box storage."""
        options = []

        try:
            state = self.read_global_state(self.options_market_app_id)
            option_count = int(state.get("option_count", 0))

            if option_count == 0:
                return options

            # Box key format: "opt_" + option_id (uint64 big-endian, 8 bytes)
            BOX_PREFIX = b"opt_"

            for option_id in range(1, option_count + 1):
                try:
                    box_name_bytes = BOX_PREFIX + option_id.to_bytes(8, "big")
                    box_name_b64 = base64.b64encode(box_name_bytes).decode("utf-8")

                    box_response = self.algod_client.application_box_by_name(
                        self.options_market_app_id, box_name_bytes
                    )
                    box_value = base64.b64decode(box_response.get("value", ""))

                    if len(box_value) < 88:
                        continue

                    # Decode ABI tuple: (uint64,bool,uint64,uint64,uint64,uint64,uint64,address,uint64,uint64,bool,bool)
                    # Offsets (packed ABI encoding):
                    #   0: option_id        uint64 (8 bytes)
                    #   8: is_call          bool   (1 byte)
                    #   9: strike_price     uint64 (8 bytes)
                    #  17: expiry           uint64 (8 bytes)
                    #  25: size             uint64 (8 bytes)
                    #  33: premium          uint64 (8 bytes)
                    #  41: collateral       uint64 (8 bytes)
                    #  49: buyer/holder     address (32 bytes)
                    #  81: creation_time    uint64 (8 bytes)
                    #  89: settlement_price uint64 (8 bytes)
                    #  97: is_exercised     bool   (1 byte)
                    #  98: is_settled       bool   (1 byte)
                    is_call = bool(box_value[8])
                    strike_price = int.from_bytes(box_value[9:17], "big")
                    expiry = int.from_bytes(box_value[17:25], "big")
                    size = int.from_bytes(box_value[25:33], "big")
                    premium = int.from_bytes(box_value[33:41], "big")
                    holder_bytes = box_value[49:81]
                    is_settled = bool(box_value[98]) if len(box_value) > 98 else False

                    # Convert holder address from 32-byte public key
                    try:
                        holder_addr = encoding.encode_address(holder_bytes)
                    except Exception:
                        holder_addr = ""

                    option = Option(
                        option_id,
                        {
                            "holder": holder_addr,
                            "strike_price": strike_price,
                            "expiry": expiry,
                            "size": size,
                            "premium": premium,
                            "is_call": is_call,
                            "is_settled": is_settled,
                        },
                    )

                    if option.is_expired(current_time) and not option.is_settled:
                        options.append(option)
                        self.options_checked += 1

                except Exception as box_err:
                    # Box may not exist for this ID — skip silently
                    if "box not found" not in str(box_err).lower():
                        print(
                            f"  [WARN] Error reading option box {option_id}: {box_err}"
                        )
                    continue

        except Exception as e:
            print(f"  [ERR] Error fetching options: {e}")

        return options

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

    def settle_option(self, option: Option, current_price: int) -> bool:
        """Settle an expired option."""
        payout = option.calculate_payout(current_price)

        if self.dry_run:
            print(f"  [DRY RUN] Would settle {option}")
            print(f"            Payout: {payout / 1_000_000:.6f} ALGO")
            self.settlements_executed += 1
            self.total_payouts += payout
            return True

        try:
            # Get suggested params
            sp = self.algod_client.suggested_params()

            # Build settlement call
            # Method signature: settle_option(uint64)uint64
            # Selector = first 4 bytes of SHA-512/256("settle_option(uint64)uint64")
            method_selector = bytes.fromhex("2a17b262")
            option_id_bytes = option.option_id.to_bytes(8, "big")

            txn = ApplicationNoOpTxn(
                sender=self.address,
                sp=sp,
                index=self.options_market_app_id,
                app_args=[method_selector, option_id_bytes],
                accounts=[option.holder] if option.holder else [],
            )

            signed_txn = txn.sign(self.private_key)
            txid = self.algod_client.send_transaction(signed_txn)
            print(f"  [TX] Settling option #{option.option_id}... TX: {txid}")

            result = self.wait_for_confirmation(txid)
            print(
                f"  [OK] Settlement confirmed in round {result.get('confirmed-round')}"
            )
            print(f"       Payout: {payout / 1_000_000:.6f} ALGO")

            self.settlements_executed += 1
            self.total_payouts += payout
            return True

        except Exception as e:
            print(f"  [ERR] Settlement error: {e}")
            self.errors += 1
            return False

    def print_status(
        self, options: List[Option], current_price: int, current_time: int
    ):
        """Print current status."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        print(f"\n[{timestamp}] Settlement Check")
        print(f"  Current Price: ${current_price / 1_000_000:.4f}")
        print(f"  Expired Options: {len(options)}")

        itm_count = sum(1 for o in options if o.is_itm(current_price))
        print(f"  In-The-Money: {itm_count}")
        print(
            f"  Stats: Checked={self.options_checked} | Settled={self.settlements_executed} | Errors={self.errors}"
        )
        print(f"  Total Payouts: {self.total_payouts / 1_000_000:.6f} ALGO")

    def check_balance(self) -> float:
        """Check keeper account balance."""
        account_info = self.algod_client.account_info(self.address)
        balance = account_info.get("amount", 0) / 1_000_000
        return balance

    async def run(self, interval: int):
        """Main keeper loop."""
        print("=" * 60)
        print("ChainStrike Settlement Keeper")
        print("=" * 60)
        print(f"Keeper Address:      {self.address}")
        print(f"Options Market ID:   {self.options_market_app_id}")
        print(f"Oracle ID:           {self.oracle_app_id}")
        print(f"Check Interval:      {interval}s")
        print(f"Dry Run:             {self.dry_run}")

        balance = self.check_balance()
        print(f"Balance:             {balance:.6f} ALGO")

        if balance < 0.1 and not self.dry_run:
            print("\n[WARN] Low balance! Get TestNet ALGO from:")
            print("       https://bank.testnet.algorand.network/")

        print("=" * 60)

        while True:
            try:
                # Get current price and time
                current_price = self.get_current_price()
                current_time = self.get_current_time()

                if current_price == 0:
                    print(f"  [WARN] No price available from oracle")
                    await asyncio.sleep(interval)
                    continue

                # Get expired options
                expired_options = self.get_expired_options(current_time)
                self.options_checked += len(expired_options)

                # Print status
                self.print_status(expired_options, current_price, current_time)

                # Settle expired options
                for option in expired_options:
                    if not option.is_settled:
                        payout = option.calculate_payout(current_price)
                        status = "ITM" if option.is_itm(current_price) else "OTM"

                        print(f"\n  [!] Expired option found:")
                        print(f"      Option: {option}")
                        print(f"      Status: {status}")
                        print(f"      Payout: {payout / 1_000_000:.6f} ALGO")

                        self.settle_option(option, current_price)

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
    options_market_id = 0
    oracle_id = 0

    if DEPLOYED_PATH.exists():
        with open(DEPLOYED_PATH) as f:
            deployed = json.load(f)
            contracts = deployed.get("contracts", {})
            options_market_id = contracts.get("options_market", 0)
            oracle_id = contracts.get("oracle", 0)

    return options_market_id, oracle_id


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="ChainStrike Settlement Keeper Bot")
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
    options_market_id, oracle_id = load_contract_ids()

    if not keeper_mnemonic:
        print("[ERROR] KEEPER_MNEMONIC environment variable is not set.")
        print("  Export it before running: export KEEPER_MNEMONIC='word1 word2 ...'")
        sys.exit(1)

    options_market_id = int(os.getenv("OPTIONS_MARKET_APP_ID", str(options_market_id)))
    oracle_id = int(os.getenv("ORACLE_APP_ID", str(oracle_id)))

    if options_market_id == 0 or oracle_id == 0:
        print("[WARN] Contract IDs not set, running in simulation mode")
        args.dry_run = True

    keeper = SettlementKeeper(
        keeper_mnemonic, options_market_id, oracle_id, dry_run=args.dry_run
    )

    if args.once:
        # Run once
        current_price = keeper.get_current_price()
        current_time = keeper.get_current_time()
        expired_options = keeper.get_expired_options(current_time)
        keeper.print_status(expired_options, current_price, current_time)

        for option in expired_options:
            if not option.is_settled:
                keeper.settle_option(option, current_price)
        return

    await keeper.run(args.interval)


if __name__ == "__main__":
    asyncio.run(main())
