"""
Initialize the deployed OptionsMarket contract.

Usage:
    python scripts/initialize_options_market.py
"""

import os
import ssl
import time
from algosdk import account, mnemonic, abi
from algosdk.v2client import algod
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    AccountTransactionSigner,
)
import json
from pathlib import Path

# Fix SSL certificate verification issue on macOS
import urllib.request

ssl_context = ssl._create_unverified_context()
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context)))

# Config
TESTNET_ALGOD = "https://testnet-api.algonode.cloud"
DEPLOYER_MNEMONIC = "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss"

OPTIONS_MARKET_APP_ID = 758254794
ORACLE_APP_ID = 758189767
OPTIONS_POOL_APP_ID = 758222938
STAKING_APP_ID = 758189780

CONTRACTS_DIR = Path(__file__).parent.parent


def initialize():
    client = algod.AlgodClient("", TESTNET_ALGOD)
    private_key = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
    address = account.address_from_private_key(private_key)
    signer = AccountTransactionSigner(private_key)

    print("=" * 70)
    print("Initialize OptionsMarket")
    print("=" * 70)
    print(f"App ID: {OPTIONS_MARKET_APP_ID}")
    print(f"Oracle: {ORACLE_APP_ID}")
    print(f"Pool: {OPTIONS_POOL_APP_ID}")
    print(f"Staking: {STAKING_APP_ID}")
    print("=" * 70)

    # Get contract addresses
    from algosdk import encoding

    oracle_addr = encoding.encode_address(encoding.checksum(b"appID" + ORACLE_APP_ID.to_bytes(8, "big")))
    pool_addr = encoding.encode_address(encoding.checksum(b"appID" + OPTIONS_POOL_APP_ID.to_bytes(8, "big")))
    staking_addr = encoding.encode_address(encoding.checksum(b"appID" + STAKING_APP_ID.to_bytes(8, "big")))

    # Load ABI
    arc56_path = CONTRACTS_DIR / "OptionsMarket.arc56.json"
    arc56_data = json.loads(arc56_path.read_text())

    # Create Contract object
    methods = []
    for m in arc56_data.get("methods", []):
        args = [abi.Argument(a["type"], a.get("name", "")) for a in m.get("args", [])]
        returns = abi.Returns(m.get("returns", {}).get("type", "void"))
        methods.append(abi.Method(m["name"], args, returns, m.get("desc", "")))

    contract = abi.Contract("OptionsMarket", methods)

    # Get initialize method
    init_method = contract.get_method_by_name("initialize")

    # Build transaction
    sp = client.suggested_params()
    sp.flat_fee = True
    sp.fee = 2000

    atc = AtomicTransactionComposer()
    atc.add_method_call(
        app_id=OPTIONS_MARKET_APP_ID,
        method=init_method,
        sender=address,
        sp=sp,
        signer=signer,
        method_args=[oracle_addr, pool_addr, staking_addr, ORACLE_APP_ID, OPTIONS_POOL_APP_ID],
        foreign_apps=[ORACLE_APP_ID, OPTIONS_POOL_APP_ID, STAKING_APP_ID],
    )

    # Execute
    try:
        result = atc.execute(client, 10)
        print(f"\n✅ OptionsMarket initialized!")
        print(f"   Transaction ID: {result.tx_ids[0]}")
    except Exception as e:
        print(f"\n❌ Initialization failed: {e}")
        raise


if __name__ == "__main__":
    initialize()
