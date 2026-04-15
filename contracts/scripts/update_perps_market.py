#!/usr/bin/env python3
"""
Update the perpetuals market contract with the fixed close_position logic.
This script:
1. Updates the perps market contract
2. Sets the perps_pool_app_id via the new admin method
"""

import json
import ssl
from algosdk.v2client import algod
from algosdk import transaction, account, mnemonic
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    AccountTransactionSigner,
)
from algosdk.abi import Method
import base64

# Fix SSL
ssl._create_default_https_context = ssl._create_unverified_context

# Algorand node configuration
ALGOD_ADDRESS = "https://testnet-api.4160.nodely.dev"
ALGOD_TOKEN = ""


def get_algod_client():
    return algod.AlgodClient(ALGOD_TOKEN, ALGOD_ADDRESS)


def load_deployed_addresses():
    """Load deployed contract addresses."""
    try:
        with open("deployed_addresses.json", "r") as f:
            return json.load(f)
    except FileNotFoundError:
        print("Error: deployed_addresses.json not found")
        return None


def load_approval_program():
    """Load compiled approval program."""
    try:
        with open("out/PerpetualsMarket.approval.teal", "r") as f:
            return f.read()
    except FileNotFoundError:
        print("Error: PerpetualsMarket.approval.teal not found")
        print("Please run: algokit compile python perpetuals_market.py")
        return None


def load_clear_program():
    """Load compiled clear program."""
    try:
        with open("out/PerpetualsMarket.clear.teal", "r") as f:
            return f.read()
    except FileNotFoundError:
        print("Error: PerpetualsMarket.clear.teal not found")
        return None


def update_contract(algod_client, app_id: int, sender_address: str, sender_private_key: str):
    """Update the perps market contract."""
    print(f"\n{'=' * 60}")
    print("Updating Perpetuals Market Contract")
    print(f"{'=' * 60}")

    # Load programs
    approval_teal = load_approval_program()
    clear_teal = load_clear_program()

    if not approval_teal or not clear_teal:
        return False

    # Compile programs
    print("Compiling programs...")
    try:
        approval_result = algod_client.compile(approval_teal)
        approval_program = base64.b64decode(approval_result["result"])

        clear_result = algod_client.compile(clear_teal)
        clear_program = base64.b64decode(clear_result["result"])
    except Exception as e:
        print(f"Error compiling programs: {e}")
        return False

    # Create update transaction
    print("Creating update transaction...")
    try:
        params = algod_client.suggested_params()

        update_txn = transaction.ApplicationUpdateTxn(
            sender=sender_address,
            sp=params,
            index=app_id,
            approval_program=approval_program,
            clear_program=clear_program,
        )

        # Sign and send
        signed_txn = update_txn.sign(sender_private_key)
        tx_id = algod_client.send_transaction(signed_txn)

        print(f"Transaction sent: {tx_id}")
        print("Waiting for confirmation...")

        result = transaction.wait_for_confirmation(algod_client, tx_id, 4)
        print(f"✓ Contract updated in round {result['confirmed-round']}")

        return True

    except Exception as e:
        print(f"✗ Error updating contract: {e}")
        import traceback

        traceback.print_exc()
        return False


def set_pool_app_id(algod_client, market_app_id: int, pool_app_id: int, sender_address: str, sender_private_key: str):
    """Set the pool app ID via the new admin method."""
    print(f"\n{'=' * 60}")
    print("Setting Pool App ID")
    print(f"{'=' * 60}")

    try:
        params = algod_client.suggested_params()

        # update_pool_app_id(uint64)bool
        method = Method.from_signature("update_pool_app_id(uint64)bool")

        atc = AtomicTransactionComposer()
        signer = AccountTransactionSigner(sender_private_key)

        atc.add_method_call(
            app_id=market_app_id,
            method=method,
            sender=sender_address,
            sp=params,
            signer=signer,
            method_args=[pool_app_id],
        )

        print(f"Setting pool app ID to: {pool_app_id}")
        result = atc.execute(algod_client, 4)

        print(f"✓ Pool app ID set successfully!")
        print(f"  Tx ID: {result.tx_ids[0]}")

        return True

    except Exception as e:
        print(f"✗ Error setting pool app ID: {e}")
        import traceback

        traceback.print_exc()
        return False


def main():
    """Main update function."""
    print("=" * 60)
    print("Perpetuals Market Contract Update Script")
    print("=" * 60)

    # Load deployed addresses
    deployed = load_deployed_addresses()
    if not deployed:
        return

    contracts = deployed.get("contracts", {})
    market_app_id = contracts.get("perps_market", {}).get("app_id")
    pool_app_id = contracts.get("perps_pool", {}).get("app_id")

    if not market_app_id or not pool_app_id:
        print("Error: Missing contract IDs")
        return

    print(f"\nContract Info:")
    print(f"  Market App ID: {market_app_id}")
    print(f"  Pool App ID: {pool_app_id}")

    # Get admin mnemonic
    print(f"\n{'=' * 60}")
    print("Enter admin wallet mnemonic:")
    print(f"{'=' * 60}")

    mnemonic_phrase = input("Mnemonic: ").strip()
    if not mnemonic_phrase:
        print("No mnemonic provided")
        return

    try:
        sender_private_key = mnemonic.to_private_key(mnemonic_phrase)
        sender_address = account.address_from_private_key(sender_private_key)
        print(f"Admin address: {sender_address}")
    except Exception as e:
        print(f"Invalid mnemonic: {e}")
        return

    algod_client = get_algod_client()

    # Step 1: Update contract
    if not update_contract(algod_client, market_app_id, sender_address, sender_private_key):
        print("\n✗ Contract update failed!")
        return

    # Step 2: Set pool app ID
    if not set_pool_app_id(algod_client, market_app_id, pool_app_id, sender_address, sender_private_key):
        print("\n✗ Failed to set pool app ID!")
        return

    print(f"\n{'=' * 60}")
    print("✓ Update completed successfully!")
    print(f"{'=' * 60}")
    print("\nYou can now test closing positions with:")
    print("  python3 scripts/test_close_position.py")


if __name__ == "__main__":
    main()
