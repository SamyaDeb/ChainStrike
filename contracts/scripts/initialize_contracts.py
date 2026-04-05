"""
Initialize ChainStrike contracts on TestNet

This script initializes the OptionsMarket and PerpsMarket contracts
with the correct references to Oracle, Pool, and Staking contracts.
"""

import ssl
import os
from algosdk import account, mnemonic, encoding
from algosdk.v2client import algod
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    AccountTransactionSigner,
    TransactionWithSigner,
)
from algosdk import abi, transaction
from typing import Tuple

# Fix SSL
ssl._create_default_https_context = ssl._create_unverified_context

# Configuration
TESTNET_ALGOD = "https://testnet-api.algonode.cloud"

# Contract App IDs - Updated to latest deployment
CONTRACTS = {
    "oracle": 758290477,
    "staking": 758290479,
    "optionsPool": 758290646,
    "optionsMarket": 758290651,
    "perpsPool": 758290663,
    "perpsMarket": 758290831,
}


def get_app_address(app_id: int) -> str:
    """Get the address of an application"""
    return encoding.encode_address(encoding.checksum(b"appID" + app_id.to_bytes(8, "big")))


def initialize_options_market():
    """Initialize the Options Market contract"""
    admin_mnemonic = os.getenv(
        "ADMIN_MNEMONIC",
        "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss",
    )

    client = algod.AlgodClient("", TESTNET_ALGOD)
    private_key = mnemonic.to_private_key(admin_mnemonic)
    address = account.address_from_private_key(private_key)
    signer = AccountTransactionSigner(private_key)

    print("=" * 70)
    print("Initializing Options Market Contract")
    print("=" * 70)
    print(f"Admin: {address}")
    print(f"Options Market App ID: {CONTRACTS['optionsMarket']}")
    print(f"Oracle App ID: {CONTRACTS['oracle']}")
    print(f"Options Pool App ID: {CONTRACTS['optionsPool']}")
    print(f"Staking App ID: {CONTRACTS['staking']}")
    print("=" * 70)

    # Get addresses
    oracle_addr = get_app_address(CONTRACTS["oracle"])
    pool_addr = get_app_address(CONTRACTS["optionsPool"])
    staking_addr = get_app_address(CONTRACTS["staking"])

    print(f"\nOracle Address: {oracle_addr}")
    print(f"Pool Address: {pool_addr}")
    print(f"Staking Address: {staking_addr}")

    # Create ABI method
    initialize_method = abi.Method(
        name="initialize",
        args=[
            abi.Argument("address", "oracle"),
            abi.Argument("address", "options_pool"),
            abi.Argument("address", "staking_contract"),
            abi.Argument("uint64", "oracle_app"),
            abi.Argument("uint64", "options_pool_app"),
        ],
        returns=abi.Returns("bool"),
    )

    sp = client.suggested_params()
    sp.flat_fee = True
    sp.fee = 2000

    atc = AtomicTransactionComposer()
    atc.add_method_call(
        app_id=CONTRACTS["optionsMarket"],
        method=initialize_method,
        sender=address,
        sp=sp,
        signer=signer,
        method_args=[oracle_addr, pool_addr, staking_addr, CONTRACTS["oracle"], CONTRACTS["optionsPool"]],
    )

    try:
        result = atc.execute(client, 10)
        print(f"\n✅ Options Market initialized!")
        print(f"   Transaction ID: {result.tx_ids[0]}")
    except Exception as e:
        print(f"\n❌ Failed to initialize: {e}")


def set_expiry_limits():
    """Set min expiry to 300 seconds (5 minutes)"""
    admin_mnemonic = os.getenv(
        "ADMIN_MNEMONIC",
        "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss",
    )

    client = algod.AlgodClient("", TESTNET_ALGOD)
    private_key = mnemonic.to_private_key(admin_mnemonic)
    address = account.address_from_private_key(private_key)
    signer = AccountTransactionSigner(private_key)

    print("\n" + "=" * 70)
    print("Setting Expiry Limits")
    print("=" * 70)
    print(f"Min Expiry: 300 seconds (5 minutes)")
    print(f"Max Expiry: 2592000 seconds (30 days)")

    set_expiry_method = abi.Method(
        name="set_expiry_limits",
        args=[
            abi.Argument("uint64", "min_expiry"),
            abi.Argument("uint64", "max_expiry"),
        ],
        returns=abi.Returns("bool"),
    )

    sp = client.suggested_params()
    sp.flat_fee = True
    sp.fee = 2000

    atc = AtomicTransactionComposer()
    atc.add_method_call(
        app_id=CONTRACTS["optionsMarket"],
        method=set_expiry_method,
        sender=address,
        sp=sp,
        signer=signer,
        method_args=[300, 2592000],  # 5 min to 30 days
    )

    try:
        result = atc.execute(client, 10)
        print(f"\n✅ Expiry limits updated!")
        print(f"   Transaction ID: {result.tx_ids[0]}")
    except Exception as e:
        print(f"\n❌ Failed to set expiry limits: {e}")


def fetch_real_algo_price() -> Tuple[int, float]:
    """Fetch real ALGO price from CoinGecko API and return as microUSD (6 decimals)"""
    import urllib.request
    import json

    url = "https://api.coingecko.com/api/v3/simple/price?ids=algorand&vs_currencies=usd"

    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read().decode())
            price_usd = data["algorand"]["usd"]
            # Convert to microUSD (6 decimals)
            price_micro = int(price_usd * 1_000_000)
            return price_micro, price_usd
    except Exception as e:
        print(f"⚠️  Failed to fetch price from CoinGecko: {e}")
        # Fallback to Binance
        try:
            binance_url = "https://api.binance.com/api/v3/ticker/price?symbol=ALGOUSDT"
            with urllib.request.urlopen(binance_url, timeout=10) as response:
                data = json.loads(response.read().decode())
                price_usd = float(data["price"])
                price_micro = int(price_usd * 1_000_000)
                return price_micro, price_usd
        except Exception as e2:
            print(f"⚠️  Failed to fetch price from Binance: {e2}")
            raise Exception("Could not fetch ALGO price from any source")


def update_oracle_price():
    """Update oracle with REAL ALGO price from external API"""
    admin_mnemonic = os.getenv(
        "ADMIN_MNEMONIC",
        "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss",
    )

    client = algod.AlgodClient("", TESTNET_ALGOD)
    private_key = mnemonic.to_private_key(admin_mnemonic)
    address = account.address_from_private_key(private_key)
    signer = AccountTransactionSigner(private_key)

    print("\n" + "=" * 70)
    print("Updating Oracle Price (REAL PRICE)")
    print("=" * 70)

    # Fetch real price from external API
    price_micro, price_usd = fetch_real_algo_price()
    print(f"📊 Fetched real ALGO price: ${price_usd:.6f}")
    print(f"📊 Price in microUSD: {price_micro}")

    # Use emergency_set_price for testing (admin only, simpler)
    emergency_method = abi.Method(
        name="emergency_set_price",
        args=[abi.Argument("uint64", "price")],
        returns=abi.Returns("bool"),
    )

    sp = client.suggested_params()
    sp.flat_fee = True
    sp.fee = 2000

    atc = AtomicTransactionComposer()
    atc.add_method_call(
        app_id=CONTRACTS["oracle"],
        method=emergency_method,
        sender=address,
        sp=sp,
        signer=signer,
        method_args=[price_micro],
    )

    try:
        result = atc.execute(client, 10)
        print(f"✅ Oracle price set to ${price_usd:.6f} ({price_micro} microUSD)!")
        print(f"   Transaction ID: {result.tx_ids[0]}")
    except Exception as e:
        print(f"\n❌ Failed to set price: {e}")


def initialize_perps_market():
    """Initialize the Perps Market contract"""
    admin_mnemonic = os.getenv(
        "ADMIN_MNEMONIC",
        "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss",
    )

    client = algod.AlgodClient("", TESTNET_ALGOD)
    private_key = mnemonic.to_private_key(admin_mnemonic)
    address = account.address_from_private_key(private_key)
    signer = AccountTransactionSigner(private_key)

    print("\n" + "=" * 70)
    print("Initializing Perps Market Contract")
    print("=" * 70)

    oracle_addr = get_app_address(CONTRACTS["oracle"])
    pool_addr = get_app_address(CONTRACTS["perpsPool"])
    staking_addr = get_app_address(CONTRACTS["staking"])

    initialize_method = abi.Method(
        name="initialize",
        args=[
            abi.Argument("address", "oracle"),
            abi.Argument("address", "perps_pool"),
            abi.Argument("address", "staking_contract"),
            abi.Argument("uint64", "oracle_app"),
        ],
        returns=abi.Returns("bool"),
    )

    sp = client.suggested_params()
    sp.flat_fee = True
    sp.fee = 2000

    atc = AtomicTransactionComposer()
    atc.add_method_call(
        app_id=CONTRACTS["perpsMarket"],
        method=initialize_method,
        sender=address,
        sp=sp,
        signer=signer,
        method_args=[oracle_addr, pool_addr, staking_addr, CONTRACTS["oracle"]],
    )

    try:
        result = atc.execute(client, 10)
        print(f"\n✅ Perps Market initialized!")
        print(f"   Transaction ID: {result.tx_ids[0]}")
    except Exception as e:
        print(f"\n❌ Failed to initialize: {e}")


if __name__ == "__main__":
    print("\n" + "=" * 70)
    print("ChainStrike Contract Initialization")
    print("=" * 70 + "\n")

    # Step 1: Update oracle price first
    update_oracle_price()

    # Step 2: Initialize Options Market
    initialize_options_market()

    # Step 3: Set expiry limits for 5-minute options
    set_expiry_limits()

    # Step 4: Initialize Perps Market
    initialize_perps_market()

    print("\n" + "=" * 70)
    print("Done! Run check_contract_state.py to verify.")
    print("=" * 70)
