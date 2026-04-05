#!/usr/bin/env python3
"""
Fund the Options Pool with ALGO using the deployer wallet.
This script tests the deposit flow that the frontend uses.
"""

import os
import sys
import ssl
import certifi
from pathlib import Path
from algosdk import transaction, encoding
from algosdk.v2client import algod
from algosdk.account import address_from_private_key

# Fix SSL certificate issue on macOS
ssl._create_default_https_context = ssl.create_default_context
ssl._create_default_https_context = lambda: ssl.create_default_context(cafile=certifi.where())

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Configuration
ALGOD_ADDRESS = "https://testnet-api.4160.nodely.dev"
ALGOD_TOKEN = ""

# Deployed contract addresses (from deployment)
OPTIONS_POOL_APP_ID = 758189781
OPTIONS_LP_TOKEN_ID = 758190772
PERPS_POOL_APP_ID = 758190050
PERPS_LP_TOKEN_ID = 758190786
STAKING_APP_ID = 758189780


def get_algod_client():
    """Get algod client for TestNet."""
    return algod.AlgodClient(ALGOD_TOKEN, ALGOD_ADDRESS)


def get_app_address(app_id: int) -> str:
    """Get the address for an application."""
    return encoding.encode_address(encoding.checksum(b"appID" + app_id.to_bytes(8, "big")))


def fund_options_pool(algod_client, sender_address: str, sender_key: str, amount_algo: float):
    """Fund the Options Pool with ALGO."""
    print(f"\n{'=' * 60}")
    print(f"Funding Options Pool with {amount_algo} ALGO")
    print(f"{'=' * 60}")

    pool_address = get_app_address(OPTIONS_POOL_APP_ID)
    print(f"Pool App ID: {OPTIONS_POOL_APP_ID}")
    print(f"Pool Address: {pool_address}")
    print(f"LP Token ID: {OPTIONS_LP_TOKEN_ID}")
    print(f"Sender: {sender_address}")

    # Get suggested params
    sp = algod_client.suggested_params()

    # Check if sender is opted into LP token
    account_info = algod_client.account_info(sender_address)
    opted_in = any(asset.get("asset-id") == OPTIONS_LP_TOKEN_ID for asset in account_info.get("assets", []))
    print(f"Opted into LP token: {opted_in}")

    txns = []

    # 1. Opt-in to LP token if not already
    if not opted_in:
        print("Adding LP token opt-in transaction...")
        opt_in_txn = transaction.AssetTransferTxn(
            sender=sender_address, sp=sp, receiver=sender_address, amt=0, index=OPTIONS_LP_TOKEN_ID
        )
        txns.append(opt_in_txn)

    # 2. Payment to pool
    amount_microalgos = int(amount_algo * 1_000_000)
    print(f"Payment amount: {amount_microalgos} microALGO")

    payment_txn = transaction.PaymentTxn(
        sender=sender_address, sp=sp, receiver=pool_address, amt=amount_microalgos, note=b"pool_deposit"
    )
    txns.append(payment_txn)

    # 3. App call with ABI method selector and box reference
    # Method selector for "deposit()uint64" is 0xb8843568
    method_selector = bytes([0xB8, 0x84, 0x35, 0x68])

    # Box name: "olp_" + sender_address_bytes
    sender_bytes = encoding.decode_address(sender_address)
    box_name = b"olp_" + sender_bytes

    # Get staking contract address for fee transfer
    staking_address = get_app_address(STAKING_APP_ID)
    print(f"Staking address (for fees): {staking_address}")

    app_call_txn = transaction.ApplicationNoOpTxn(
        sender=sender_address,
        sp=sp,
        index=OPTIONS_POOL_APP_ID,
        app_args=[method_selector],
        accounts=[staking_address],  # Staking contract receives fees
        foreign_assets=[OPTIONS_LP_TOKEN_ID],
        boxes=[(OPTIONS_POOL_APP_ID, box_name)],
        note=b"ChainStrike:Deposit",
    )
    txns.append(app_call_txn)

    # Group transactions
    print(f"Transaction group size: {len(txns)}")
    if len(txns) > 1:
        gid = transaction.calculate_group_id(txns)
        for txn in txns:
            txn.group = gid

    # Sign transactions
    print("Signing transactions...")
    signed_txns = [txn.sign(sender_key) for txn in txns]

    # Submit transactions
    print("Submitting transaction group...")
    try:
        txid = algod_client.send_transactions(signed_txns)
        print(f"Transaction ID: {txid}")

        # Wait for confirmation
        print("Waiting for confirmation...")
        result = transaction.wait_for_confirmation(algod_client, txid, 4)
        print(f"Confirmed in round: {result.get('confirmed-round')}")

        # Check LP token balance
        account_info = algod_client.account_info(sender_address)
        for asset in account_info.get("assets", []):
            if asset.get("asset-id") == OPTIONS_LP_TOKEN_ID:
                lp_balance = asset.get("amount", 0)
                print(f"LP Token Balance: {lp_balance / 1_000_000} csOPT")
                break

        # Check pool state
        app_info = algod_client.application_info(OPTIONS_POOL_APP_ID)
        global_state = app_info["params"].get("global-state", [])
        for item in global_state:
            import base64

            key = base64.b64decode(item["key"]).decode("utf-8", errors="replace")
            if key in ["total_liquidity", "total_shares", "lp_count"]:
                value = item["value"].get("uint", 0)
                print(f"Pool {key}: {value}")

        print(f"\n✅ Successfully deposited {amount_algo} ALGO to Options Pool!")
        return True

    except Exception as e:
        print(f"\n❌ Transaction failed: {e}")
        return False


def fund_perps_pool(algod_client, sender_address: str, sender_key: str, amount_algo: float):
    """Fund the Perpetuals Pool with ALGO."""
    print(f"\n{'=' * 60}")
    print(f"Funding Perpetuals Pool with {amount_algo} ALGO")
    print(f"{'=' * 60}")

    pool_address = get_app_address(PERPS_POOL_APP_ID)
    print(f"Pool App ID: {PERPS_POOL_APP_ID}")
    print(f"Pool Address: {pool_address}")
    print(f"LP Token ID: {PERPS_LP_TOKEN_ID}")
    print(f"Sender: {sender_address}")

    # Get suggested params
    sp = algod_client.suggested_params()

    # Check if sender is opted into LP token
    account_info = algod_client.account_info(sender_address)
    opted_in = any(asset.get("asset-id") == PERPS_LP_TOKEN_ID for asset in account_info.get("assets", []))
    print(f"Opted into LP token: {opted_in}")

    txns = []

    # 1. Opt-in to LP token if not already
    if not opted_in:
        print("Adding LP token opt-in transaction...")
        opt_in_txn = transaction.AssetTransferTxn(
            sender=sender_address, sp=sp, receiver=sender_address, amt=0, index=PERPS_LP_TOKEN_ID
        )
        txns.append(opt_in_txn)

    # 2. Payment to pool
    amount_microalgos = int(amount_algo * 1_000_000)
    print(f"Payment amount: {amount_microalgos} microALGO")

    payment_txn = transaction.PaymentTxn(
        sender=sender_address, sp=sp, receiver=pool_address, amt=amount_microalgos, note=b"pool_deposit"
    )
    txns.append(payment_txn)

    # 3. App call with ABI method selector and box reference
    # Method selector for "deposit()uint64" is 0xb8843568
    method_selector = bytes([0xB8, 0x84, 0x35, 0x68])

    # Box name: "plp_" + sender_address_bytes (perps uses "plp_" prefix)
    sender_bytes = encoding.decode_address(sender_address)
    box_name = b"plp_" + sender_bytes

    # Get staking contract address for fee transfer
    staking_address = get_app_address(STAKING_APP_ID)
    print(f"Staking address (for fees): {staking_address}")

    app_call_txn = transaction.ApplicationNoOpTxn(
        sender=sender_address,
        sp=sp,
        index=PERPS_POOL_APP_ID,
        app_args=[method_selector],
        accounts=[staking_address],  # Staking contract receives fees
        foreign_assets=[PERPS_LP_TOKEN_ID],
        boxes=[(PERPS_POOL_APP_ID, box_name)],
        note=b"ChainStrike:Deposit",
    )
    txns.append(app_call_txn)

    # Group transactions
    print(f"Transaction group size: {len(txns)}")
    if len(txns) > 1:
        gid = transaction.calculate_group_id(txns)
        for txn in txns:
            txn.group = gid

    # Sign transactions
    print("Signing transactions...")
    signed_txns = [txn.sign(sender_key) for txn in txns]

    # Submit transactions
    print("Submitting transaction group...")
    try:
        txid = algod_client.send_transactions(signed_txns)
        print(f"Transaction ID: {txid}")

        # Wait for confirmation
        print("Waiting for confirmation...")
        result = transaction.wait_for_confirmation(algod_client, txid, 4)
        print(f"Confirmed in round: {result.get('confirmed-round')}")

        # Check LP token balance
        account_info = algod_client.account_info(sender_address)
        for asset in account_info.get("assets", []):
            if asset.get("asset-id") == PERPS_LP_TOKEN_ID:
                lp_balance = asset.get("amount", 0)
                print(f"LP Token Balance: {lp_balance / 1_000_000} csPERP")
                break

        # Check pool state
        app_info = algod_client.application_info(PERPS_POOL_APP_ID)
        global_state = app_info["params"].get("global-state", [])
        for item in global_state:
            import base64

            key = base64.b64decode(item["key"]).decode("utf-8", errors="replace")
            if key in ["total_liquidity", "total_shares", "lp_count"]:
                value = item["value"].get("uint", 0)
                print(f"Pool {key}: {value}")

        print(f"\n✅ Successfully deposited {amount_algo} ALGO to Perpetuals Pool!")
        return True

    except Exception as e:
        print(f"\n❌ Transaction failed: {e}")
        return False


def main():
    """Main function to fund pools."""
    # Get mnemonic from environment
    mnemonic = os.getenv("DEPLOYER_MNEMONIC")
    if not mnemonic:
        print("Error: DEPLOYER_MNEMONIC environment variable not set")
        print("Please set it with: export DEPLOYER_MNEMONIC='your 25 word mnemonic'")
        sys.exit(1)

    # Convert mnemonic to private key
    from algosdk import mnemonic as mn

    private_key = mn.to_private_key(mnemonic)
    sender_address = address_from_private_key(private_key)

    print(f"Deployer Address: {sender_address}")

    # Get algod client
    algod_client = get_algod_client()

    # Check account balance
    account_info = algod_client.account_info(sender_address)
    balance = account_info.get("amount", 0)
    print(f"Account Balance: {balance / 1_000_000} ALGO")

    if balance < 5_000_000:  # Less than 5 ALGO
        print("Warning: Low balance. You need at least 5 ALGO to fund pools.")

    # Fund both pools with enough ALGO (min is 10 ALGO for perps, 1 ALGO for options)
    options_deposit = 2.0  # ALGO - min is 1 ALGO
    perps_deposit = 11.0  # ALGO - min is 10 ALGO

    success_options = fund_options_pool(algod_client, sender_address, private_key, options_deposit)
    success_perps = fund_perps_pool(algod_client, sender_address, private_key, perps_deposit)

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Options Pool: {'✅ Success' if success_options else '❌ Failed'}")
    print(f"Perps Pool: {'✅ Success' if success_perps else '❌ Failed'}")

    if success_options and success_perps:
        print("\n🎉 Both pools funded successfully!")
        print("You can now test the frontend at http://localhost:3000/pool")


if __name__ == "__main__":
    main()
