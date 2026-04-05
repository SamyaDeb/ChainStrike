"""
ChainStrike Settlement Keeper Bot

Automatically settles expired options.
Runs continuously to ensure timely settlement of Quick Options.

Usage:
    python keeper_settlement.py

Environment:
    KEEPER_MNEMONIC: Keeper account mnemonic (needs ALGO for txn fees)
    OPTIONS_MARKET_APP_ID: Options Market contract app ID
"""

import asyncio
import base64
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any

from algosdk import account, mnemonic, abi, encoding
from algosdk.v2client import algod, indexer
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    AccountTransactionSigner,
)

# Configuration
TESTNET_ALGOD = "https://testnet-api.algonode.cloud"
TESTNET_INDEXER = "https://testnet-idx.algonode.cloud"
SETTLEMENT_INTERVAL = 30  # Check every 30 seconds for expired options
OPTIONS_MARKET_APP_ID = 758189779  # From deployed contracts


class SettlementKeeper:
    """Keeper bot for settling expired options."""

    def __init__(self, keeper_mnemonic: str, options_app_id: int):
        self.algod_client = algod.AlgodClient("", TESTNET_ALGOD)
        self.indexer_client = indexer.IndexerClient("", TESTNET_INDEXER)
        self.private_key = mnemonic.to_private_key(keeper_mnemonic)
        self.address = account.address_from_private_key(self.private_key)
        self.signer = AccountTransactionSigner(self.private_key)
        self.options_app_id = options_app_id
        self.options_contract = self._load_options_contract()

        # Stats
        self.settlements_executed = 0
        self.settlements_failed = 0
        self.last_check_time = 0
        self.expired_options_found = 0

    def _load_options_contract(self):
        """Load OptionsMarket ABI contract from ARC-56 JSON."""
        arc56_path = Path(__file__).parent.parent / ".build" / "options_market" / "OptionsMarket.arc56.json"
        if arc56_path.exists():
            arc56 = json.loads(arc56_path.read_text())
            methods = []
            for m in arc56.get("methods", []):
                args = [abi.Argument(a["type"], a.get("name", "")) for a in m.get("args", [])]
                returns = abi.Returns(m.get("returns", {}).get("type", "void"))
                methods.append(abi.Method(m["name"], args, returns, m.get("desc", "")))
            return abi.Contract("OptionsMarket", methods)
        print("  ⚠️  OptionsMarket ARC-56 not found")
        return None

    def _decode_option_box(self, box_name: bytes, box_value: bytes) -> Optional[Dict[str, Any]]:
        """Decode an option from box storage."""
        try:
            # Box name format: "opt_" + option_id (8 bytes)
            if not box_name.startswith(b"opt_"):
                return None

            option_id = int.from_bytes(box_name[4:], "big")

            # Decode option struct (based on contract structure)
            # Option { holder: Address, is_call: bool, strike_price: u64, expiry: u64, size: u64, premium_paid: u64, is_settled: bool }
            if len(box_value) < 32 + 1 + 8 + 8 + 8 + 8 + 1:  # 66 bytes minimum
                return None

            holder = encoding.encode_address(box_value[0:32])
            is_call = box_value[32] == 1
            strike_price = int.from_bytes(box_value[33:41], "big")
            expiry = int.from_bytes(box_value[41:49], "big")
            size = int.from_bytes(box_value[49:57], "big")
            premium_paid = int.from_bytes(box_value[57:65], "big")
            is_settled = box_value[65] == 1 if len(box_value) > 65 else False

            return {
                "option_id": option_id,
                "holder": holder,
                "is_call": is_call,
                "strike_price": strike_price,
                "expiry": expiry,
                "size": size,
                "premium_paid": premium_paid,
                "is_settled": is_settled,
            }
        except Exception as e:
            print(f"  Error decoding option box: {e}")
            return None

    async def get_expired_options(self) -> List[Dict[str, Any]]:
        """Get list of expired but unsettled options."""
        expired_options = []
        current_time = int(time.time())

        try:
            # Get all boxes for the options market app
            boxes_response = self.algod_client.application_boxes(self.options_app_id)
            boxes = boxes_response.get("boxes", [])

            for box_info in boxes:
                box_name_b64 = box_info.get("name", "")
                box_name = base64.b64decode(box_name_b64)

                # Only process option boxes (prefix "opt_")
                if not box_name.startswith(b"opt_"):
                    continue

                # Get box value
                try:
                    box_response = self.algod_client.application_box_by_name(self.options_app_id, box_name)
                    box_value = base64.b64decode(box_response.get("value", ""))

                    option = self._decode_option_box(box_name, box_value)
                    if option and not option["is_settled"] and option["expiry"] <= current_time:
                        expired_options.append(option)

                except Exception as e:
                    print(f"  Error reading box {box_name.hex()}: {e}")
                    continue

        except Exception as e:
            print(f"  Error fetching boxes: {e}")

        return expired_options

    def settle_option(self, option_id: int) -> bool:
        """Settle an individual expired option."""
        try:
            if not self.options_contract:
                print(f"  ⚠️  No contract ABI loaded")
                return False

            method = self.options_contract.get_method_by_name("settle_option")

            sp = self.algod_client.suggested_params()
            sp.flat_fee = True
            sp.fee = 3000  # Extra fee for potential inner transactions

            atc = AtomicTransactionComposer()
            atc.add_method_call(
                app_id=self.options_app_id,
                method=method,
                sender=self.address,
                sp=sp,
                signer=self.signer,
                method_args=[option_id],
            )

            result = atc.execute(self.algod_client, 10)
            self.settlements_executed += 1
            print(f"  ✅ Settled option #{option_id} - TX: {result.tx_ids[0]}")
            return True

        except Exception as e:
            self.settlements_failed += 1
            error_msg = str(e)
            # Check for common expected errors
            if "already settled" in error_msg.lower():
                print(f"  ⏭️  Option #{option_id} already settled")
                return True
            elif "not expired" in error_msg.lower():
                print(f"  ⏳ Option #{option_id} not yet expired")
                return False
            else:
                print(f"  ❌ Failed to settle option #{option_id}: {e}")
                return False

    def print_status(self, expired_count: int):
        """Print current status."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"\n[{timestamp}] Settlement Keeper Status:")
        print(f"  Expired options found: {expired_count}")
        print(f"  Total settlements: {self.settlements_executed}")
        print(f"  Failed settlements: {self.settlements_failed}")

    async def run(self):
        """Main keeper loop."""
        print("=" * 60)
        print("ChainStrike Settlement Keeper")
        print("=" * 60)
        print(f"Keeper Address: {self.address}")
        print(f"Options Market App ID: {self.options_app_id}")
        print(f"Settlement Interval: {SETTLEMENT_INTERVAL}s")
        print("=" * 60)

        while True:
            try:
                self.last_check_time = int(time.time())

                # Find expired options
                expired_options = await self.get_expired_options()
                self.expired_options_found = len(expired_options)

                # Print status
                self.print_status(len(expired_options))

                if expired_options:
                    print(f"\n  Processing {len(expired_options)} expired options...")
                    for option in expired_options:
                        option_type = "CALL" if option["is_call"] else "PUT"
                        expiry_time = datetime.fromtimestamp(option["expiry"]).strftime("%H:%M:%S")
                        print(f"\n  Option #{option['option_id']}: {option_type}")
                        print(f"    Holder: {option['holder'][:8]}...{option['holder'][-4:]}")
                        print(f"    Strike: ${option['strike_price'] / 1_000_000:.4f}")
                        print(f"    Size: {option['size'] / 1_000_000:.2f} ALGO")
                        print(f"    Expired at: {expiry_time}")

                        # Settle the option
                        self.settle_option(option["option_id"])

                        # Small delay between settlements to avoid rate limiting
                        await asyncio.sleep(0.5)
                else:
                    print("  No expired options to settle")

            except Exception as e:
                print(f"  Loop error: {e}")

            # Wait for next check
            await asyncio.sleep(SETTLEMENT_INTERVAL)


async def main():
    """Main entry point."""
    keeper_mnemonic = os.getenv(
        "KEEPER_MNEMONIC",
        "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss",
    )
    options_app_id = int(os.getenv("OPTIONS_MARKET_APP_ID", str(OPTIONS_MARKET_APP_ID)))

    keeper = SettlementKeeper(keeper_mnemonic, options_app_id)
    await keeper.run()


if __name__ == "__main__":
    asyncio.run(main())
