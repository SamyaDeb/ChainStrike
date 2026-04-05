"""
Deploy updated OptionsMarket contract with 1-minute expiry support.

This updates ONLY the OptionsMarket contract with:
- 60 second minimum expiry (down from 300)
- Time-based IV scaling for short-term options
- 1% minimum premium for <5 minute options

Usage:
    python scripts/deploy_updated_options.py
"""

import json
import os
import ssl
import time
from pathlib import Path

from algosdk import account, mnemonic, transaction
from algosdk.v2client import algod

# Fix SSL certificate verification issue on macOS
import urllib.request

ssl_context = ssl._create_unverified_context()
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context)))


# Configuration
TESTNET_ALGOD = "https://testnet-api.algonode.cloud"
DEPLOYER_MNEMONIC = "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss"

# Existing contract addresses
ORACLE_APP_ID = 758189767
OPTIONS_POOL_APP_ID = 758222938

# Contracts directory
CONTRACTS_DIR = Path(__file__).parent.parent


def wait_for_confirmation(client, txid, timeout=20):
    """Wait for transaction confirmation."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            txinfo = client.pending_transaction_info(txid)
            if txinfo.get("confirmed-round", 0) > 0:
                return txinfo
            if txinfo.get("pool-error"):
                raise Exception(f"Transaction error: {txinfo['pool-error']}")
        except Exception as e:
            if "pending" not in str(e).lower():
                pass
        time.sleep(1)
    raise Exception(f"Transaction {txid} not confirmed after {timeout}s")


def deploy_options_market():
    """Deploy the updated OptionsMarket contract."""
    print("=" * 70)
    print("ChainStrike - Deploy Updated Options Market (1-Minute Support)")
    print("=" * 70)

    # Initialize client
    client = algod.AlgodClient("", TESTNET_ALGOD)

    # Get deployer account
    private_key = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
    address = account.address_from_private_key(private_key)

    print(f"\nDeployer Address: {address}")

    # Check balance
    account_info = client.account_info(address)
    balance = account_info.get("amount", 0) / 1_000_000
    print(f"Balance: {balance:.6f} ALGO")

    if balance < 1:
        print("\n⚠️  WARNING: Low balance! Need at least 1 ALGO for deployment.")
        print("   Get TestNet ALGO: https://bank.testnet.algorand.network/")
        return

    # Load compiled contract
    approval_path = CONTRACTS_DIR / "OptionsMarket.approval.teal"
    clear_path = CONTRACTS_DIR / "OptionsMarket.clear.teal"

    if not approval_path.exists() or not clear_path.exists():
        print("\n❌ Contract TEAL files not found!")
        print("   Run: algokit compile py options_market.py")
        return

    approval_teal = approval_path.read_text()
    clear_teal = clear_path.read_text()

    print(f"\nLoaded TEAL programs:")
    print(f"  Approval: {len(approval_teal)} chars")
    print(f"  Clear: {len(clear_teal)} chars")

    # Compile TEAL
    print("\nCompiling TEAL to bytecode...")
    import base64

    approval_result = client.compile(approval_teal)
    clear_result = client.compile(clear_teal)

    approval_bytes = base64.b64decode(approval_result["result"])
    clear_bytes = base64.b64decode(clear_result["result"])

    print(f"  Approval bytecode: {len(approval_bytes)} bytes")
    print(f"  Clear bytecode: {len(clear_bytes)} bytes")

    # Create application
    print("\n🚀 Deploying OptionsMarket contract...")

    sp = client.suggested_params()
    sp.flat_fee = True
    sp.fee = 2000  # 0.002 ALGO

    # Global state schema
    global_schema = transaction.StateSchema(
        num_uints=20,  # All uint state variables (17 needed based on error)
        num_byte_slices=4,  # admin, oracle, options_pool, staking_contract
    )

    # Local state schema (if needed)
    local_schema = transaction.StateSchema(num_uints=0, num_byte_slices=0)

    txn = transaction.ApplicationCreateTxn(
        sender=address,
        sp=sp,
        on_complete=transaction.OnComplete.NoOpOC,
        approval_program=approval_bytes,
        clear_program=clear_bytes,
        global_schema=global_schema,
        local_schema=local_schema,
        extra_pages=3,  # Options market needs extra pages
    )

    signed_txn = txn.sign(private_key)
    txid = client.send_transaction(signed_txn)

    print(f"  Transaction ID: {txid}")
    print(f"  Waiting for confirmation...")

    result = wait_for_confirmation(client, txid)
    app_id = result.get("application-index")

    print(f"\n✅ OptionsMarket deployed successfully!")
    print(f"   App ID: {app_id}")
    print(f"   Address: {account.address_from_private_key(private_key)}")

    # Initialize the contract
    print(f"\n📝 Initializing OptionsMarket...")

    # Call initialize(oracle_app_id, pool_app_id)
    from algosdk.atomic_transaction_composer import (
        AtomicTransactionComposer,
        AccountTransactionSigner,
        TransactionWithSigner,
    )
    from algosdk.abi import Contract

    # Load ABI
    arc56_path = CONTRACTS_DIR / "OptionsMarket.arc56.json"
    arc56 = json.loads(arc56_path.read_text())

    # Find initialize method
    init_method = None
    for method in arc56.get("methods", []):
        if method["name"] == "initialize":
            init_method = method
            break

    if not init_method:
        print("⚠️  Could not find initialize method in ABI")
        print(f"   You'll need to manually initialize with:")
        print(f"   - Oracle App ID: {ORACLE_APP_ID}")
        print(f"   - Pool App ID: {OPTIONS_POOL_APP_ID}")
        return

    print(f"   Calling initialize({ORACLE_APP_ID}, {OPTIONS_POOL_APP_ID})...")

    # Build initialize transaction manually
    sp = client.suggested_params()
    sp.flat_fee = True
    sp.fee = 2000

    # Method selector for initialize(application,application)void
    # This is a simplified approach - encode as app call with foreign apps
    txn = transaction.ApplicationNoOpTxn(
        sender=address,
        sp=sp,
        index=app_id,
        app_args=[b"initialize", ORACLE_APP_ID.to_bytes(8, "big"), OPTIONS_POOL_APP_ID.to_bytes(8, "big")],
        foreign_apps=[ORACLE_APP_ID, OPTIONS_POOL_APP_ID],
    )

    signed_txn = txn.sign(private_key)
    txid = client.send_transaction(signed_txn)

    print(f"   Transaction ID: {txid}")
    result = wait_for_confirmation(client, txid)

    print(f"\n✅ OptionsMarket initialized!")

    # Update deployed addresses file
    deployed_path = CONTRACTS_DIR / "deployed_addresses.json"
    if deployed_path.exists():
        deployed = json.loads(deployed_path.read_text())
    else:
        deployed = {"contracts": {}, "assets": {}}

    deployed["contracts"]["options_market_updated"] = app_id
    deployed_path.write_text(json.dumps(deployed, indent=2))

    print(f"\n📝 Updated deployed_addresses.json")
    print(f"\n{'=' * 70}")
    print("NEXT STEPS:")
    print("=" * 70)
    print(f"1. Update frontend config with new app ID: {app_id}")
    print(f"2. Run expiry limit update:")
    print(f"   python scripts/update_expiry_limits.py")
    print(f"3. Test 1-minute options trading!")
    print("=" * 70)


if __name__ == "__main__":
    deploy_options_market()
