"""
Update Oracle Price Script

Sets the oracle price for ALGO/USD so perpetuals trading can work.
The oracle requires 3 price sources (Binance, CoinGecko, Vestige).
"""

import json
import os
import ssl
import time
from pathlib import Path

from algosdk import account, mnemonic, transaction
from algosdk.v2client import algod
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    AccountTransactionSigner,
)
from algosdk import abi

# Fix SSL
import urllib.request

ssl_context = ssl._create_unverified_context()
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context)))

# ====== CONFIG ======
TESTNET_ALGOD = "https://testnet-api.algonode.cloud"
DEPLOYER_MNEMONIC = os.getenv(
    "DEPLOYER_MNEMONIC",
    "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss",
)

# Contract IDs from deployment
ORACLE_APP_ID = 758290477

# Current ALGO price in microUSD (6 decimals)
# $0.25 = 250000 microUSD
ALGO_PRICE_MICRO_USD = 250000

BUILD_DIR = Path(__file__).parent.parent / ".build"


def build_contract_from_arc56(arc56: dict, name: str) -> abi.Contract:
    """Build ABI Contract from ARC56 JSON."""
    methods = []
    for m in arc56.get("methods", []):
        args = [abi.Argument(a["type"], a.get("name", "")) for a in m.get("args", [])]
        returns = abi.Returns(m["returns"]["type"]) if m.get("returns") else abi.Returns("void")
        methods.append(abi.Method(m["name"], args, returns, m.get("desc", "")))
    return abi.Contract(name, methods)


def main():
    print("=" * 60)
    print("ChainStrike Oracle Price Update")
    print("=" * 60)

    # Initialize client
    client = algod.AlgodClient("", TESTNET_ALGOD)
    pk = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
    addr = account.address_from_private_key(pk)
    signer = AccountTransactionSigner(pk)

    print(f"Updater: {addr}")

    # Check current oracle state
    app_info = client.application_info(ORACLE_APP_ID)
    global_state = app_info.get("params", {}).get("global-state", [])

    current_price = 0
    for item in global_state:
        import base64

        key = base64.b64decode(item["key"]).decode("utf-8", errors="replace")
        if key == "current_price":
            current_price = item["value"].get("uint", 0)
            break

    print(f"Current oracle price: {current_price} microUSD (${current_price / 1_000_000:.4f})")
    print(f"Target price: {ALGO_PRICE_MICRO_USD} microUSD (${ALGO_PRICE_MICRO_USD / 1_000_000:.4f})")

    # Load oracle ABI
    arc56_path = BUILD_DIR / "oracle" / "Oracle.arc56.json"
    if not arc56_path.exists():
        print(f"ERROR: ARC56 file not found at {arc56_path}")
        print("Please compile contracts first: puyapy oracle.py --output-teal --out-dir .build/oracle")
        return

    arc56 = json.loads(arc56_path.read_text())
    contract = build_contract_from_arc56(arc56, "Oracle")

    # Get suggested params
    sp = client.suggested_params()
    sp.flat_fee = True
    sp.fee = 2000

    # Call update_price with 3 sources (all same price for simplicity)
    # Method: update_price(uint64,uint64,uint64)(uint64,uint64,uint64,uint64)
    print(f"\nUpdating oracle price to ${ALGO_PRICE_MICRO_USD / 1_000_000:.4f}...")

    try:
        atc = AtomicTransactionComposer()
        atc.add_method_call(
            app_id=ORACLE_APP_ID,
            method=contract.get_method_by_name("update_price"),
            sender=addr,
            sp=sp,
            signer=signer,
            method_args=[
                ALGO_PRICE_MICRO_USD,  # binance_price
                ALGO_PRICE_MICRO_USD,  # coingecko_price
                ALGO_PRICE_MICRO_USD,  # vestige_price
            ],
        )
        result = atc.execute(client, 10)

        print(f"Transaction confirmed!")
        if result.abi_results:
            ret = result.abi_results[0].return_value
            print(f"Return value: {ret}")

        # Verify update
        time.sleep(1)
        app_info = client.application_info(ORACLE_APP_ID)
        global_state = app_info.get("params", {}).get("global-state", [])

        for item in global_state:
            import base64

            key = base64.b64decode(item["key"]).decode("utf-8", errors="replace")
            if key == "current_price":
                new_price = item["value"].get("uint", 0)
                print(f"\nNew oracle price: {new_price} microUSD (${new_price / 1_000_000:.4f})")
                break

        print("\n" + "=" * 60)
        print("Oracle updated successfully!")
        print("=" * 60)

    except Exception as e:
        print(f"ERROR updating oracle: {e}")
        raise


if __name__ == "__main__":
    main()
