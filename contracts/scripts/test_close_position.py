#!/usr/bin/env python3
"""
Test script to close existing perpetual positions on-chain.
This helps debug the close position functionality.
"""

import json
import ssl
import certifi
from algosdk.v2client import algod
from algosdk import transaction, account, mnemonic
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    TransactionWithSigner,
    AccountTransactionSigner,
)
from algosdk.abi import Method
import base64

# Fix SSL certificate verification
ssl._create_default_https_context = ssl._create_unverified_context

# Algorand node configuration
ALGOD_ADDRESS = "https://testnet-api.4160.nodely.dev"
ALGOD_TOKEN = ""


def get_algod_client():
    return algod.AlgodClient(ALGOD_TOKEN, ALGOD_ADDRESS)


def load_deployed_addresses():
    """Load deployed contract addresses from file."""
    try:
        with open("deployed_addresses.json", "r") as f:
            return json.load(f)
    except FileNotFoundError:
        print("Error: deployed_addresses.json not found")
        return None


def decode_state(state_array):
    """Decode contract global state."""
    state = {}
    for item in state_array:
        key = base64.b64decode(item["key"]).decode()
        value = item["value"]
        if value["type"] == 1:  # bytes
            state[key] = base64.b64decode(value["bytes"])
        elif value["type"] == 2:  # uint
            state[key] = value["uint"]
    return state


def get_position_box_name(position_id: int) -> bytes:
    """Generate box name for a position."""
    prefix = b"pos_"
    id_bytes = position_id.to_bytes(8, byteorder="big")
    return prefix + id_bytes


def decode_position_box(box_data: bytes) -> dict:
    """Decode position box data."""
    if len(box_data) < 106:
        return None

    # Position struct format (106 bytes):
    # position_id: 8 bytes (uint64)
    # trader: 32 bytes (address)
    # is_long: 1 byte (bool)
    # size: 8 bytes (uint64)
    # collateral: 8 bytes (uint64)
    # leverage: 8 bytes (uint64)
    # entry_price: 8 bytes (uint64)
    # liquidation_price: 8 bytes (uint64)
    # last_funding_time: 8 bytes (uint64)
    # accumulated_funding: 8 bytes (uint64)
    # open_time: 8 bytes (uint64)
    # is_open: 1 byte (bool)

    offset = 0
    position_id = int.from_bytes(box_data[offset : offset + 8], byteorder="big")
    offset += 8

    trader_bytes = box_data[offset : offset + 32]
    from algosdk.encoding import encode_address

    trader = encode_address(trader_bytes)
    offset += 32

    is_long = box_data[offset] == 0x80  # ABI bool encoding
    offset += 1

    size = int.from_bytes(box_data[offset : offset + 8], byteorder="big")
    offset += 8

    collateral = int.from_bytes(box_data[offset : offset + 8], byteorder="big")
    offset += 8

    leverage = int.from_bytes(box_data[offset : offset + 8], byteorder="big")
    offset += 8

    entry_price = int.from_bytes(box_data[offset : offset + 8], byteorder="big")
    offset += 8

    liquidation_price = int.from_bytes(box_data[offset : offset + 8], byteorder="big")
    offset += 8

    last_funding_time = int.from_bytes(box_data[offset : offset + 8], byteorder="big")
    offset += 8

    accumulated_funding = int.from_bytes(box_data[offset : offset + 8], byteorder="big")
    offset += 8

    open_time = int.from_bytes(box_data[offset : offset + 8], byteorder="big")
    offset += 8

    is_open = box_data[offset] == 0x80  # ABI bool encoding

    return {
        "position_id": position_id,
        "trader": trader,
        "is_long": is_long,
        "size": size,
        "collateral": collateral,
        "leverage": leverage,
        "entry_price": entry_price,
        "liquidation_price": liquidation_price,
        "last_funding_time": last_funding_time,
        "accumulated_funding": accumulated_funding,
        "open_time": open_time,
        "is_open": is_open,
    }


def get_all_positions(algod_client, app_id: int):
    """Get all positions from the contract."""
    try:
        # Get global state to find next_position_id
        app_info = algod_client.application_info(app_id)
        global_state = decode_state(app_info["params"]["global-state"])
        next_position_id = global_state.get("next_position_id", 1)

        print(f"Next position ID will be: {next_position_id}")
        print(f"Checking positions 1 to {next_position_id - 1}...")

        positions = []
        for pos_id in range(1, next_position_id):
            try:
                box_name = get_position_box_name(pos_id)
                box_response = algod_client.application_box_by_name(app_id, box_name)
                box_data = base64.b64decode(box_response["value"])

                position = decode_position_box(box_data)
                if position and position["is_open"]:
                    positions.append(position)
                    print(f"\nPosition #{pos_id}:")
                    print(f"  Trader: {position['trader']}")
                    print(f"  Side: {'LONG' if position['is_long'] else 'SHORT'}")
                    print(f"  Size: {position['size'] / 1_000_000:.2f} ALGO")
                    print(f"  Collateral: {position['collateral'] / 1_000_000:.6f} ALGO")
                    print(f"  Leverage: {position['leverage'] / 100}x")
                    print(f"  Entry Price: ${position['entry_price'] / 1_000_000:.6f}")
                    print(f"  Liq Price: ${position['liquidation_price'] / 1_000_000:.6f}")
                    print(f"  Open: {position['is_open']}")
            except Exception as e:
                # Box doesn't exist or error reading it
                pass

        return positions
    except Exception as e:
        print(f"Error getting positions: {e}")
        return []


def close_position_test(
    algod_client,
    app_id: int,
    oracle_app_id: int,
    pool_app_id: int,
    pool_address: str,
    position_id: int,
    sender_address: str,
    sender_private_key: str,
):
    """Test closing a position."""
    print(f"\n{'=' * 60}")
    print(f"Testing close position #{position_id}")
    print(f"{'=' * 60}")

    # Get current position info
    try:
        box_name = get_position_box_name(position_id)
        box_response = algod_client.application_box_by_name(app_id, box_name)
        box_data = base64.b64decode(box_response["value"])
        position = decode_position_box(box_data)

        if not position["is_open"]:
            print(f"Position #{position_id} is already closed!")
            return False

        if position["trader"] != sender_address:
            print(f"You are not the owner of position #{position_id}")
            print(f"  Owner: {position['trader']}")
            print(f"  You: {sender_address}")
            return False

        print(f"Position info:")
        print(f"  Side: {'LONG' if position['is_long'] else 'SHORT'}")
        print(f"  Size: {position['size'] / 1_000_000:.2f} ALGO")
        print(f"  Collateral: {position['collateral'] / 1_000_000:.6f} ALGO")
        print(f"  Entry Price: ${position['entry_price'] / 1_000_000:.6f}")

    except Exception as e:
        print(f"Error reading position: {e}")
        return False

    # Check contract balance
    try:
        app_address_info = algod_client.account_info(algod_client.application_info(app_id)["params"]["creator"])
        print(f"\nContract balance: {app_address_info.get('amount', 0) / 1_000_000:.6f} ALGO")
    except:
        pass

    # Create close position transaction
    try:
        params = algod_client.suggested_params()
        params.flat_fee = True
        params.fee = 4000  # Higher fee for inner txns

        # Close position method: close_position(uint64)uint64
        close_method = Method.from_signature("close_position(uint64)uint64")

        atc = AtomicTransactionComposer()
        signer = AccountTransactionSigner(sender_private_key)

        atc.add_method_call(
            app_id=app_id,
            method=close_method,
            sender=sender_address,
            sp=params,
            signer=signer,
            method_args=[position_id],
            foreign_apps=[oracle_app_id, pool_app_id],
            accounts=[pool_address],
            boxes=[(app_id, box_name)],
        )

        print("\nSubmitting close position transaction...")
        result = atc.execute(algod_client, 4)

        tx_id = result.tx_ids[0]
        print(f"✓ Transaction successful!")
        print(f"  Tx ID: {tx_id}")

        # Decode return value
        if result.abi_results:
            returned_amount = result.abi_results[0].return_value
            print(f"  Amount returned: {returned_amount / 1_000_000:.6f} ALGO")

        return True

    except Exception as e:
        print(f"✗ Error closing position: {e}")
        import traceback

        traceback.print_exc()
        return False


def main():
    """Main test function."""
    print("=" * 60)
    print("Close Position Test Script")
    print("=" * 60)

    # Load deployed addresses
    deployed = load_deployed_addresses()
    if not deployed:
        return

    algod_client = get_algod_client()

    # Get contract info
    contracts = deployed.get("contracts", {})
    perps_market_id = contracts.get("perps_market", {}).get("app_id")
    oracle_id = contracts.get("oracle", {}).get("app_id")
    pool_id = contracts.get("perps_pool", {}).get("app_id")
    pool_address = contracts.get("perps_pool", {}).get("address")

    if not all([perps_market_id, oracle_id, pool_id, pool_address]):
        print("Error: Missing contract addresses in deployed_addresses.json")
        return

    print(f"\nContract Info:")
    print(f"  Perps Market: {perps_market_id}")
    print(f"  Oracle: {oracle_id}")
    print(f"  Pool: {pool_id}")
    print(f"  Pool Address: {pool_address}")

    # Get all open positions
    print(f"\n{'=' * 60}")
    print("Fetching open positions...")
    print(f"{'=' * 60}")

    positions = get_all_positions(algod_client, perps_market_id)

    if not positions:
        print("\nNo open positions found!")
        return

    print(f"\nFound {len(positions)} open position(s)")

    # Ask user which position to close
    print(f"\n{'=' * 60}")
    print("Enter your wallet mnemonic to close a position")
    print("(Or press Enter to skip)")
    print(f"{'=' * 60}")

    mnemonic_phrase = input("Mnemonic: ").strip()
    if not mnemonic_phrase:
        print("Skipping close test.")
        return

    try:
        sender_private_key = mnemonic.to_private_key(mnemonic_phrase)
        sender_address = account.address_from_private_key(sender_private_key)
        print(f"Your address: {sender_address}")
    except Exception as e:
        print(f"Invalid mnemonic: {e}")
        return

    # Find positions owned by this user
    user_positions = [p for p in positions if p["trader"] == sender_address]

    if not user_positions:
        print(f"\nYou don't own any open positions!")
        return

    print(f"\nYour open positions:")
    for p in user_positions:
        print(f"  Position #{p['position_id']}: {'LONG' if p['is_long'] else 'SHORT'} {p['size'] / 1_000_000:.2f} ALGO")

    # Ask which position to close
    position_id_str = input("\nEnter position ID to close: ").strip()
    try:
        position_id = int(position_id_str)
    except ValueError:
        print("Invalid position ID")
        return

    # Close the position
    success = close_position_test(
        algod_client,
        perps_market_id,
        oracle_id,
        pool_id,
        pool_address,
        position_id,
        sender_address,
        sender_private_key,
    )

    if success:
        print("\n✓ Position closed successfully!")
    else:
        print("\n✗ Failed to close position")


if __name__ == "__main__":
    main()
