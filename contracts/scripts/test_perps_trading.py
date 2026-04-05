#!/usr/bin/env python3
"""
Test perpetual trading on-chain with real wallet.
Tests both long and short positions with 10 ALGO margin and 5x leverage.
"""

import base64
import hashlib
import ssl
import time
import urllib.request
from algosdk import account, mnemonic, transaction
from algosdk.v2client import algod
from algosdk.logic import get_application_address
from algosdk import encoding

# Fix SSL certificate issues
ssl._create_default_https_context = ssl._create_unverified_context

# Algorand TestNet
ALGOD_ADDRESS = "https://testnet-api.algonode.cloud"
ALGOD_TOKEN = ""

# Test wallet mnemonic
TEST_MNEMONIC = "vacant extra will swarm love ability zone deny auto autumn outdoor swap weapon van net before version truck sister manage goose census grunt absorb sword"

# Deployed contracts
CONTRACTS = {
    "oracle": 758290477,
    "staking": 758290479,
    "options_pool": 758290646,
    "options_market": 758290651,
    "perps_pool": 758290663,
    "perps_market": 758290831,
}


def get_method_selector(signature: str) -> bytes:
    """Get ABI method selector (first 4 bytes of SHA-512/256 hash)."""
    h = hashlib.new("sha512_256")
    h.update(signature.encode())
    return h.digest()[:4]


class PerpsTrader:
    def __init__(self):
        self.client = algod.AlgodClient(ALGOD_TOKEN, ALGOD_ADDRESS)
        self.private_key = mnemonic.to_private_key(TEST_MNEMONIC)
        self.address = account.address_from_private_key(self.private_key)

        print(f"=" * 60)
        print("ChainStrike Perpetuals Trading Test")
        print(f"=" * 60)
        print(f"Wallet: {self.address}")

        try:
            account_info = self.client.account_info(self.address)
            balance = account_info.get("amount", 0) / 1_000_000
            print(f"Balance: {balance:.6f} ALGO")

            # Check min balance requirement
            min_balance = account_info.get("min-balance", 0) / 1_000_000
            print(f"Min Balance Required: {min_balance:.6f} ALGO")
            print(
                f"Available: {(account_info.get('amount', 0) - account_info.get('min-balance', 0)) / 1_000_000:.6f} ALGO"
            )
        except Exception as e:
            print(f"Error getting account info: {e}")

    def wait_for_confirmation(self, txid: str, timeout: int = 10) -> dict:
        """Wait for transaction confirmation."""
        start = time.time()
        while time.time() - start < timeout:
            try:
                txinfo = self.client.pending_transaction_info(txid)
                if txinfo.get("confirmed-round", 0) > 0:
                    print(f"   ✓ Confirmed in round {txinfo['confirmed-round']}")
                    return txinfo
                if txinfo.get("pool-error"):
                    raise Exception(f"Transaction rejected: {txinfo['pool-error']}")
            except Exception as e:
                if "confirmed-round" not in str(e):
                    pass
            time.sleep(0.5)
        raise Exception(f"Transaction not confirmed within {timeout} seconds")

    def check_contract_state(self):
        """Check perps market contract state."""
        print(f"\n{'=' * 60}")
        print("Checking Perps Market Contract State")
        print(f"{'=' * 60}")

        app_id = CONTRACTS["perps_market"]
        try:
            app_info = self.client.application_info(app_id)
            global_state = {}

            if "params" in app_info and "global-state" in app_info["params"]:
                for item in app_info["params"]["global-state"]:
                    key = base64.b64decode(item["key"]).decode("utf-8")
                    if item["value"]["type"] == 2:  # uint
                        global_state[key] = item["value"]["uint"]
                    else:
                        global_state[key] = item["value"].get("bytes", "")

            print(f"Oracle App ID: {global_state.get('oracle_app_id', 'NOT SET')}")
            print(f"Pool App ID: {global_state.get('perps_pool', 'NOT SET')}")
            print(f"Next Position ID: {global_state.get('next_position_id', 0)}")
            print(f"Active Positions: {global_state.get('active_positions', 0)}")
            print(f"Total Long OI: {global_state.get('total_long_oi', 0) / 1_000_000:.6f} ALGO")
            print(f"Total Short OI: {global_state.get('total_short_oi', 0) / 1_000_000:.6f} ALGO")
            print(f"Min Margin: {global_state.get('min_margin', 0) / 1_000_000:.6f} ALGO")
            print(f"Min Position Size: {global_state.get('min_position_size', 0) / 1_000_000:.6f} ALGO")
            print(f"Min Leverage: {global_state.get('min_leverage', 0) / 100:.1f}x")
            print(f"Max Leverage: {global_state.get('max_leverage', 0) / 100:.1f}x")
            print(f"Is Paused: {global_state.get('is_paused', 0)}")

            return global_state
        except Exception as e:
            print(f"Error checking contract state: {e}")
            return {}

    def check_oracle_price(self):
        """Get current oracle price."""
        print(f"\n{'=' * 60}")
        print("Checking Oracle Price")
        print(f"{'=' * 60}")

        app_id = CONTRACTS["oracle"]
        try:
            app_info = self.client.application_info(app_id)

            if "params" in app_info and "global-state" in app_info["params"]:
                for item in app_info["params"]["global-state"]:
                    key = base64.b64decode(item["key"]).decode("utf-8")
                    if key == "current_price":
                        price = item["value"]["uint"]
                        print(f"Current Price: {price} microUSD = ${price / 1_000_000:.6f}")
                        return price

            print("WARNING: Oracle price not found!")
            return 0
        except Exception as e:
            print(f"Error checking oracle: {e}")
            return 0

    def check_pool_liquidity(self):
        """Check perps pool liquidity."""
        print(f"\n{'=' * 60}")
        print("Checking Perps Pool Liquidity")
        print(f"{'=' * 60}")

        app_id = CONTRACTS["perps_pool"]
        pool_address = get_application_address(app_id)

        try:
            # Check pool account balance
            account_info = self.client.account_info(pool_address)
            balance = account_info.get("amount", 0)
            min_balance = account_info.get("min-balance", 0)
            available = balance - min_balance

            print(f"Pool Address: {pool_address}")
            print(f"Pool Balance: {balance / 1_000_000:.6f} ALGO")
            print(f"Min Balance: {min_balance / 1_000_000:.6f} ALGO")
            print(f"Available for Trading: {available / 1_000_000:.6f} ALGO")

            # Check pool global state
            app_info = self.client.application_info(app_id)
            if "params" in app_info and "global-state" in app_info["params"]:
                for item in app_info["params"]["global-state"]:
                    key = base64.b64decode(item["key"]).decode("utf-8")
                    if key == "total_liquidity":
                        liquidity = item["value"]["uint"]
                        print(f"Total Liquidity (state): {liquidity / 1_000_000:.6f} ALGO")
                    elif key == "available_liquidity":
                        avail_liq = item["value"]["uint"]
                        print(f"Available Liquidity (state): {avail_liq / 1_000_000:.6f} ALGO")
                    elif key == "lp_token_id":
                        print(f"LP Token ID: {item['value']['uint']}")

            return available
        except Exception as e:
            print(f"Error checking pool: {e}")
            return 0

    def check_user_opt_in(self):
        """Check if user is opted into perps market."""
        app_id = CONTRACTS["perps_market"]
        try:
            account_info = self.client.account_info(self.address)
            apps_local_state = account_info.get("apps-local-state", [])

            for app in apps_local_state:
                if app["id"] == app_id:
                    print(f"User is opted into Perps Market (App {app_id})")
                    return True

            print(f"User is NOT opted into Perps Market (App {app_id})")
            return False
        except Exception as e:
            print(f"Error checking opt-in: {e}")
            return False

    def opt_into_perps_market(self):
        """Opt into the perps market contract."""
        print(f"\n{'=' * 60}")
        print("Opting into Perps Market")
        print(f"{'=' * 60}")

        app_id = CONTRACTS["perps_market"]

        try:
            sp = self.client.suggested_params()

            opt_in_txn = transaction.ApplicationOptInTxn(
                sender=self.address,
                sp=sp,
                index=app_id,
            )

            signed_txn = opt_in_txn.sign(self.private_key)
            txid = self.client.send_transaction(signed_txn)
            print(f"   Opt-in TxID: {txid}")

            self.wait_for_confirmation(txid)
            print(f"   ✓ Opted into Perps Market successfully!")
            return True
        except Exception as e:
            if "already opted in" in str(e).lower() or "has already opted in" in str(e).lower():
                print(f"   Already opted in")
                return True
            print(f"   ✗ Opt-in failed: {e}")
            return False

    def open_position(self, is_long: bool, margin_algo: float, leverage: int):
        """
        Open a perpetual position.

        Args:
            is_long: True for long, False for short
            margin_algo: Margin amount in ALGO
            leverage: Leverage multiplier (1-20)
        """
        position_type = "LONG" if is_long else "SHORT"
        print(f"\n{'=' * 60}")
        print(f"Opening {position_type} Position")
        print(f"{'=' * 60}")
        print(f"Margin: {margin_algo} ALGO")
        print(f"Leverage: {leverage}x")
        print(f"Position Size: {margin_algo * leverage} ALGO")

        perps_market_app = CONTRACTS["perps_market"]
        perps_pool_app = CONTRACTS["perps_pool"]
        oracle_app = CONTRACTS["oracle"]
        staking_app = CONTRACTS["staking"]

        perps_market_addr = get_application_address(perps_market_app)
        perps_pool_addr = get_application_address(perps_pool_app)
        staking_addr = get_application_address(staking_app)

        try:
            # Get next position ID for box reference
            app_info = self.client.application_info(perps_market_app)
            next_position_id = 1
            if "params" in app_info and "global-state" in app_info["params"]:
                for item in app_info["params"]["global-state"]:
                    key = base64.b64decode(item["key"]).decode("utf-8")
                    if key == "next_position_id":
                        next_position_id = item["value"]["uint"]
                        break

            print(f"Next Position ID: {next_position_id}")

            sp = self.client.suggested_params()

            # Calculate amounts
            margin_micro = int(margin_algo * 1_000_000)
            position_size_micro = int(margin_algo * leverage * 1_000_000)
            leverage_scaled = leverage * 100  # Contract uses 100 scale

            # Box MBR for position storage
            # Box: "pos_" (4 bytes) + uint64 (8 bytes) = 12 bytes key
            # Position struct: ~106 bytes value
            # MBR = 2500 + 400 * (12 + 106) = 2500 + 47200 = 49700
            box_mbr = 50_000  # 0.05 ALGO with buffer

            total_payment = margin_micro + box_mbr
            print(f"Total Payment: {total_payment / 1_000_000:.6f} ALGO (margin + box MBR)")

            # Transaction 0: Payment to perps market
            payment_txn = transaction.PaymentTxn(
                sender=self.address,
                sp=sp,
                receiver=perps_market_addr,
                amt=total_payment,
                note=b"perp_margin",
            )

            # Transaction 1: App call to open position
            # Method: open_position(bool,uint64,uint64)uint64
            method_selector = get_method_selector("open_position(bool,uint64,uint64)uint64")

            # ARC4 bool encoding: 0x80 for true, 0x00 for false
            is_long_arg = bytes([0x80 if is_long else 0x00])

            # ARC4 uint64 encoding: 8 bytes big-endian
            size_arg = position_size_micro.to_bytes(8, "big")
            leverage_arg = leverage_scaled.to_bytes(8, "big")

            # Box name: "pos_" + position_id (uint64 big-endian)
            box_name = b"pos_" + next_position_id.to_bytes(8, "big")

            app_call_txn = transaction.ApplicationNoOpTxn(
                sender=self.address,
                sp=sp,
                index=perps_market_app,
                app_args=[method_selector, is_long_arg, size_arg, leverage_arg],
                accounts=[perps_pool_addr, staking_addr],
                foreign_apps=[oracle_app, perps_pool_app, staking_app],
                boxes=[(perps_market_app, box_name)],
                note=b"ChainStrike:OpenPerp",
            )

            # Increase fee for inner transactions
            app_call_txn.fee = 4000

            # Group transactions
            gid = transaction.calculate_group_id([payment_txn, app_call_txn])
            payment_txn.group = gid
            app_call_txn.group = gid

            # Sign
            signed_payment = payment_txn.sign(self.private_key)
            signed_app_call = app_call_txn.sign(self.private_key)

            print(f"\nSending transaction...")
            print(f"   Payment to: {perps_market_addr}")
            print(f"   Amount: {total_payment / 1_000_000:.6f} ALGO")
            print(f"   Method: open_position({is_long}, {position_size_micro}, {leverage_scaled})")

            # Send
            txid = self.client.send_transactions([signed_payment, signed_app_call])
            print(f"   TxID: {txid}")

            result = self.wait_for_confirmation(txid)

            # Parse position ID from logs
            if "logs" in result and result["logs"]:
                for log in result["logs"]:
                    log_bytes = base64.b64decode(log)
                    # ABI return prefix: 0x151f7c75
                    if len(log_bytes) >= 12 and log_bytes[:4] == bytes([0x15, 0x1F, 0x7C, 0x75]):
                        position_id = int.from_bytes(log_bytes[4:12], "big")
                        print(f"   ✓ Position ID: {position_id}")
                        return position_id

            print(f"   ✓ Position opened successfully!")
            return next_position_id

        except Exception as e:
            print(f"   ✗ Failed to open position: {e}")
            import traceback

            traceback.print_exc()
            return None

    def run_tests(self):
        """Run all tests."""
        # Check prerequisites
        self.check_oracle_price()
        self.check_pool_liquidity()
        state = self.check_contract_state()

        # Check if market is paused
        if state.get("is_paused", 0) == 1:
            print("\n❌ ERROR: Perps Market is PAUSED!")
            return

        # Note: ARC4Contract doesn't need opt-in unless using local state
        # The contract uses BoxMap for position storage, not local state
        # So we can skip opt-in and proceed directly to opening positions

        # Test 1: Open LONG position
        print("\n" + "=" * 60)
        print("TEST 1: Opening LONG Position (10 ALGO margin, 5x leverage)")
        print("=" * 60)

        long_position_id = self.open_position(
            is_long=True,
            margin_algo=10.0,
            leverage=5,
        )

        if long_position_id:
            print(f"✓ LONG position opened: ID {long_position_id}")
        else:
            print("✗ LONG position failed")

        # Wait a bit between tests
        time.sleep(2)

        # Test 2: Open SHORT position
        print("\n" + "=" * 60)
        print("TEST 2: Opening SHORT Position (10 ALGO margin, 5x leverage)")
        print("=" * 60)

        short_position_id = self.open_position(
            is_long=False,
            margin_algo=10.0,
            leverage=5,
        )

        if short_position_id:
            print(f"✓ SHORT position opened: ID {short_position_id}")
        else:
            print("✗ SHORT position failed")

        # Summary
        print("\n" + "=" * 60)
        print("TEST SUMMARY")
        print("=" * 60)
        print(f"LONG Position: {'✓ Success' if long_position_id else '✗ Failed'}")
        print(f"SHORT Position: {'✓ Success' if short_position_id else '✗ Failed'}")

        # Check final state
        self.check_contract_state()


if __name__ == "__main__":
    trader = PerpsTrader()
    trader.run_tests()
