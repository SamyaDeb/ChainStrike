"""
Check ChainStrike contract state on TestNet
"""

import json
import ssl
import urllib.request
from pathlib import Path
from algosdk.v2client import algod, indexer

# Fix SSL certificate verification
ssl._create_default_https_context = ssl._create_unverified_context

# Configuration
TESTNET_ALGOD = "https://testnet-api.algonode.cloud"
TESTNET_INDEXER = "https://testnet-idx.algonode.cloud"

# Contract App IDs from deployed contracts
CONTRACTS = {
    "oracle": 758189767,
    "strikeToken": 758189778,
    "staking": 758189780,
    "optionsPool": 758189781,
    "optionsMarket": 758189793,
    "perpsPool": 758190050,
    "perpsMarket": 758190064,
}


def get_app_global_state(client: algod.AlgodClient, app_id: int) -> dict:
    """Get global state of an application"""
    try:
        app_info = client.application_info(app_id)
        global_state = {}

        if "params" in app_info and "global-state" in app_info["params"]:
            for item in app_info["params"]["global-state"]:
                # Key is base64 encoded
                import base64

                key_bytes = base64.b64decode(item["key"])
                try:
                    key = key_bytes.decode("utf-8", errors="replace")
                except:
                    key = key_bytes.hex()

                value = item["value"]

                if value["type"] == 1:  # bytes
                    try:
                        val_bytes = base64.b64decode(value["bytes"])
                        # Try to decode as address (32 bytes)
                        if len(val_bytes) == 32:
                            from algosdk import encoding

                            try:
                                global_state[key] = encoding.encode_address(val_bytes)
                            except:
                                global_state[key] = val_bytes.hex()
                        else:
                            global_state[key] = val_bytes.hex()
                    except:
                        global_state[key] = value["bytes"]
                else:  # uint
                    global_state[key] = value["uint"]

        return global_state
    except Exception as e:
        return {"error": str(e)}


def check_contracts():
    """Check all contract states"""
    client = algod.AlgodClient("", TESTNET_ALGOD)

    print("=" * 70)
    print("ChainStrike Contract State Check")
    print("=" * 70)

    for name, app_id in CONTRACTS.items():
        print(f"\n{'=' * 70}")
        print(f"{name.upper()} (App ID: {app_id})")
        print("-" * 70)

        state = get_app_global_state(client, app_id)

        if "error" in state:
            print(f"  ERROR: {state['error']}")
        else:
            for key, value in sorted(state.items()):
                if isinstance(value, int):
                    # Format large numbers
                    if value > 1_000_000_000_000:
                        print(f"  {key}: {value:,} (timestamp or large value)")
                    elif value > 1_000_000:
                        print(f"  {key}: {value:,} ({value / 1_000_000:.6f} ALGO/USD)")
                    else:
                        print(f"  {key}: {value}")
                else:
                    print(f"  {key}: {value}")

    print("\n" + "=" * 70)
    print("Key Values to Check:")
    print("-" * 70)

    # Get specific important values
    oracle_state = get_app_global_state(client, CONTRACTS["oracle"])
    options_state = get_app_global_state(client, CONTRACTS["optionsMarket"])

    if "current_price" in oracle_state:
        price = oracle_state["current_price"]
        print(f"  Oracle Price: ${price / 1_000_000:.6f} per ALGO")
    else:
        print("  Oracle Price: NOT SET (contract may not be initialized)")

    if "min_expiry" in options_state:
        min_exp = options_state["min_expiry"]
        print(f"  Options Min Expiry: {min_exp} seconds ({min_exp / 60:.1f} minutes)")
    else:
        print("  Options Min Expiry: NOT FOUND")

    if "oracle" in options_state:
        print(f"  Options Market Oracle: {options_state.get('oracle', 'NOT SET')}")

    print("=" * 70)


if __name__ == "__main__":
    check_contracts()
