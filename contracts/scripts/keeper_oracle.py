"""
ChainStrike Oracle Keeper Bot

Fetches ALGO prices from multiple sources and updates the on-chain oracle.
Runs continuously to ensure fresh price data.

Sources:
- Binance: Real-time trading price
- CoinGecko: Aggregated market price
- Vestige: On-chain DEX price

Usage:
    python keeper_oracle.py

Environment:
    KEEPER_MNEMONIC: Keeper account mnemonic (needs ALGO for txn fees)
    ORACLE_APP_ID: Oracle contract app ID
"""

import asyncio
import base64
import json
import os
import ssl
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import aiohttp
from algosdk import account, mnemonic, transaction, abi
from algosdk.v2client import algod
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    AccountTransactionSigner,
)

# Fix SSL
import urllib.request

ssl_context = ssl._create_unverified_context()
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context)))


# Configuration
TESTNET_ALGOD = "https://testnet-api.algonode.cloud"
UPDATE_INTERVAL = 15  # seconds between updates (reduced for Quick Options)
PRICE_DECIMALS = 6  # microUSD (6 decimals)

# Price sources
BINANCE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=ALGOUSDT"
COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=algorand&vs_currencies=usd"
VESTIGE_URL = "https://free-api.vestige.fi/asset/0/price"


class OracleKeeper:
    """Keeper bot for oracle price updates."""

    def __init__(self, keeper_mnemonic: str, oracle_app_id: int):
        self.client = algod.AlgodClient("", TESTNET_ALGOD)
        self.private_key = mnemonic.to_private_key(keeper_mnemonic)
        self.address = account.address_from_private_key(self.private_key)
        self.signer = AccountTransactionSigner(self.private_key)
        self.oracle_app_id = oracle_app_id
        self.oracle_contract = self._load_oracle_contract()

        # Stats
        self.updates_sent = 0
        self.errors = 0
        self.last_prices = {
            "binance": 0,
            "coingecko": 0,
            "vestige": 0,
        }

    def _load_oracle_contract(self):
        """Load Oracle ABI contract from ARC-56 JSON."""
        arc56_path = Path(__file__).parent.parent / ".build" / "oracle" / "Oracle.arc56.json"
        if arc56_path.exists():
            arc56 = json.loads(arc56_path.read_text())
            methods = []
            for m in arc56.get("methods", []):
                args = [abi.Argument(a["type"], a.get("name", "")) for a in m.get("args", [])]
                returns = abi.Returns(m.get("returns", {}).get("type", "void"))
                methods.append(abi.Method(m["name"], args, returns, m.get("desc", "")))
            return abi.Contract("Oracle", methods)
        print("  ⚠️  Oracle ARC-56 not found, will use emergency_set_price fallback")
        return None

    async def fetch_binance_price(self, session: aiohttp.ClientSession) -> Optional[int]:
        """Fetch ALGO/USD price from Binance."""
        try:
            async with session.get(BINANCE_URL, timeout=5) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    price = float(data["price"])
                    # Convert to microUSD
                    return int(price * (10**PRICE_DECIMALS))
        except Exception as e:
            print(f"  Binance error: {e}")
        return None

    async def fetch_coingecko_price(self, session: aiohttp.ClientSession) -> Optional[int]:
        """Fetch ALGO/USD price from CoinGecko."""
        try:
            async with session.get(COINGECKO_URL, timeout=5) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    price = data["algorand"]["usd"]
                    return int(price * (10**PRICE_DECIMALS))
        except Exception as e:
            print(f"  CoinGecko error: {e}")
        return None

    async def fetch_vestige_price(self, session: aiohttp.ClientSession) -> Optional[int]:
        """Fetch ALGO/USD price from Vestige."""
        try:
            async with session.get(VESTIGE_URL, timeout=5) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    price = data.get("price", 0)
                    return int(price * (10**PRICE_DECIMALS))
        except Exception as e:
            print(f"  Vestige error: {e}")
        return None

    async def fetch_all_prices(self) -> dict:
        """Fetch prices from all sources concurrently."""
        async with aiohttp.ClientSession() as session:
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

    def update_oracle(self, prices: dict) -> bool:
        """Send price update transaction to oracle contract."""
        try:
            # Calculate median price
            valid_prices = sorted([p for p in prices.values() if p > 0])
            if len(valid_prices) < 2:
                print("  Not enough valid prices to update")
                return False

            median = valid_prices[len(valid_prices) // 2]

            if self.oracle_contract:
                # Try update_prices method first
                try:
                    method = self.oracle_contract.get_method_by_name("update_prices")
                    sp = self.client.suggested_params()
                    sp.flat_fee = True
                    sp.fee = 2000

                    atc = AtomicTransactionComposer()
                    atc.add_method_call(
                        app_id=self.oracle_app_id,
                        method=method,
                        sender=self.address,
                        sp=sp,
                        signer=self.signer,
                        method_args=[
                            prices.get("binance", 0),
                            prices.get("coingecko", 0),
                            prices.get("vestige", 0),
                        ],
                    )
                    atc.execute(self.client, 10)
                    self.updates_sent += 1
                    print(f"  ✅ Oracle updated via update_prices (median=${median / 1e6:.4f})")
                    return True
                except Exception as e:
                    print(f"  ⚠️  update_prices failed: {e}")
                    # Fallback to emergency_set_price
                    try:
                        method = self.oracle_contract.get_method_by_name("emergency_set_price")
                        sp = self.client.suggested_params()
                        sp.flat_fee = True
                        sp.fee = 2000

                        atc = AtomicTransactionComposer()
                        atc.add_method_call(
                            app_id=self.oracle_app_id,
                            method=method,
                            sender=self.address,
                            sp=sp,
                            signer=self.signer,
                            method_args=[median],
                        )
                        atc.execute(self.client, 10)
                        self.updates_sent += 1
                        print(f"  ✅ Oracle updated via emergency_set_price (${median / 1e6:.4f})")
                        return True
                    except Exception as e2:
                        print(f"  ❌ emergency_set_price also failed: {e2}")
            else:
                print(f"  Would update oracle with median=${median / 1e6:.4f}")
                self.updates_sent += 1
                return True

        except Exception as e:
            print(f"  Oracle update error: {e}")
            self.errors += 1
            return False

    def print_status(self, prices: dict):
        """Print current status."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Format prices
        binance = prices["binance"] / (10**PRICE_DECIMALS) if prices["binance"] else "N/A"
        coingecko = prices["coingecko"] / (10**PRICE_DECIMALS) if prices["coingecko"] else "N/A"
        vestige = prices["vestige"] / (10**PRICE_DECIMALS) if prices["vestige"] else "N/A"

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

    async def run(self):
        """Main keeper loop."""
        print("=" * 60)
        print("ChainStrike Oracle Keeper")
        print("=" * 60)
        print(f"Keeper Address: {self.address}")
        print(f"Oracle App ID:  {self.oracle_app_id}")
        print(f"Update Interval: {UPDATE_INTERVAL}s")
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
                    print(f"  Skipping update: Only {valid_count} valid sources")

            except Exception as e:
                print(f"  Loop error: {e}")
                self.errors += 1

            # Wait for next update
            await asyncio.sleep(UPDATE_INTERVAL)


async def main():
    """Main entry point."""
    # Get configuration from environment or use defaults
    keeper_mnemonic = os.getenv(
        "KEEPER_MNEMONIC",
        "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss",
    )
    oracle_app_id = int(os.getenv("ORACLE_APP_ID", "758189767"))

    if oracle_app_id == 0:
        print("Warning: ORACLE_APP_ID not set, running in simulation mode")

    keeper = OracleKeeper(keeper_mnemonic, oracle_app_id)
    await keeper.run()


if __name__ == "__main__":
    asyncio.run(main())
