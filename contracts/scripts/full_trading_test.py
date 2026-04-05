#!/usr/bin/env python3
"""
ChainStrike Full Trading Flow Test
===================================

Complete end-to-end test demonstrating:
1. Oracle price update
2. Pool liquidity check
3. Trader buys CALL option
4. Price increases (simulated)
5. Option settles ITM
6. Trader receives ALGO profit from pool

Usage: python3 full_trading_test.py
"""

import ssl
import time
import sys
import json
from datetime import datetime
from algosdk import account, mnemonic, encoding
from algosdk.v2client import algod
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    AccountTransactionSigner,
    TransactionWithSigner,
)
from algosdk import abi, transaction

# Fix SSL certificate issues on macOS
ssl._create_default_https_context = ssl._create_unverified_context

# ============================================================================
# Configuration
# ============================================================================

TESTNET_ALGOD = "https://testnet-api.algonode.cloud"

# Contract App IDs (TestNet)
CONTRACTS = {
    "oracle": 758189767,
    "staking": 758189780,
    "optionsPool": 758222938,
    "optionsMarket": 758254794,
}

# Trader account (provided mnemonic)
TRADER_MNEMONIC = "vacant extra will swarm love ability zone deny auto autumn outdoor swap weapon van net before version truck sister manage goose census grunt absorb sword"

# Deployer account (has admin access to oracle)
DEPLOYER_MNEMONIC = "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss"

# ============================================================================
# Utility Functions
# ============================================================================


def get_app_address(app_id: int) -> str:
    """Get the application escrow address"""
    return encoding.encode_address(encoding.checksum(b"appID" + app_id.to_bytes(8, "big")))


def get_algod_client():
    """Create Algod client"""
    return algod.AlgodClient("", TESTNET_ALGOD)


def format_algo(microalgos: int) -> str:
    """Format microALGOs as ALGO"""
    return f"{microalgos / 1_000_000:.6f} ALGO"


def wait_for_confirmation(client, txid, timeout=10):
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


def get_account_balance(client, address: str) -> int:
    """Get account balance in microALGOs"""
    try:
        info = client.account_info(address)
        return info.get("amount", 0)
    except:
        return 0


def get_global_state(client, app_id: int) -> dict:
    """Get application global state"""
    import base64

    try:
        app_info = client.application_info(app_id)
        state = {}
        if "params" in app_info and "global-state" in app_info["params"]:
            for item in app_info["params"]["global-state"]:
                key = base64.b64decode(item["key"]).decode("utf-8", errors="replace")
                value = item["value"]
                if value["type"] == 1:  # bytes
                    val_bytes = base64.b64decode(value["bytes"])
                    if len(val_bytes) == 32:
                        state[key] = encoding.encode_address(val_bytes)
                    else:
                        state[key] = val_bytes.hex()
                else:  # uint
                    state[key] = value["uint"]
        return state
    except Exception as e:
        return {"error": str(e)}


def load_abi(contract_name: str):
    """Load ABI from arc56.json file"""
    try:
        with open(f"../{contract_name}.arc56.json", "r") as f:
            arc56 = json.load(f)
        return abi.Contract.from_json(json.dumps(arc56))
    except Exception as e:
        print(f"   Error loading ABI for {contract_name}: {e}")
        return None


# ============================================================================
# Contract Interactions
# ============================================================================


def update_oracle_price(client, deployer_address: str, deployer_key: str, price_cents: int):
    """Update oracle with new price (deployer only)"""
    print(f"\n📊 Updating oracle price to ${price_cents / 100:.4f}...")

    oracle_abi = load_abi("Oracle")
    if not oracle_abi:
        raise Exception("Failed to load Oracle ABI")

    atc = AtomicTransactionComposer()
    signer = AccountTransactionSigner(deployer_key)
    params = client.suggested_params()

    # Try emergency_set_price first (direct admin method)
    try:
        atc.add_method_call(
            app_id=CONTRACTS["oracle"],
            method=oracle_abi.get_method_by_name("emergency_set_price"),
            sender=deployer_address,
            sp=params,
            signer=signer,
            method_args=[price_cents],
        )

        result = atc.execute(client, 4)
        print(f"   TX: {result.tx_ids[0]}")
        print(f"   ✅ Oracle price updated via emergency_set_price!")
        return result
    except Exception as e:
        print(f"   emergency_set_price failed: {e}")

    # Fallback: try update_price with 3 source prices
    atc2 = AtomicTransactionComposer()
    atc2.add_method_call(
        app_id=CONTRACTS["oracle"],
        method=oracle_abi.get_method_by_name("update_price"),
        sender=deployer_address,
        sp=params,
        signer=signer,
        method_args=[price_cents, price_cents, price_cents],  # All 3 sources same price
    )

    result = atc2.execute(client, 4)
    print(f"   TX: {result.tx_ids[0]}")
    print(f"   ✅ Oracle price updated via update_price!")
    return result


def create_option(
    client, trader_address: str, trader_key: str, is_call: bool, strike_cents: int, expiry_ts: int, size_microalgos: int
):
    """Create an option position"""
    print(f"\n🛒 Creating {'CALL' if is_call else 'PUT'} option...")
    print(f"   Strike: ${strike_cents / 100:.4f}")
    print(f"   Size: {format_algo(size_microalgos)}")
    print(f"   Expiry: {datetime.fromtimestamp(expiry_ts)}")

    market_abi = load_abi("OptionsMarket")
    if not market_abi:
        raise Exception("Failed to load OptionsMarket ABI")

    # First, calculate the premium using the contract's calculate_premium method
    print(f"\n   Getting premium quote from contract...")

    atc_quote = AtomicTransactionComposer()
    signer = AccountTransactionSigner(trader_key)
    params = client.suggested_params()

    atc_quote.add_method_call(
        app_id=CONTRACTS["optionsMarket"],
        method=market_abi.get_method_by_name("calculate_premium"),
        sender=trader_address,
        sp=params,
        signer=signer,
        method_args=[is_call, strike_cents, expiry_ts, size_microalgos],
        foreign_apps=[CONTRACTS["oracle"]],
    )

    try:
        quote_result = atc_quote.execute(client, 4)
        if quote_result.abi_results:
            premium_quote = quote_result.abi_results[0].return_value
            # PremiumQuote is a struct (premium, collateral, iv, delta)
            if isinstance(premium_quote, (tuple, list)):
                premium = premium_quote[0]
            else:
                premium = int(premium_quote)
            print(f"   Contract premium quote: {format_algo(premium)}")
    except Exception as e:
        print(f"   Quote failed: {e}, using fallback estimate")
        # Fallback: use 2% of position size
        premium = int(size_microalgos * 0.02)

    # Add 10% buffer and trading fee (0.1%)
    premium_with_fee = int(premium * 1.11)
    # Add MBR for box storage
    box_mbr = 100_000  # 0.1 ALGO for boxes
    total_payment = premium_with_fee + box_mbr

    print(f"   Total payment (with fee + MBR): {format_algo(total_payment)}")

    market_address = get_app_address(CONTRACTS["optionsMarket"])

    atc = AtomicTransactionComposer()

    # Payment for premium + MBR (must be index 0)
    payment_txn = transaction.PaymentTxn(
        sender=trader_address,
        receiver=market_address,
        amt=total_payment,
        sp=params,
        note=b"option_premium",
    )
    atc.add_transaction(TransactionWithSigner(payment_txn, signer))

    # Get next option ID from global state to create box reference
    market_state = get_global_state(client, CONTRACTS["optionsMarket"])
    next_option_id = market_state.get("next_option_id", 1)
    print(f"   Next option ID: {next_option_id}")

    # Create box name: "opt_" + uint64 option_id (big-endian)
    box_prefix = b"opt_"
    option_id_bytes = int(next_option_id).to_bytes(8, "big")
    box_name = box_prefix + option_id_bytes

    # Create option call
    params2 = client.suggested_params()
    params2.fee = 5000  # Higher fee for multiple inner transactions
    params2.flat_fee = True

    # Get staking contract address for fee transfer
    staking_address = get_app_address(CONTRACTS["staking"])
    pool_address = get_app_address(CONTRACTS["optionsPool"])

    atc.add_method_call(
        app_id=CONTRACTS["optionsMarket"],
        method=market_abi.get_method_by_name("create_option"),
        sender=trader_address,
        sp=params2,
        signer=signer,
        method_args=[is_call, strike_cents, expiry_ts, size_microalgos],
        foreign_apps=[CONTRACTS["optionsPool"], CONTRACTS["oracle"], CONTRACTS["staking"]],
        accounts=[pool_address, staking_address],
        boxes=[(CONTRACTS["optionsMarket"], box_name)],
    )

    try:
        result = atc.execute(client, 4)
        print(f"   TX: {result.tx_ids[-1]}")

        # Get option ID from return value
        if result.abi_results and result.abi_results[-1].return_value is not None:
            option_id = result.abi_results[-1].return_value
            print(f"   ✅ Option created! ID: {option_id}")
            return option_id
        print(f"   ✅ Option created!")
        return 1
    except Exception as e:
        print(f"   ❌ Failed: {e}")
        raise


def settle_option(client, trader_address: str, trader_key: str, option_id: int):
    """Settle an expired option"""
    print(f"\n💰 Settling option ID {option_id}...")

    market_abi = load_abi("OptionsMarket")
    if not market_abi:
        raise Exception("Failed to load OptionsMarket ABI")

    atc = AtomicTransactionComposer()
    signer = AccountTransactionSigner(trader_key)
    params = client.suggested_params()
    params.fee = 5000  # Higher fee for payout inner txn
    params.flat_fee = True

    # Create box reference for the option
    box_prefix = b"opt_"
    option_id_bytes = int(option_id).to_bytes(8, "big")
    box_name = box_prefix + option_id_bytes

    # Get pool and staking addresses for the payout
    pool_address = get_app_address(CONTRACTS["optionsPool"])
    staking_address = get_app_address(CONTRACTS["staking"])

    atc.add_method_call(
        app_id=CONTRACTS["optionsMarket"],
        method=market_abi.get_method_by_name("settle_option"),
        sender=trader_address,
        sp=params,
        signer=signer,
        method_args=[option_id],
        foreign_apps=[CONTRACTS["optionsPool"], CONTRACTS["oracle"], CONTRACTS["staking"]],
        accounts=[pool_address, staking_address, trader_address],
        boxes=[(CONTRACTS["optionsMarket"], box_name)],
    )

    try:
        result = atc.execute(client, 4)
        print(f"   TX: {result.tx_ids[0]}")

        # Get payout from return value
        if result.abi_results and result.abi_results[0].return_value is not None:
            payout = result.abi_results[0].return_value
            print(f"   ✅ Option settled! Payout: {format_algo(payout)}")
            return payout
        print(f"   ✅ Option settled!")
        return 0
    except Exception as e:
        print(f"   ❌ Failed: {e}")
        raise


# ============================================================================
# Main Test Flow
# ============================================================================


def main():
    print("=" * 80)
    print("ChainStrike Full Trading Flow Test")
    print("=" * 80)

    # Initialize
    client = get_algod_client()

    # Load accounts
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
    # Step 1: Check Initial State
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 1: Check Initial State")
    print("=" * 80)

    trader_balance_start = get_account_balance(client, trader_address)
    pool_balance_start = get_account_balance(client, pool_address)

    print(f"\n💰 Balances:")
    print(f"   Trader: {format_algo(trader_balance_start)}")
    print(f"   Pool: {format_algo(pool_balance_start)}")

    if trader_balance_start < 5_000_000:
        print(f"\n❌ Trader needs at least 5 ALGO!")
        print(f"   Fund address: {trader_address}")
        print(f"   Dispenser: https://bank.testnet.algorand.network/")
        return

    # Check pool state
    pool_state = get_global_state(client, CONTRACTS["optionsPool"])
    print(f"\n📊 Pool State:")
    print(f"   Total Liquidity: {format_algo(pool_state.get('total_liquidity', 0))}")

    # ========================================================================
    # Step 2: Update Oracle Price
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 2: Set Oracle Price")
    print("=" * 80)

    # Use a realistic ALGO price (~$0.22)
    initial_price_cents = 22  # $0.22

    try:
        update_oracle_price(client, deployer_address, deployer_key, initial_price_cents)
    except Exception as e:
        print(f"   ⚠️ Could not update oracle: {e}")
        print(f"   Using existing price...")

    # Verify oracle state
    oracle_state = get_global_state(client, CONTRACTS["oracle"])
    current_price = oracle_state.get("current_price", 0)  # Key is current_price not price
    print(f"\n   Oracle Price: ${current_price / 100:.4f}")

    if current_price == 0:
        print(f"   ❌ Oracle price is 0! Cannot trade.")
        return

    # ========================================================================
    # Step 3: Buy Call Option
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 3: Buy 1-Minute Call Option")
    print("=" * 80)

    # Strike at 95% of current price (slightly ITM to ensure profit)
    strike_price = int(current_price * 0.95)
    option_size = 5_000_000  # 5 ALGO
    expiry_time = int(time.time()) + 90  # 90 seconds from now

    try:
        option_id = create_option(
            client,
            trader_address,
            trader_key,
            is_call=True,
            strike_cents=strike_price,
            expiry_ts=expiry_time,
            size_microalgos=option_size,
        )
    except Exception as e:
        print(f"\n❌ Failed to create option: {e}")
        import traceback

        traceback.print_exc()
        return

    trader_balance_after_buy = get_account_balance(client, trader_address)
    premium_paid = trader_balance_start - trader_balance_after_buy

    print(f"\n💸 Premium Paid: {format_algo(premium_paid)}")
    print(f"   Trader Balance: {format_algo(trader_balance_after_buy)}")

    # ========================================================================
    # Step 4: Simulate Price Increase
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 4: Price Increase (Make Option Profitable)")
    print("=" * 80)

    # Increase price by 10% to make call option ITM
    new_price = int(current_price * 1.10)

    try:
        update_oracle_price(client, deployer_address, deployer_key, new_price)
        print(f"\n   Price Change: ${current_price / 100:.4f} → ${new_price / 100:.4f}")
        print(f"   Increase: +10%")
    except Exception as e:
        print(f"   ⚠️ Could not update price: {e}")

    # ========================================================================
    # Step 5: Wait for Expiry
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 5: Wait for Option Expiry")
    print("=" * 80)

    seconds_to_wait = max(0, expiry_time - int(time.time()) + 5)  # +5s buffer
    print(f"\n⏳ Waiting {seconds_to_wait} seconds for expiry...")

    for i in range(seconds_to_wait):
        remaining = seconds_to_wait - i
        print(f"\r   {remaining}s remaining...", end="", flush=True)
        time.sleep(1)

    print("\n   ✅ Option expired!")

    # ========================================================================
    # Step 6: Settle Option (Get Profit)
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 6: Settle Option & Receive Payout")
    print("=" * 80)

    # Expected profit calculation
    # Call payout = max(0, (spot - strike) / spot * size)
    price_diff = new_price - strike_price
    expected_payout = int((price_diff / new_price) * option_size) if price_diff > 0 else 0

    print(f"\n📈 Expected Payout:")
    print(f"   Strike: ${strike_price / 100:.4f}")
    print(f"   Settlement: ${new_price / 100:.4f}")
    print(f"   Expected: {format_algo(expected_payout)}")

    try:
        payout = settle_option(client, trader_address, trader_key, option_id)
    except Exception as e:
        print(f"\n❌ Settlement failed: {e}")
        import traceback

        traceback.print_exc()
        return

    # ========================================================================
    # Step 7: Final Results
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 7: Final Results")
    print("=" * 80)

    time.sleep(2)  # Wait for state to settle

    trader_balance_final = get_account_balance(client, trader_address)
    pool_balance_final = get_account_balance(client, pool_address)

    payout_received = trader_balance_final - trader_balance_after_buy
    net_profit = trader_balance_final - trader_balance_start

    print(f"\n💰 Final Balances:")
    print(f"   Trader: {format_algo(trader_balance_final)}")
    print(f"   Pool: {format_algo(pool_balance_final)}")

    print(f"\n📊 Trader P&L Breakdown:")
    print(f"   Initial Balance: {format_algo(trader_balance_start)}")
    print(f"   Premium Paid: -{format_algo(premium_paid)}")
    print(f"   Payout Received: +{format_algo(payout_received)}")
    print(f"   Final Balance: {format_algo(trader_balance_final)}")
    print(f"   ────────────────────")

    if net_profit > 0:
        print(f"   NET PROFIT: +{format_algo(net_profit)} ✅")
    elif net_profit < 0:
        print(f"   NET LOSS: {format_algo(net_profit)} ❌")
    else:
        print(f"   BREAKEVEN: {format_algo(net_profit)}")

    print(f"\n📉 Pool Impact:")
    print(f"   Premium Received: +{format_algo(premium_paid)}")
    print(f"   Payout Sent: -{format_algo(payout_received)}")
    print(f"   Net Change: {format_algo(pool_balance_final - pool_balance_start)}")

    # ========================================================================
    # Summary
    # ========================================================================

    print("\n" + "=" * 80)
    print("TEST COMPLETE")
    print("=" * 80)

    if net_profit > 0:
        print("\n🎉 SUCCESS! Trader profited from the options trade!")
        print(f"   The trader bought a CALL option, price went up,")
        print(f"   and received ALGO payout from the liquidity pool.")
    else:
        print("\n📝 Trade completed. Check results above.")

    print("\n" + "=" * 80)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️ Test interrupted")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Test failed: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
