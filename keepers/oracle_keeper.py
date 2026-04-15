#!/usr/bin/env python3
"""
ChainStrike Oracle Keeper Bot

Fetches ALGO prices from multiple sources and updates the on-chain oracle.
Runs continuously to ensure fresh price data.

Sources:
- Binance: Real-time trading price
- CoinGecko: Aggregated market price
- Vestige: On-chain DEX price

Usage:
    python oracle_keeper.py [--interval SECONDS] [--dry-run]

Environment:
    KEEPER_MNEMONIC: Keeper account mnemonic (needs ALGO for txn fees)
"""

import argparse
import asyncio
import json
import os
import ssl
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

# Disable SSL verification for macOS Python 3.13+
ssl._create_default_https_context = ssl._create_unverified_context

try:
    import aiohttp
    from algosdk import account, mnemonic
    from algosdk.v2client import algod
    from algosdk.transaction import ApplicationNoOpTxn
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with: pip install aiohttp py-algorand-sdk")
    sys.exit(1)


# Configuration
TESTNET_ALGOD = "https://testnet-api.4160.nodely.dev"
ALGOD_TOKEN = ""
DEFAULT_UPDATE_INTERVAL = 60  # seconds between updates
PRICE_DECIMALS = 6  # microUSD (6 decimals)

# Price sources
BINANCE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=ALGOUSDT"
COINGECKO_URL = (
    "https://api.coingecko.com/api/v3/simple/price?ids=algorand&vs_currencies=usd"
)
VESTIGE_URL = "https://free-api.vestige.fi/asset/0/price"

# Load deployed addresses
DEPLOYED_PATH = Path(__file__).parent.parent / "contracts" / "deployed_addresses.json"

# Mnemonic MUST be provided via the KEEPER_MNEMONIC environment variable.
# Do NOT hardcode mnemonics in source code.
DEFAULT_MNEMONIC = ""  # Empty — set KEEPER_MNEMONIC env var before running


class OracleKeeper:
    """Keeper bot for oracle price updates."""

    def __init__(self, keeper_mnemonic: str, oracle_app_id: int, dry_run: bool = False):
        self.client = algod.AlgodClient(ALGOD_TOKEN, TESTNET_ALGOD)
        self.private_key = mnemonic.to_private_key(keeper_mnemonic)
        self.address = account.address_from_private_key(self.private_key)
        self.oracle_app_id = oracle_app_id
        self.dry_run = dry_run

        # Stats
        self.updates_sent = 0
        self.errors = 0
        self.last_prices = {
            "binance": 0,
            "coingecko": 0,
            "vestige": 0,
        }

    async def fetch_binance_price(
        self, session: aiohttp.ClientSession
    ) -> Optional[int]:
        """Fetch ALGO/USD price from Binance."""
        try:
            async with session.get(
                BINANCE_URL, timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    price = float(data["price"])
                    # Convert to microUSD
                    return int(price * (10**PRICE_DECIMALS))
        except Exception as e:
            print(f"  [!] Binance error: {e}")
        return None

    async def fetch_coingecko_price(
        self, session: aiohttp.ClientSession
    ) -> Optional[int]:
        """Fetch ALGO/USD price from CoinGecko."""
        try:
            async with session.get(
                COINGECKO_URL, timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    price = data["algorand"]["usd"]
                    return int(price * (10**PRICE_DECIMALS))
        except Exception as e:
            print(f"  [!] CoinGecko error: {e}")
        return None

    async def fetch_vestige_price(
        self, session: aiohttp.ClientSession
    ) -> Optional[int]:
        """Fetch ALGO/USD price from Vestige."""
        try:
            async with session.get(
                VESTIGE_URL, timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    price = data.get("price", 0)
                    return int(price * (10**PRICE_DECIMALS))
        except Exception as e:
            print(f"  [!] Vestige error: {e}")
        return None

    async def fetch_all_prices(self) -> dict:
        """Fetch prices from all sources concurrently."""
        connector = aiohttp.TCPConnector(ssl=False)
        async with aiohttp.ClientSession(connector=connector) as session:
            results = await asyncio.gather(
                self.fetch_binance_price(session),
                self.fetch_coingecko_price(session),
                self.fetch_vestige_price(session),
                return_exceptions=True,
            )

        prices = {
            "binance": results[0] if isinstance(results[0], int) else 0,
            "coingecko": results[1] if isinstance(results[1], int) else 0,
            "vestige": results[2] if isinstance(results[2], int) else 0,
        }

        return prices

    def wait_for_confirmation(self, txid: str, timeout: int = 10) -> dict:
        """Wait for transaction confirmation."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                txinfo = self.client.pending_transaction_info(txid)
                if txinfo.get("confirmed-round", 0) > 0:
                    return txinfo
                if txinfo.get("pool-error", ""):
                    raise Exception(f"Transaction failed: {txinfo['pool-error']}")
            except Exception as e:
                if "pending" not in str(e).lower():
                    pass
            time.sleep(0.5)
        raise Exception(f"Transaction {txid} timed out")

    def update_oracle(self, prices: dict) -> bool:
        """Send price update transaction to oracle contract."""
        if self.dry_run:
            print(f"  [DRY RUN] Would update oracle with: {prices}")
            self.updates_sent += 1
            return True

        try:
            # Get suggested params
            sp = self.client.suggested_params()

            # Build ARC4 method call for update_price
            # Method signature: update_price(uint64,uint64,uint64)(uint64,uint64,uint64,uint64)
            method_selector = bytes.fromhex(
                "9179c0da"
            )  # First 4 bytes of SHA512/256 of method sig

            # Encode prices as 8-byte big-endian integers
            binance_bytes = prices["binance"].to_bytes(8, "big")
            coingecko_bytes = prices["coingecko"].to_bytes(8, "big")
            vestige_bytes = prices["vestige"].to_bytes(8, "big")

            txn = ApplicationNoOpTxn(
                sender=self.address,
                sp=sp,
                index=self.oracle_app_id,
                app_args=[
                    method_selector,
                    binance_bytes,
                    coingecko_bytes,
                    vestige_bytes,
                ],
            )

            signed_txn = txn.sign(self.private_key)
            txid = self.client.send_transaction(signed_txn)
            print(f"  [TX] Updating oracle... {txid}")

            result = self.wait_for_confirmation(txid)
            print(f"  [OK] Oracle updated in round {result.get('confirmed-round')}")

            self.updates_sent += 1
            return True

        except Exception as e:
            print(f"  [ERR] Oracle update error: {e}")
            self.errors += 1
            return False

    def print_status(self, prices: dict):
        """Print current status."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Format prices
        binance = (
            prices["binance"] / (10**PRICE_DECIMALS) if prices["binance"] else "N/A"
        )
        coingecko = (
            prices["coingecko"] / (10**PRICE_DECIMALS) if prices["coingecko"] else "N/A"
        )
        vestige = (
            prices["vestige"] / (10**PRICE_DECIMALS) if prices["vestige"] else "N/A"
        )

        # Calculate median
        valid_prices = [p for p in prices.values() if p > 0]
        if valid_prices:
            valid_prices.sort()
            if len(valid_prices) >= 2:
                median = valid_prices[len(valid_prices) // 2] / (10**PRICE_DECIMALS)
            else:
                median = valid_prices[0] / (10**PRICE_DECIMALS)
        else:
            median = "N/A"

        print(f"\n[{timestamp}] ALGO/USD Prices:")
        print(f"  Binance:   ${binance}")
        print(f"  CoinGecko: ${coingecko}")
        print(f"  Vestige:   ${vestige}")
        print(f"  Median:    ${median}")
        print(f"  Updates: {self.updates_sent} | Errors: {self.errors}")

    def check_balance(self) -> float:
        """Check keeper account balance."""
        account_info = self.client.account_info(self.address)
        balance = account_info.get("amount", 0) / 1_000_000
        return balance

    async def run(self, interval: int):
        """Main keeper loop."""
        print("=" * 60)
        print("ChainStrike Oracle Keeper")
        print("=" * 60)
        print(f"Keeper Address:  {self.address}")
        print(f"Oracle App ID:   {self.oracle_app_id}")
        print(f"Update Interval: {interval}s")
        print(f"Dry Run:         {self.dry_run}")

        balance = self.check_balance()
        print(f"Balance:         {balance:.6f} ALGO")

        if balance < 0.1 and not self.dry_run:
            print("\n[WARN] Low balance! Get TestNet ALGO from:")
            print("       https://bank.testnet.algorand.network/")

        print("=" * 60)

        while True:
            try:
                # Fetch prices
                prices = await self.fetch_all_prices()

                # Print status
                self.print_status(prices)

                # Count valid prices
                valid_count = sum(1 for p in prices.values() if p > 0)

                if valid_count >= 2:
                    # Update oracle
                    self.update_oracle(prices)
                    self.last_prices = prices
                else:
                    print(f"  [SKIP] Only {valid_count} valid sources (need 2+)")

            except KeyboardInterrupt:
                print("\n\nShutting down...")
                break
            except Exception as e:
                print(f"  [ERR] Loop error: {e}")
                self.errors += 1

            # Wait for next update
            try:
                await asyncio.sleep(interval)
            except KeyboardInterrupt:
                print("\n\nShutting down...")
                break


def load_oracle_app_id() -> int:
    """Load oracle app ID from deployed addresses."""
    if DEPLOYED_PATH.exists():
        with open(DEPLOYED_PATH) as f:
            deployed = json.load(f)
            return deployed.get("contracts", {}).get("oracle", 0)
    return 0


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="ChainStrike Oracle Keeper Bot")
    parser.add_argument(
        "--interval",
        type=int,
        default=DEFAULT_UPDATE_INTERVAL,
        help=f"Update interval in seconds (default: {DEFAULT_UPDATE_INTERVAL})",
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
    oracle_app_id = int(os.getenv("ORACLE_APP_ID", str(load_oracle_app_id())))

    if not keeper_mnemonic:
        print("[ERROR] KEEPER_MNEMONIC environment variable is not set.")
        print("  Export it before running: export KEEPER_MNEMONIC='word1 word2 ...'")
        sys.exit(1)

    if oracle_app_id == 0:
        print("[WARN] ORACLE_APP_ID not set, running in simulation mode")
        args.dry_run = True

    keeper = OracleKeeper(keeper_mnemonic, oracle_app_id, dry_run=args.dry_run)

    if args.once:
        # Run once
        prices = await keeper.fetch_all_prices()
        keeper.print_status(prices)
        valid_count = sum(1 for p in prices.values() if p > 0)
        if valid_count >= 2:
            keeper.update_oracle(prices)
        return

    await keeper.run(args.interval)


if __name__ == "__main__":
    asyncio.run(main())
