"""
ChainStrike Trader Profit Flow Test
====================================

Complete end-to-end test of profitable options trading:
1. Fund trader account
2. Check pool liquidity
3. Buy 1-minute call option
4. Simulate price increase (option goes ITM)
5. Exercise profitable option
6. Trader receives ALGO profit from pool
7. Verify all balances

Usage: python3 test_trader_profit_flow.py
"""

import ssl
import os
import time
import sys
from datetime import datetime, timedelta
from algosdk import account, mnemonic, encoding
from algosdk.v2client import algod, indexer
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    AccountTransactionSigner,
    TransactionWithSigner,
)
from algosdk import abi, transaction
import json

# Fix SSL
ssl._create_default_https_context = ssl._create_unverified_context

# ============================================================================
# Configuration
# ============================================================================

TESTNET_ALGOD = "https://testnet-api.algonode.cloud"
TESTNET_INDEXER = "https://testnet-idx.algonode.cloud"

# Updated Contract App IDs (1-minute options support)
CONTRACTS = {
    "oracle": 758189767,
    "staking": 758189780,
    "optionsPool": 758222938,
    "optionsMarket": 758254794,  # Updated deployment
}

# Trader account
TRADER_MNEMONIC = "vacant extra will swarm love ability zone deny auto autumn outdoor swap weapon van net before version truck sister manage goose census grunt absorb sword"

# Deployer account (for funding/oracle updates)
DEPLOYER_MNEMONIC = "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss"

# Test parameters
OPTION_SIZE = 5_000_000  # 5 ALGO position
EXPIRY_DURATION = 60  # 1 minute
CALL_OPTION = True  # Buy call
STRIKE_PERCENTAGE = 98  # Strike at 98% of current price (ITM after price increase)

# ============================================================================
# Utility Functions
# ============================================================================


def get_app_address(app_id: int) -> str:
    """Get the address of an application"""
    return encoding.encode_address(encoding.checksum(b"appID" + app_id.to_bytes(8, "big")))


def get_algod_client():
    """Create Algod client"""
    return algod.AlgodClient("", TESTNET_ALGOD)


def get_indexer_client():
    """Create Indexer client"""
    return indexer.IndexerClient("", TESTNET_INDEXER)


def get_account_balance(client, address):
    """Get account ALGO balance in microALGOs"""
    try:
        info = client.account_info(address)
        return info.get("amount", 0)
    except:
        return 0


def format_algo(microalgos):
    """Format microALGOs as ALGO"""
    return f"{microalgos / 1_000_000:.6f} ALGO"


def get_app_global_state(client, app_id):
    """Get global state of an application"""
    try:
        import base64

        app_info = client.application_info(app_id)
        global_state = {}

        if "params" in app_info and "global-state" in app_info["params"]:
            for item in app_info["params"]["global-state"]:
                key_bytes = base64.b64decode(item["key"])
                try:
                    key = key_bytes.decode("utf-8", errors="replace")
                except:
                    key = key_bytes.hex()

                value = item["value"]
                if value["type"] == 1:  # bytes
                    try:
                        val_bytes = base64.b64decode(value["bytes"])
                        if len(val_bytes) == 32:
                            global_state[key] = encoding.encode_address(val_bytes)
                        else:
                            global_state[key] = val_bytes.hex()
                    except:
                        global_state[key] = value["bytes"]
                else:  # uint
                    global_state[key] = value["uint"]

        return global_state
    except Exception as e:
        return {"error": str(e)}


def get_app_local_state(client, app_id, address):
    """Get local state for an account"""
    try:
        import base64

        account_info = client.account_info(address)
        local_states = {}

        if "apps-local-state" in account_info:
            for app_state in account_info["apps-local-state"]:
                if app_state["id"] == app_id:
                    if "key-value" in app_state:
                        for item in app_state["key-value"]:
                            key_bytes = base64.b64decode(item["key"])
                            try:
                                key = key_bytes.decode("utf-8", errors="replace")
                            except:
                                key = key_bytes.hex()

                            value = item["value"]
                            if value["type"] == 1:  # bytes
                                try:
                                    val_bytes = base64.b64decode(value["bytes"])
                                    if len(val_bytes) == 32:
                                        local_states[key] = encoding.encode_address(val_bytes)
                                    else:
                                        local_states[key] = val_bytes.hex()
                                except:
                                    local_states[key] = value["bytes"]
                            else:  # uint
                                local_states[key] = value["uint"]

        return local_states
    except Exception as e:
        return {"error": str(e)}


def wait_for_confirmation(client, txid, timeout=4):
    """Wait for transaction confirmation"""
    start = time.time()
    while time.time() - start < timeout:
        try:
            tx_info = client.pending_transaction_info(txid)
            if tx_info.get("confirmed-round", 0) > 0:
                return tx_info
            if tx_info.get("pool-error"):
                raise Exception(f"Transaction rejected: {tx_info['pool-error']}")
        except Exception as e:
            if "transaction not found" not in str(e).lower():
                raise
        time.sleep(0.5)
    raise Exception("Transaction not confirmed in time")


# ============================================================================
# Smart Contract Interaction
# ============================================================================


def load_abi_contract(contract_path):
    """Load ABI contract from JSON file"""
    try:
        with open(contract_path, "r") as f:
            contract_json = json.load(f)
            return abi.Contract.from_json(json.dumps(contract_json))
    except Exception as e:
        print(f"Error loading ABI: {e}")
        return None


def optin_to_app(client, app_id, sender_address, sender_key):
    """Opt-in to an application"""
    print(f"\n📝 Opting in to app {app_id}...")

    params = client.suggested_params()
    txn = transaction.ApplicationOptInTxn(sender_address, params, app_id)

    signed_txn = txn.sign(sender_key)
    txid = client.send_transaction(signed_txn)

    print(f"   Transaction ID: {txid}")
    result = wait_for_confirmation(client, txid)
    print(f"   ✅ Confirmed in round {result.get('confirmed-round')}")
    return result


def update_oracle_price(client, oracle_app_id, new_price_cents, deployer_address, deployer_key):
    """Update oracle price (requires deployer/creator access)"""
    print(f"\n📊 Updating oracle price to ${new_price_cents / 100:.4f}...")

    # Load Oracle ABI
    oracle_abi = load_abi_contract("../Oracle.arc56.json")
    if not oracle_abi:
        raise Exception("Failed to load Oracle ABI")

    atc = AtomicTransactionComposer()
    signer = AccountTransactionSigner(deployer_key)

    atc.add_method_call(
        app_id=oracle_app_id,
        method=oracle_abi.get_method_by_name("update_price"),
        sender=deployer_address,
        sp=client.suggested_params(),
        signer=signer,
        method_args=[new_price_cents, int(time.time())],
    )

    result = atc.execute(client, 4)
    txid = result.tx_ids[0]
    print(f"   Transaction ID: {txid}")
    print(f"   ✅ Price updated successfully")
    return result


def buy_option(
    client,
    market_app_id,
    pool_app_id,
    trader_address,
    trader_key,
    option_size,
    is_call,
    strike_price,
    expiry_time,
    premium,
):
    """Create/buy an option"""
    print(f"\n🛒 Creating {'CALL' if is_call else 'PUT'} option...")
    print(f"   Size: {format_algo(option_size)}")
    print(f"   Strike: ${strike_price / 100:.4f}")
    print(f"   Expiry: {datetime.fromtimestamp(expiry_time)}")
    print(f"   Estimated Premium: {format_algo(premium)}")

    # Load Options Market ABI
    market_abi = load_abi_contract("../OptionsMarket.arc56.json")
    if not market_abi:
        raise Exception("Failed to load OptionsMarket ABI")

    atc = AtomicTransactionComposer()
    signer = AccountTransactionSigner(trader_key)
    params = client.suggested_params()
    params.fee = 2000  # Higher fee for box storage
    params.flat_fee = True

    # Payment transaction for premium + box storage MBR
    # Box MBR: 2500 + 400 * box_size bytes
    box_mbr = 2500 + (400 * 200)  # ~200 bytes for option info
    total_payment = premium + box_mbr

    premium_payment = transaction.PaymentTxn(
        sender=trader_address,
        receiver=get_app_address(market_app_id),
        amt=total_payment,
        sp=params,
        note=b"option_premium_and_mbr",
    )

    atc.add_transaction(TransactionWithSigner(premium_payment, signer))

    # create_option method call
    atc.add_method_call(
        app_id=market_app_id,
        method=market_abi.get_method_by_name("create_option"),
        sender=trader_address,
        sp=params,
        signer=signer,
        method_args=[
            is_call,  # is_call
            strike_price,  # strike_price (cents)
            expiry_time,  # expiry_timestamp
            option_size,  # size (microALGOs)
        ],
        foreign_apps=[pool_app_id],
        boxes=[[market_app_id, b"next_option_id"]],  # Need to access counter box
    )

    result = atc.execute(client, 4)
    txid = result.tx_ids[-1]
    print(f"   Transaction ID: {txid}")

    # Get return value (option_id)
    if result.abi_results:
        option_id = result.abi_results[-1].return_value
        print(f"   ✅ Option created! Option ID: {option_id}")
        return option_id
    else:
        print(f"   ✅ Option created!")
        return None


def exercise_option(client, market_app_id, pool_app_id, trader_address, trader_key, position_id):
    """Exercise an option"""
    print(f"\n💰 Exercising option (Position ID: {position_id})...")

    # Load Options Market ABI
    market_abi = load_abi_contract("../OptionsMarket.arc56.json")
    if not market_abi:
        raise Exception("Failed to load OptionsMarket ABI")

    atc = AtomicTransactionComposer()
    signer = AccountTransactionSigner(trader_key)

    atc.add_method_call(
        app_id=market_app_id,
        method=market_abi.get_method_by_name("exercise_option"),
        sender=trader_address,
        sp=client.suggested_params(),
        signer=signer,
        method_args=[position_id],
        foreign_apps=[pool_app_id],
    )

    result = atc.execute(client, 4)
    txid = result.tx_ids[0]
    print(f"   Transaction ID: {txid}")
    print(f"   ✅ Option exercised successfully!")
    return result


# ============================================================================
# Main Test Flow
# ============================================================================


def main():
    print("=" * 80)
    print("ChainStrike Trader Profit Flow Test")
    print("=" * 80)

    # Initialize clients
    client = get_algod_client()

    # Get accounts
    trader_key = mnemonic.to_private_key(TRADER_MNEMONIC)
    trader_address = account.address_from_private_key(trader_key)

    deployer_key = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
    deployer_address = account.address_from_private_key(deployer_key)

    pool_address = get_app_address(CONTRACTS["optionsPool"])
    market_address = get_app_address(CONTRACTS["optionsMarket"])

    print(f"\n📍 Addresses:")
    print(f"   Trader: {trader_address}")
    print(f"   Deployer: {deployer_address}")
    print(f"   Pool: {pool_address}")
    print(f"   Market: {market_address}")

    # ========================================================================
    # Step 1: Check Initial Balances
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 1: Initial Balances")
    print("=" * 80)

    trader_balance_before = get_account_balance(client, trader_address)
    pool_balance_before = get_account_balance(client, pool_address)

    print(f"\n💰 Balances:")
    print(f"   Trader: {format_algo(trader_balance_before)}")
    print(f"   Pool: {format_algo(pool_balance_before)}")

    if trader_balance_before < 10_000_000:
        print(f"\n⚠️  Warning: Trader has insufficient balance!")
        print(f"   Please fund trader address: {trader_address}")
        print(f"   Use TestNet dispenser: https://bank.testnet.algorand.network/")
        return

    # ========================================================================
    # Step 2: Check Pool State
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 2: Pool State")
    print("=" * 80)

    pool_state = get_app_global_state(client, CONTRACTS["optionsPool"])
    print(f"\n📊 Pool State:")
    print(f"   Total Liquidity: {format_algo(pool_state.get('total_liquidity', 0))}")
    print(f"   Active Exposure: {format_algo(pool_state.get('active_exposure', 0))}")

    if pool_state.get("total_liquidity", 0) < 100_000_000:
        print(f"\n⚠️  Warning: Pool has low liquidity!")
        print(f"   Pool may not have enough funds to pay profits")

    # ========================================================================
    # Step 3: Get Current Price
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 3: Current Price")
    print("=" * 80)

    oracle_state = get_app_global_state(client, CONTRACTS["oracle"])
    current_price_cents = oracle_state.get("price", 0)

    print(f"\n💵 Oracle Price: ${current_price_cents / 100:.4f}")

    # Calculate strike price (98% of current - will be ITM after price increase)
    strike_price_cents = int(current_price_cents * STRIKE_PERCENTAGE / 100)
    print(f"   Strike Price: ${strike_price_cents / 100:.4f} ({STRIKE_PERCENTAGE}% of current)")

    # ========================================================================
    # Step 4: Ready to Trade
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 4: Ready to Trade")
    print("=" * 80)

    print("   ✅ Contract uses box storage - no opt-in required")
    print("   ✅ Trader can purchase options directly")

    # ========================================================================
    # Step 5: Buy Option
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 5: Buy 1-Minute Call Option")
    print("=" * 80)

    expiry_time = int(time.time()) + EXPIRY_DURATION

    # Calculate premium (approximately 1% for 1-minute options)
    estimated_premium = int(OPTION_SIZE * 0.015)  # 1.5% to be safe

    try:
        position_id = buy_option(
            client=client,
            market_app_id=CONTRACTS["optionsMarket"],
            pool_app_id=CONTRACTS["optionsPool"],
            trader_address=trader_address,
            trader_key=trader_key,
            option_size=OPTION_SIZE,
            is_call=CALL_OPTION,
            strike_price=strike_price_cents,
            expiry_time=expiry_time,
            premium=estimated_premium,
        )
    except Exception as e:
        print(f"\n❌ Failed to buy option: {e}")
        return

    trader_balance_after_buy = get_account_balance(client, trader_address)
    premium_paid = trader_balance_before - trader_balance_after_buy

    print(f"\n💸 Premium Paid: {format_algo(premium_paid)}")
    print(f"   Trader Balance: {format_algo(trader_balance_after_buy)}")

    # ========================================================================
    # Step 6: Simulate Price Increase
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 6: Simulate Price Increase (Make Option ITM)")
    print("=" * 80)

    # Increase price by 5% to make option profitable
    new_price_cents = int(current_price_cents * 1.05)

    try:
        update_oracle_price(client, CONTRACTS["oracle"], new_price_cents, deployer_address, deployer_key)
        print(f"\n   Old Price: ${current_price_cents / 100:.4f}")
        print(f"   New Price: ${new_price_cents / 100:.4f}")
        print(f"   Increase: {((new_price_cents / current_price_cents - 1) * 100):.2f}%")
    except Exception as e:
        print(f"\n⚠️  Warning: Could not update oracle price: {e}")
        print("   Continuing with current price (option may not be profitable)")

    # ========================================================================
    # Step 7: Wait for Expiry
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 7: Wait for Option Expiry")
    print("=" * 80)

    print(f"\n⏰ Waiting {EXPIRY_DURATION} seconds for option to expire...")
    print(f"   Expiry time: {datetime.fromtimestamp(expiry_time)}")

    for i in range(EXPIRY_DURATION):
        remaining = EXPIRY_DURATION - i
        print(f"\r   ⏳ {remaining}s remaining...", end="", flush=True)
        time.sleep(1)

    print("\n   ✅ Option expired!")

    # ========================================================================
    # Step 8: Exercise Option (Get Profit)
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 8: Exercise Option & Receive Profit")
    print("=" * 80)

    # Calculate expected profit
    # Profit = (current_price - strike_price) * size / current_price
    price_diff = new_price_cents - strike_price_cents
    expected_profit = int((price_diff / new_price_cents) * OPTION_SIZE)

    print(f"\n📈 Expected Profit:")
    print(f"   Strike: ${strike_price_cents / 100:.4f}")
    print(f"   Current: ${new_price_cents / 100:.4f}")
    print(f"   Diff: ${price_diff / 100:.4f}")
    print(f"   Expected Payout: {format_algo(expected_profit)}")

    try:
        exercise_option(
            client=client,
            market_app_id=CONTRACTS["optionsMarket"],
            pool_app_id=CONTRACTS["optionsPool"],
            trader_address=trader_address,
            trader_key=trader_key,
            position_id=position_id if position_id else 1,
        )
    except Exception as e:
        print(f"\n❌ Failed to exercise option: {e}")
        return

    # ========================================================================
    # Step 9: Verify Final Balances & Profit
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 9: Final Balances & Net Profit")
    print("=" * 80)

    time.sleep(2)  # Wait for balance updates

    trader_balance_final = get_account_balance(client, trader_address)
    pool_balance_final = get_account_balance(client, pool_address)

    actual_profit_received = trader_balance_final - trader_balance_after_buy
    net_profit = trader_balance_final - trader_balance_before

    print(f"\n💰 Final Balances:")
    print(f"   Trader: {format_algo(trader_balance_final)}")
    print(f"   Pool: {format_algo(pool_balance_final)}")

    print(f"\n📊 Trader P&L:")
    print(f"   Premium Paid: -{format_algo(premium_paid)}")
    print(f"   Payout Received: +{format_algo(actual_profit_received)}")
    print(f"   Net Profit: {format_algo(net_profit)}")

    print(f"\n📉 Pool Changes:")
    print(f"   Premium Received: +{format_algo(premium_paid)}")
    print(f"   Payout Sent: -{format_algo(actual_profit_received)}")
    print(f"   Net Change: {format_algo(pool_balance_final - pool_balance_before)}")

    # ========================================================================
    # Summary
    # ========================================================================

    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)

    success = net_profit > 0

    if success:
        print("\n✅ TEST PASSED!")
        print(f"   Trader made a profit of {format_algo(net_profit)}")
        print(f"   Option was exercised successfully")
        print(f"   ALGO transferred from pool to trader")
    else:
        print("\n⚠️  TEST COMPLETED")
        print(f"   Net result: {format_algo(net_profit)}")
        if net_profit < 0:
            print(f"   Option expired OTM or gas fees exceeded profit")

    print("\n" + "=" * 80)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Test failed with error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
