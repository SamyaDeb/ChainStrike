#!/usr/bin/env python3
"""
Check contract states and debugging information
"""

import sys
from algosdk.v2client import algod
from algosdk import encoding
import base64

# Algorand TestNet configuration
ALGOD_ADDRESS = "https://testnet-api.4160.nodely.dev"
ALGOD_TOKEN = ""

# Deployed contract App IDs
ORACLE_APP_ID = 758290477
OPTIONS_MARKET_APP_ID = 758290651
PERPS_MARKET_APP_ID = 758290831
OPTIONS_POOL_APP_ID = 758290646
PERPS_POOL_APP_ID = 758290663


def get_algod_client():
    return algod.AlgodClient(ALGOD_TOKEN, ALGOD_ADDRESS)


def decode_global_state(app_info):
    """Decode global state from app info"""
    state = {}
    if "params" in app_info and "global-state" in app_info["params"]:
        for item in app_info["params"]["global-state"]:
            key_b64 = item["key"]
            key_bytes = base64.b64decode(key_b64)
            key = key_bytes.decode("utf-8")

            value = item["value"]
            if value["type"] == 1:  # uint
                state[key] = value["uint"]
            elif value["type"] == 2:  # bytes
                state[key] = base64.b64decode(value["bytes"])
    return state


def check_oracle(client):
    print("\n=== Oracle Contract ===")
    try:
        app_info = client.application_info(ORACLE_APP_ID)
        state = decode_global_state(app_info)

        print(f"App ID: {ORACLE_APP_ID}")
        print(f"Global State:")
        for key, value in state.items():
            if isinstance(value, int):
                print(f"  {key}: {value}")
                if key == "algo_price_micro_usd":
                    print(f"    -> ${value / 1_000_000:.6f} USD")
            else:
                print(f"  {key}: {value.hex() if isinstance(value, bytes) else value}")

        # Check if price is valid
        price = state.get("algo_price_micro_usd", 0)
        if price == 0:
            print("\n⚠️  WARNING: Oracle price is 0! Options and perps will fail.")
            print("   Run: python3 scripts/initialize_contracts.py")
            return False
        else:
            print(f"\n✓ Oracle has valid price: ${price / 1_000_000:.6f}")
            return True
    except Exception as e:
        print(f"❌ Error checking oracle: {e}")
        return False


def check_options_market(client):
    print("\n=== Options Market Contract ===")
    try:
        app_info = client.application_info(OPTIONS_MARKET_APP_ID)
        state = decode_global_state(app_info)

        print(f"App ID: {OPTIONS_MARKET_APP_ID}")
        print(f"Global State:")
        for key, value in state.items():
            if isinstance(value, int):
                print(f"  {key}: {value}")
            else:
                print(f"  {key}: {value.hex() if isinstance(value, bytes) else value}")

        # Check if initialized
        oracle_id = state.get("oracle_app_id", 0)
        pool_id = state.get("pool_app_id", 0)

        if oracle_id == 0 or pool_id == 0:
            print("\n⚠️  WARNING: Options Market not initialized!")
            print(f"   oracle_app_id: {oracle_id}")
            print(f"   pool_app_id: {pool_id}")
            print("   Run: python3 scripts/initialize_contracts.py")
            return False
        else:
            print(f"\n✓ Options Market is initialized")
            print(f"   Oracle: {oracle_id}")
            print(f"   Pool: {pool_id}")
            return True
    except Exception as e:
        print(f"❌ Error checking options market: {e}")
        return False


def check_perps_market(client):
    print("\n=== Perps Market Contract ===")
    try:
        app_info = client.application_info(PERPS_MARKET_APP_ID)
        state = decode_global_state(app_info)

        print(f"App ID: {PERPS_MARKET_APP_ID}")
        print(f"Global State:")
        for key, value in state.items():
            if isinstance(value, int):
                print(f"  {key}: {value}")
            else:
                print(f"  {key}: {value.hex() if isinstance(value, bytes) else value}")

        # Check if initialized
        oracle_id = state.get("oracle_app_id", 0)
        pool_id = state.get("pool_app_id", 0)

        if oracle_id == 0 or pool_id == 0:
            print("\n⚠️  WARNING: Perps Market not initialized!")
            print(f"   oracle_app_id: {oracle_id}")
            print(f"   pool_app_id: {pool_id}")
            print("   Run: python3 scripts/initialize_contracts.py")
            return False
        else:
            print(f"\n✓ Perps Market is initialized")
            print(f"   Oracle: {oracle_id}")
            print(f"   Pool: {pool_id}")
            return True
    except Exception as e:
        print(f"❌ Error checking perps market: {e}")
        return False


def check_options_pool(client):
    print("\n=== Options Pool Contract ===")
    try:
        app_info = client.application_info(OPTIONS_POOL_APP_ID)
        state = decode_global_state(app_info)

        print(f"App ID: {OPTIONS_POOL_APP_ID}")
        print(f"Global State:")
        for key, value in state.items():
            if isinstance(value, int):
                print(f"  {key}: {value}")
                if key == "total_liquidity":
                    print(f"    -> {value / 1_000_000:.6f} ALGO")
            else:
                print(f"  {key}: {value.hex() if isinstance(value, bytes) else value}")

        lp_token = state.get("lp_token_id", 0)
        if lp_token == 0:
            print("\n⚠️  WARNING: Options Pool not initialized (no LP token)!")
            print("   Run: python3 scripts/initialize_pools.py")
            return False
        else:
            print(f"\n✓ Options Pool has LP token: {lp_token}")
            return True
    except Exception as e:
        print(f"❌ Error checking options pool: {e}")
        return False


def check_perps_pool(client):
    print("\n=== Perps Pool Contract ===")
    try:
        app_info = client.application_info(PERPS_POOL_APP_ID)
        state = decode_global_state(app_info)

        print(f"App ID: {PERPS_POOL_APP_ID}")
        print(f"Global State:")
        for key, value in state.items():
            if isinstance(value, int):
                print(f"  {key}: {value}")
                if key == "total_liquidity":
                    print(f"    -> {value / 1_000_000:.6f} ALGO")
            else:
                print(f"  {key}: {value.hex() if isinstance(value, bytes) else value}")

        lp_token = state.get("lp_token_id", 0)
        if lp_token == 0:
            print("\n⚠️  WARNING: Perps Pool not initialized (no LP token)!")
            print("   Run: python3 scripts/initialize_pools.py")
            return False
        else:
            print(f"\n✓ Perps Pool has LP token: {lp_token}")
            return True
    except Exception as e:
        print(f"❌ Error checking perps pool: {e}")
        return False


def main():
    print("ChainStrike Contract Status Check")
    print("=" * 50)

    client = get_algod_client()

    oracle_ok = check_oracle(client)
    options_market_ok = check_options_market(client)
    perps_market_ok = check_perps_market(client)
    options_pool_ok = check_options_pool(client)
    perps_pool_ok = check_perps_pool(client)

    print("\n" + "=" * 50)
    print("Summary:")
    print(f"  Oracle: {'✓' if oracle_ok else '❌'}")
    print(f"  Options Market: {'✓' if options_market_ok else '❌'}")
    print(f"  Perps Market: {'✓' if perps_market_ok else '❌'}")
    print(f"  Options Pool: {'✓' if options_pool_ok else '❌'}")
    print(f"  Perps Pool: {'✓' if perps_pool_ok else '❌'}")

    if all([oracle_ok, options_market_ok, perps_market_ok, options_pool_ok, perps_pool_ok]):
        print("\n✓ All contracts are properly initialized!")
        return 0
    else:
        print("\n❌ Some contracts need initialization. See warnings above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
