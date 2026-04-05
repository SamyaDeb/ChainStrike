#!/usr/bin/env python3
"""
ChainStrike Contract Testing Script
Tests all deployed contracts on Algorand TestNet
"""

import ssl
import json
import time
import base64
from pathlib import Path

# Disable SSL verification for macOS Python 3.13
ssl._create_default_https_context = ssl._create_unverified_context

from algosdk import account, mnemonic, transaction
from algosdk.v2client import algod, indexer
from algosdk.transaction import ApplicationNoOpTxn, PaymentTxn
from algosdk import encoding

# Configuration
ALGOD_ADDRESS = "https://testnet-api.4160.nodely.dev"
ALGOD_TOKEN = ""
INDEXER_ADDRESS = "https://testnet-idx.4160.nodely.dev"
INDEXER_TOKEN = ""

# Deployer mnemonic
DEPLOYER_MNEMONIC = "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss"

# Load deployed addresses
DEPLOYED_PATH = Path(__file__).parent.parent / "deployed_addresses.json"
with open(DEPLOYED_PATH) as f:
    DEPLOYED = json.load(f)

CONTRACTS = DEPLOYED["contracts"]


def get_algod_client():
    """Get Algod client with SSL bypass"""
    return algod.AlgodClient(ALGOD_TOKEN, ALGOD_ADDRESS)


def get_indexer_client():
    """Get Indexer client"""
    return indexer.IndexerClient(INDEXER_TOKEN, INDEXER_ADDRESS)


def get_deployer():
    """Get deployer account"""
    private_key = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
    address = account.address_from_private_key(private_key)
    return private_key, address


def wait_for_confirmation(client, txid, timeout=10):
    """Wait for transaction confirmation"""
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            txinfo = client.pending_transaction_info(txid)
            if txinfo.get("confirmed-round", 0) > 0:
                return txinfo
            if txinfo.get("pool-error", ""):
                raise Exception(f"Transaction failed: {txinfo['pool-error']}")
        except Exception as e:
            if "pending" not in str(e).lower():
                pass
        time.sleep(0.5)
    raise Exception(f"Transaction {txid} timed out")


def read_global_state(client, app_id):
    """Read global state from an application"""
    try:
        app_info = client.application_info(app_id)
        global_state = {}

        for item in app_info.get("params", {}).get("global-state", []):
            key = base64.b64decode(item["key"]).decode("utf-8", errors="ignore")
            value = item["value"]

            if value["type"] == 1:  # bytes
                try:
                    global_state[key] = base64.b64decode(value["bytes"]).decode("utf-8", errors="ignore")
                except:
                    global_state[key] = value["bytes"]
            else:  # uint
                global_state[key] = value["uint"]

        return global_state
    except Exception as e:
        print(f"Error reading state for app {app_id}: {e}")
        return {}


def test_oracle():
    """Test the Oracle contract"""
    print("\n" + "=" * 60)
    print("Testing Oracle Contract")
    print("=" * 60)

    client = get_algod_client()
    private_key, address = get_deployer()
    app_id = CONTRACTS["oracle"]

    print(f"Oracle App ID: {app_id}")

    # Read current state
    state = read_global_state(client, app_id)
    print(f"Current Oracle State: {state}")

    # Try to update price (call update_price method)
    try:
        params = client.suggested_params()

        # Method selector for update_price
        method = "update_price"
        # Price in microALGO (e.g., $0.25 = 250000 micro)
        price = 250000  # 0.25 USD

        txn = ApplicationNoOpTxn(
            sender=address, sp=params, index=app_id, app_args=[method.encode(), price.to_bytes(8, "big")]
        )

        signed_txn = txn.sign(private_key)
        txid = client.send_transaction(signed_txn)
        print(f"Updating price... TX: {txid}")

        result = wait_for_confirmation(client, txid)
        print(f"✅ Oracle price updated successfully!")

        # Read updated state
        state = read_global_state(client, app_id)
        print(f"Updated Oracle State: {state}")

    except Exception as e:
        print(f"⚠️ Oracle update failed (may require specific caller): {e}")

    return True


def test_options_pool():
    """Test the Options Pool contract"""
    print("\n" + "=" * 60)
    print("Testing Options Pool Contract")
    print("=" * 60)

    client = get_algod_client()
    private_key, address = get_deployer()
    app_id = CONTRACTS["options_pool"]
    app_address = encoding.encode_address(encoding.checksum(b"appID" + app_id.to_bytes(8, "big")))

    print(f"Options Pool App ID: {app_id}")
    print(f"Options Pool Address: {app_address}")

    # Read current state
    state = read_global_state(client, app_id)
    print(f"Current Pool State: {state}")

    # Check account balance
    account_info = client.account_info(address)
    balance = account_info.get("amount", 0)
    min_balance = account_info.get("min-balance", 0)
    available = balance - min_balance

    print(f"Available balance: {available / 1_000_000:.6f} ALGO")

    # Try to deposit (minimum 1 ALGO)
    deposit_amount = 1_000_000  # 1 ALGO in microALGO

    if available < deposit_amount + 100_000:  # Need extra for fees
        print(f"⚠️ Not enough balance for deposit. Need at least 1.1 ALGO available.")
        return False

    try:
        params = client.suggested_params()

        # First opt-in to the application
        print("Opting in to Options Pool...")
        opt_in_txn = transaction.ApplicationOptInTxn(sender=address, sp=params, index=app_id)
        signed_opt_in = opt_in_txn.sign(private_key)

        try:
            txid = client.send_transaction(signed_opt_in)
            wait_for_confirmation(client, txid)
            print(f"✅ Opted in successfully!")
        except Exception as e:
            if "already opted in" in str(e).lower() or "has already" in str(e).lower():
                print("Already opted in, continuing...")
            else:
                print(f"Opt-in note: {e}")

        # Now deposit
        print(f"Depositing {deposit_amount / 1_000_000} ALGO to Options Pool...")

        # Create grouped transaction: Payment + App Call
        params = client.suggested_params()

        # Payment to pool
        payment_txn = PaymentTxn(sender=address, sp=params, receiver=app_address, amt=deposit_amount)

        # App call for deposit
        app_txn = ApplicationNoOpTxn(sender=address, sp=params, index=app_id, app_args=["deposit".encode()])

        # Group transactions
        gid = transaction.calculate_group_id([payment_txn, app_txn])
        payment_txn.group = gid
        app_txn.group = gid

        signed_payment = payment_txn.sign(private_key)
        signed_app = app_txn.sign(private_key)

        txid = client.send_transactions([signed_payment, signed_app])
        print(f"Deposit TX: {txid}")

        result = wait_for_confirmation(client, txid)
        print(f"✅ Deposit successful!")

        # Read updated state
        state = read_global_state(client, app_id)
        print(f"Updated Pool State: {state}")

    except Exception as e:
        print(f"⚠️ Options Pool deposit failed: {e}")
        return False

    return True


def test_perps_pool():
    """Test the Perps Pool contract"""
    print("\n" + "=" * 60)
    print("Testing Perps Pool Contract")
    print("=" * 60)

    client = get_algod_client()
    private_key, address = get_deployer()
    app_id = CONTRACTS["perps_pool"]
    app_address = encoding.encode_address(encoding.checksum(b"appID" + app_id.to_bytes(8, "big")))

    print(f"Perps Pool App ID: {app_id}")
    print(f"Perps Pool Address: {app_address}")

    # Read current state
    state = read_global_state(client, app_id)
    print(f"Current Pool State: {state}")

    return True


def test_staking():
    """Test the Staking contract"""
    print("\n" + "=" * 60)
    print("Testing Staking Contract")
    print("=" * 60)

    client = get_algod_client()
    app_id = CONTRACTS["staking"]

    print(f"Staking App ID: {app_id}")

    # Read current state
    state = read_global_state(client, app_id)
    print(f"Current Staking State: {state}")

    return True


def test_options_market():
    """Test the Options Market contract"""
    print("\n" + "=" * 60)
    print("Testing Options Market Contract")
    print("=" * 60)

    client = get_algod_client()
    app_id = CONTRACTS["options_market"]

    print(f"Options Market App ID: {app_id}")

    # Read current state
    state = read_global_state(client, app_id)
    print(f"Current Options Market State: {state}")

    return True


def test_perps_market():
    """Test the Perps Market contract"""
    print("\n" + "=" * 60)
    print("Testing Perps Market Contract")
    print("=" * 60)

    client = get_algod_client()
    app_id = CONTRACTS["perps_market"]

    print(f"Perps Market App ID: {app_id}")

    # Read current state
    state = read_global_state(client, app_id)
    print(f"Current Perps Market State: {state}")

    return True


def check_all_contracts():
    """Verify all contracts are deployed and readable"""
    print("\n" + "=" * 60)
    print("Checking All Deployed Contracts")
    print("=" * 60)

    client = get_algod_client()

    results = {}
    for name, app_id in CONTRACTS.items():
        try:
            app_info = client.application_info(app_id)
            results[name] = {"app_id": app_id, "status": "✅ Active", "creator": app_info["params"]["creator"]}
            print(f"✅ {name}: App ID {app_id} - Active")
        except Exception as e:
            results[name] = {"app_id": app_id, "status": "❌ Error", "error": str(e)}
            print(f"❌ {name}: App ID {app_id} - Error: {e}")

    return results


def main():
    """Run all tests"""
    print("\n" + "=" * 60)
    print("ChainStrike Contract Testing Suite")
    print("Network: Algorand TestNet")
    print("=" * 60)

    # Check deployer balance
    private_key, address = get_deployer()
    client = get_algod_client()

    account_info = client.account_info(address)
    balance = account_info.get("amount", 0) / 1_000_000
    print(f"\nDeployer: {address}")
    print(f"Balance: {balance:.6f} ALGO")

    # Run tests
    print("\n" + "=" * 60)
    print("Running Contract Tests")
    print("=" * 60)

    # Check all contracts exist
    check_all_contracts()

    # Test individual contracts
    test_oracle()
    test_staking()
    test_options_market()
    test_perps_market()

    # Test pools (requires balance)
    if balance > 2:
        test_options_pool()
        test_perps_pool()
    else:
        print("\n⚠️ Skipping pool tests - insufficient balance")
        print("Please fund the deployer account with TestNet ALGO from:")
        print("https://bank.testnet.algorand.network/")

    print("\n" + "=" * 60)
    print("Testing Complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
