#!/usr/bin/env python3
"""
Fund the perpetuals market contract so it can pay out position closures.

This script:
1. Checks all open positions
2. Calculates total potential payouts needed
3. Funds the market contract with enough ALGO
4. Allows you to close positions immediately
"""

import json
import ssl
from algosdk.v2client import algod
from algosdk import transaction, account, mnemonic
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

    offset = 0
    position_id = int.from_bytes(box_data[offset : offset + 8], byteorder="big")
    offset += 8

    from algosdk.encoding import encode_address

    trader_bytes = box_data[offset : offset + 32]
    trader = encode_address(trader_bytes)
    offset += 32

    is_long = box_data[offset] == 0x80
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

    # Skip remaining fields
    offset += 8 + 8 + 8  # last_funding_time, accumulated_funding, open_time

    is_open = box_data[offset] == 0x80

    return {
        "position_id": position_id,
        "trader": trader,
        "is_long": is_long,
        "size": size,
        "collateral": collateral,
        "leverage": leverage,
        "entry_price": entry_price,
        "liquidation_price": liquidation_price,
        "is_open": is_open,
    }


def get_current_price(algod_client, oracle_app_id: int) -> float:
    """Get current ALGO price from oracle."""
    try:
        app_info = algod_client.application_info(oracle_app_id)
        global_state = decode_state(app_info["params"]["global-state"])
        price_micro_usd = global_state.get("current_price", 0)
        return price_micro_usd / 1_000_000
    except:
        return 0.12  # Fallback


def calculate_pnl(position: dict, current_price: float) -> tuple:
    """Calculate PnL for a position. Returns (pnl_microalgo, is_profit)."""
    entry_price = position["entry_price"] / 1_000_000  # Convert to USD
    size = position["size"]

    if position["is_long"]:
        if current_price >= entry_price:
            price_diff = current_price - entry_price
            is_profit = True
        else:
            price_diff = entry_price - current_price
            is_profit = False
    else:  # Short
        if entry_price >= current_price:
            price_diff = entry_price - current_price
            is_profit = True
        else:
            price_diff = current_price - entry_price
            is_profit = False

    if entry_price > 0:
        pnl = int((price_diff * size) / entry_price)
    else:
        pnl = 0

    return pnl, is_profit


def calculate_needed_funds(algod_client, market_app_id: int, oracle_app_id: int) -> tuple:
    """Calculate how much ALGO the market contract needs to close all positions."""

    # Get current price
    current_price = get_current_price(algod_client, oracle_app_id)
    print(f"Current ALGO price: ${current_price:.6f}")

    # Get all positions
    app_info = algod_client.application_info(market_app_id)
    global_state = decode_state(app_info["params"]["global-state"])
    next_position_id = global_state.get("next_position_id", 1)

    total_needed = 0
    positions = []

    print(f"\nScanning positions 1 to {next_position_id - 1}...")

    for pos_id in range(1, next_position_id):
        try:
            box_name = get_position_box_name(pos_id)
            box_response = algod_client.application_box_by_name(market_app_id, box_name)
            box_data = base64.b64decode(box_response["value"])

            position = decode_position_box(box_data)
            if position and position["is_open"]:
                positions.append(position)

                # Calculate potential payout
                collateral = position["collateral"]
                pnl, is_profit = calculate_pnl(position, current_price)

                # Calculate closing fee (0.1% = 10 basis points)
                close_fee = (position["size"] * 10) // 10000

                # Calculate net return
                if is_profit:
                    net_return = collateral + pnl - close_fee
                else:
                    if collateral > pnl:
                        net_return = collateral - pnl - close_fee
                    else:
                        net_return = 0

                # Ensure non-negative
                if net_return < 0:
                    net_return = 0

                total_needed += net_return

                # Also add potential staking fee (30% of closing fee)
                staking_fee = (close_fee * 30) // 100
                total_needed += staking_fee

                print(f"\nPosition #{pos_id}:")
                print(f"  Side: {'LONG' if position['is_long'] else 'SHORT'}")
                print(f"  Collateral: {collateral / 1_000_000:.6f} ALGO")
                print(f"  PnL: {'+ ' if is_profit else '- '}{pnl / 1_000_000:.6f} ALGO")
                print(f"  Net Return: {net_return / 1_000_000:.6f} ALGO")

        except Exception as e:
            # Box doesn't exist
            pass

    # Add buffer for transaction fees (1000 microALGO per inner txn, 2 inner txns per close)
    # Plus some safety margin
    tx_fee_buffer = len(positions) * 2000 + 50000  # 50k microALGO safety
    total_needed += tx_fee_buffer

    return total_needed, positions, current_price


def fund_market_contract(algod_client, market_address: str, amount: int, sender_address: str, sender_private_key: str):
    """Send ALGO to the market contract."""
    print(f"\n{'=' * 60}")
    print("Funding Market Contract")
    print(f"{'=' * 60}")

    try:
        params = algod_client.suggested_params()

        # Create payment transaction
        payment_txn = transaction.PaymentTxn(
            sender=sender_address,
            sp=params,
            receiver=market_address,
            amt=amount,
            note=b"Fund market for position closures",
        )

        # Sign and send
        signed_txn = payment_txn.sign(sender_private_key)
        tx_id = algod_client.send_transaction(signed_txn)

        print(f"Transaction sent: {tx_id}")
        print("Waiting for confirmation...")

        result = transaction.wait_for_confirmation(algod_client, tx_id, 4)
        print(f"✓ Funded successfully in round {result['confirmed-round']}")
        print(f"  Amount: {amount / 1_000_000:.6f} ALGO")

        return True

    except Exception as e:
        print(f"✗ Error funding contract: {e}")
        import traceback

        traceback.print_exc()
        return False


def main():
    """Main function."""
    print("=" * 60)
    print("Market Contract Funding Script")
    print("=" * 60)

    # Load deployed addresses
    deployed = load_deployed_addresses()
    if not deployed:
        return

    contracts = deployed.get("contracts", {})
    market_app_id = contracts.get("perps_market", {}).get("app_id")
    market_address = contracts.get("perps_market", {}).get("address")
    oracle_app_id = contracts.get("oracle", {}).get("app_id")

    if not all([market_app_id, market_address, oracle_app_id]):
        print("Error: Missing contract information")
        return

    print(f"\nMarket Contract:")
    print(f"  App ID: {market_app_id}")
    print(f"  Address: {market_address}")

    algod_client = get_algod_client()

    # Check current balance
    try:
        account_info = algod_client.account_info(market_address)
        current_balance = account_info["amount"]
        min_balance = account_info["min-balance"]
        available = current_balance - min_balance

        print(f"\nCurrent Balance:")
        print(f"  Total: {current_balance / 1_000_000:.6f} ALGO")
        print(f"  Min Balance: {min_balance / 1_000_000:.6f} ALGO")
        print(f"  Available: {available / 1_000_000:.6f} ALGO")
    except Exception as e:
        print(f"Error checking balance: {e}")
        available = 0

    # Calculate needed funds
    print(f"\n{'=' * 60}")
    print("Calculating Required Funds")
    print(f"{'=' * 60}")

    total_needed, positions, current_price = calculate_needed_funds(algod_client, market_app_id, oracle_app_id)

    print(f"\n{'=' * 60}")
    print("Funding Summary")
    print(f"{'=' * 60}")
    print(f"Open Positions: {len(positions)}")
    print(f"Total Needed: {total_needed / 1_000_000:.6f} ALGO")
    print(f"Currently Available: {available / 1_000_000:.6f} ALGO")

    if total_needed <= available:
        print("\n✓ Contract already has enough funds to close all positions!")
        print("\nYou can now close positions using:")
        print("  python3 scripts/test_close_position.py")
        return

    shortfall = total_needed - available
    print(f"Shortfall: {shortfall / 1_000_000:.6f} ALGO")

    # Ask to fund
    print(f"\n{'=' * 60}")
    print("To enable position closures, we need to fund the contract.")
    print("Enter your wallet mnemonic to proceed:")
    print(f"{'=' * 60}")

    mnemonic_phrase = input("Mnemonic (or press Enter to skip): ").strip()
    if not mnemonic_phrase:
        print("\nSkipping funding. Run this script again when ready to fund.")
        return

    try:
        sender_private_key = mnemonic.to_private_key(mnemonic_phrase)
        sender_address = account.address_from_private_key(sender_private_key)
        print(f"Your address: {sender_address}")
    except Exception as e:
        print(f"Invalid mnemonic: {e}")
        return

    # Check sender balance
    try:
        sender_info = algod_client.account_info(sender_address)
        sender_balance = sender_info["amount"]
        sender_min = sender_info["min-balance"]
        sender_available = sender_balance - sender_min

        print(f"\nYour Balance:")
        print(f"  Available: {sender_available / 1_000_000:.6f} ALGO")

        if sender_available < shortfall:
            print(f"\n✗ Insufficient balance!")
            print(f"  Need: {shortfall / 1_000_000:.6f} ALGO")
            print(f"  Have: {sender_available / 1_000_000:.6f} ALGO")
            return
    except Exception as e:
        print(f"Error checking your balance: {e}")
        return

    # Confirm
    print(f"\nReady to send {shortfall / 1_000_000:.6f} ALGO to market contract")
    confirm = input("Proceed? (yes/no): ").strip().lower()

    if confirm != "yes":
        print("Cancelled.")
        return

    # Fund the contract
    if fund_market_contract(algod_client, market_address, shortfall, sender_address, sender_private_key):
        print(f"\n{'=' * 60}")
        print("✓ Funding Complete!")
        print(f"{'=' * 60}")
        print("\nYou can now close positions using:")
        print("  python3 scripts/test_close_position.py")
        print("\nOr test from the frontend!")
    else:
        print("\n✗ Funding failed")


if __name__ == "__main__":
    main()
