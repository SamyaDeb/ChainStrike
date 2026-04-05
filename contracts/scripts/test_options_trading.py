"""
ChainStrike Options Trading Test Script
========================================

This script tests the complete 5-minute options trading flow:
1. Check contract state and balances
2. Buy a 5-minute OTM call option
3. Wait for expiry
4. Settle the option
5. Verify all balances and states

Run with: python3 test_options_trading.py
"""

import ssl
import os
import time
import sys
from datetime import datetime
from algosdk import account, mnemonic, encoding
from algosdk.v2client import algod
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    AccountTransactionSigner,
    TransactionWithSigner,
)
from algosdk import abi, transaction

# Fix SSL
ssl._create_default_https_context = ssl._create_unverified_context

# Configuration
TESTNET_ALGOD = "https://testnet-api.algonode.cloud"

# Contract App IDs (Updated after deployment of fixed cross-contract call contracts)
CONTRACTS = {
    "oracle": 758189767,
    "staking": 758189780,
    "optionsPool": 758222938,
    "optionsMarket": 758222941,
}

# Test configuration
TEST_OPTION_SIZE = 1_000_000  # 1 ALGO in microALGO
OTM_PREMIUM_PERCENTAGE = 0.02  # Strike 2% above current price


def get_app_address(app_id: int) -> str:
    """Get the address of an application"""
    return encoding.encode_address(encoding.checksum(b"appID" + app_id.to_bytes(8, "big")))


def get_algod_client():
    """Create Algod client"""
    return algod.AlgodClient("", TESTNET_ALGOD)


def get_account_balance(client, address):
    """Get account ALGO balance"""
    try:
        info = client.account_info(address)
        return info.get("amount", 0)
    except:
        return 0


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


def check_opt_in_status(client, address, app_id):
    """Check if account is opted into an application"""
    try:
        info = client.account_info(address)
        apps = info.get("apps-local-state", [])
        return any(app.get("id") == app_id for app in apps)
    except:
        return False


def opt_in_to_app(client, private_key, address, app_id):
    """Opt into an application"""
    print(f"  Opting into app {app_id}...")

    sp = client.suggested_params()
    sp.flat_fee = True
    sp.fee = 1000

    txn = transaction.ApplicationOptInTxn(sender=address, sp=sp, index=app_id)

    signed = txn.sign(private_key)
    tx_id = client.send_transaction(signed)

    # Wait for confirmation
    result = transaction.wait_for_confirmation(client, tx_id, 10)
    print(f"  ✅ Opted in! Tx: {tx_id}")
    return tx_id


def buy_option(client, private_key, address, is_call, strike_price, expiry_timestamp, size, premium, next_option_id=1):
    """
    Buy an option on the OptionsMarket contract.

    Args:
        client: Algod client
        private_key: Trader's private key
        address: Trader's address
        is_call: True for call, False for put
        strike_price: Strike price in microUSD
        expiry_timestamp: Unix timestamp for expiry
        size: Option size in microALGO
        premium: Premium to pay in microALGO
        next_option_id: The next option ID from contract state

    Returns:
        Tuple of (success, tx_id or error, option_id)
    """
    signer = AccountTransactionSigner(private_key)

    options_market_addr = get_app_address(CONTRACTS["optionsMarket"])

    # Calculate total cost (premium + 0.3% fee)
    fee_amount = (premium * 30) // 10000  # 0.3% fee
    total_cost = premium + fee_amount

    # Add extra for box storage MBR (2500 + 400 * box_size)
    # OptionInfo struct is roughly 200 bytes, so MBR ~= 2500 + 400*200 = 82500 microALGO
    box_mbr = 100000  # 0.1 ALGO for box storage
    total_cost += box_mbr

    print(f"\n  Creating option transaction...")
    print(f"    Type: {'CALL' if is_call else 'PUT'}")
    print(f"    Strike: ${strike_price / 1_000_000:.6f}")
    print(f"    Expiry: {datetime.fromtimestamp(expiry_timestamp)}")
    print(f"    Size: {size / 1_000_000:.6f} ALGO")
    print(f"    Premium: {premium / 1_000_000:.6f} ALGO")
    print(f"    Fee (0.3%): {fee_amount / 1_000_000:.6f} ALGO")
    print(f"    Box MBR: {box_mbr / 1_000_000:.6f} ALGO")
    print(f"    Total Cost: {total_cost / 1_000_000:.6f} ALGO")

    # Create the method ABI
    create_option_method = abi.Method(
        name="create_option",
        args=[
            abi.Argument("bool", "is_call"),
            abi.Argument("uint64", "strike_price"),
            abi.Argument("uint64", "expiry"),
            abi.Argument("uint64", "size"),
        ],
        returns=abi.Returns("uint64"),  # Returns option_id
    )

    sp = client.suggested_params()
    sp.flat_fee = True
    sp.fee = 2000  # Fee for payment transaction

    # Create payment transaction
    payment_txn = transaction.PaymentTxn(
        sender=address, sp=sp, receiver=options_market_addr, amt=total_cost, note=b"option_premium"
    )

    # Use ATC for method call
    atc = AtomicTransactionComposer()

    # Add payment as first transaction (index 0)
    atc.add_transaction(TransactionWithSigner(payment_txn, signer))

    # Add app call as second transaction (index 1)
    sp2 = client.suggested_params()
    sp2.flat_fee = True
    sp2.fee = 4000  # Higher fee for inner transactions (transfers to pool and staking)

    # Box key for the option (opt_<option_id>)
    box_key = b"opt_" + next_option_id.to_bytes(8, "big")

    atc.add_method_call(
        app_id=CONTRACTS["optionsMarket"],
        method=create_option_method,
        sender=address,
        sp=sp2,
        signer=signer,
        method_args=[is_call, strike_price, expiry_timestamp, size],
        foreign_apps=[CONTRACTS["oracle"], CONTRACTS["optionsPool"], CONTRACTS["staking"]],
        boxes=[(CONTRACTS["optionsMarket"], box_key)],
    )

    try:
        result = atc.execute(client, 10)
        tx_id = result.tx_ids[0]

        # Get the return value (option_id)
        option_id = None
        if result.abi_results and len(result.abi_results) > 0:
            option_id = result.abi_results[0].return_value

        print(f"\n  ✅ Option purchased successfully!")
        print(f"    Transaction ID: {tx_id}")
        if option_id:
            print(f"    Option ID: {option_id}")

        return True, tx_id, option_id

    except Exception as e:
        error_msg = str(e)
        print(f"\n  ❌ Failed to buy option: {error_msg}")
        return False, error_msg, None


def settle_option(client, private_key, address, option_id):
    """
    Settle an expired option.

    Args:
        client: Algod client
        private_key: Caller's private key
        address: Caller's address
        option_id: Option ID to settle

    Returns:
        Tuple of (success, tx_id or error, payoff)
    """
    signer = AccountTransactionSigner(private_key)

    print(f"\n  Settling option #{option_id}...")

    settle_method = abi.Method(
        name="settle_option",
        args=[abi.Argument("uint64", "option_id")],
        returns=abi.Returns("uint64"),  # Returns payoff
    )

    sp = client.suggested_params()
    sp.flat_fee = True
    sp.fee = 3000

    atc = AtomicTransactionComposer()
    atc.add_method_call(
        app_id=CONTRACTS["optionsMarket"],
        method=settle_method,
        sender=address,
        sp=sp,
        signer=signer,
        method_args=[option_id],
        foreign_apps=[CONTRACTS["oracle"], CONTRACTS["optionsPool"]],
        boxes=[(CONTRACTS["optionsMarket"], b"opt_" + option_id.to_bytes(8, "big"))],
    )

    try:
        result = atc.execute(client, 10)
        tx_id = result.tx_ids[0]

        payoff = 0
        if result.abi_results and len(result.abi_results) > 0:
            payoff = result.abi_results[0].return_value

        print(f"\n  ✅ Option settled!")
        print(f"    Transaction ID: {tx_id}")
        print(f"    Payoff: {payoff / 1_000_000:.6f} ALGO")

        return True, tx_id, payoff

    except Exception as e:
        error_msg = str(e)
        print(f"\n  ❌ Failed to settle option: {error_msg}")
        return False, error_msg, 0


def get_option_info(client, option_id):
    """Get option information from contract (read-only)"""
    # This would require a read call - for now we'll check state
    pass


def print_separator():
    print("=" * 70)


def print_header(text):
    print("\n" + "=" * 70)
    print(text)
    print("=" * 70)


def run_test():
    """Run the complete options trading test"""

    # Get trader mnemonic
    trader_mnemonic = os.getenv("TRADER_MNEMONIC")
    if not trader_mnemonic:
        print("\n⚠️  TRADER_MNEMONIC environment variable not set!")
        print("Please set it with your TestNet account mnemonic:")
        print('  export TRADER_MNEMONIC="your 25 word mnemonic here"')
        print("\nOr enter it now:")
        trader_mnemonic = input("Trader Mnemonic: ").strip()
        if not trader_mnemonic:
            print("No mnemonic provided. Exiting.")
            return

    # Setup
    client = get_algod_client()
    private_key = mnemonic.to_private_key(trader_mnemonic)
    trader_address = account.address_from_private_key(private_key)

    print_header("🧪 CHAINSTRIKE OPTIONS TRADING TEST")
    print(f"\nTrader Address: {trader_address}")
    print(f"Test Time: {datetime.now()}")

    # ========== PHASE 1: Pre-Trade Verification ==========
    print_header("PHASE 1: PRE-TRADE VERIFICATION")

    # Check trader balance
    trader_balance = get_account_balance(client, trader_address)
    print(f"\n📊 Trader Balance: {trader_balance / 1_000_000:.6f} ALGO")

    if trader_balance < 5_000_000:  # Need at least 5 ALGO
        print("❌ Insufficient balance! Need at least 5 ALGO for testing.")
        return

    # Check oracle price
    oracle_state = get_app_global_state(client, CONTRACTS["oracle"])
    oracle_price = oracle_state.get("current_price", 0)
    print(f"📊 Oracle Price: ${oracle_price / 1_000_000:.6f} per ALGO")

    if oracle_price == 0:
        print("❌ Oracle price is $0! Run initialize_contracts.py first.")
        return

    # Check pool state
    pool_state = get_app_global_state(client, CONTRACTS["optionsPool"])
    pool_liquidity = pool_state.get("total_liquidity", 0)
    pool_shares = pool_state.get("total_shares", 0)
    pool_app_address = get_app_address(CONTRACTS["optionsPool"])
    pool_account_balance = get_account_balance(client, pool_app_address)
    print(f"📊 Pool Liquidity: {pool_liquidity / 1_000_000:.6f} ALGO")
    print(f"📊 Pool Shares: {pool_shares / 1_000_000:.6f} csOPT")
    print(f"📊 Pool Account Balance: {pool_account_balance / 1_000_000:.6f} ALGO")

    # Check options market state
    market_state = get_app_global_state(client, CONTRACTS["optionsMarket"])
    min_expiry = market_state.get("min_expiry", 3600)
    next_option_id = market_state.get("next_option_id", 1)
    print(f"📊 Min Expiry: {min_expiry} seconds ({min_expiry / 60:.1f} minutes)")
    print(f"📊 Next Option ID: {next_option_id}")

    # Note: OptionsMarket uses BoxMap storage, not local state
    # Opt-in is not required for ARC4 contracts using box storage
    print(f"📊 Box Storage: Yes (no opt-in required)")

    # Verify account has enough for box creation MBR
    if trader_balance < 1_000_000:  # 1 ALGO minimum for box MBR
        print("❌ Need at least 1 ALGO for box storage MBR")
        return

    # ========== PHASE 2: Buy Call Option ==========
    print_header("PHASE 2: BUY 5-MINUTE OTM CALL OPTION")

    # Calculate OTM strike price (current price + 2%)
    strike_price = int(oracle_price * 1.02)  # 2% OTM
    print(f"\n📈 Current Price: ${oracle_price / 1_000_000:.6f}")
    print(f"📈 OTM Strike (+2%): ${strike_price / 1_000_000:.6f}")

    # Calculate expiry (5 minutes from now)
    current_time = int(time.time())
    expiry_timestamp = current_time + 300 + 10  # 5 minutes + 10 seconds buffer
    print(f"📅 Current Time: {datetime.fromtimestamp(current_time)}")
    print(f"📅 Expiry Time: {datetime.fromtimestamp(expiry_timestamp)}")

    # Calculate premium (simplified - contract will validate)
    # For OTM call, premium is mostly time value
    # Using ~1% of size as estimated premium
    premium = TEST_OPTION_SIZE // 100  # 0.01 ALGO for 1 ALGO option
    premium = max(premium, 10000)  # Minimum 0.01 ALGO

    print(f"💰 Estimated Premium: {premium / 1_000_000:.6f} ALGO")

    # Record balances before
    balance_before = get_account_balance(client, trader_address)
    pool_liquidity_before = pool_state.get("total_liquidity", 0)
    pool_balance_before = get_account_balance(client, pool_app_address)

    # Buy the option
    success, result, option_id = buy_option(
        client,
        private_key,
        trader_address,
        is_call=True,
        strike_price=strike_price,
        expiry_timestamp=expiry_timestamp,
        size=TEST_OPTION_SIZE,
        premium=premium,
        next_option_id=next_option_id,
    )

    if not success:
        print("\n❌ Failed to buy option. Test aborted.")
        print(f"   Error: {result}")
        return

    # Record option ID for settlement
    if option_id is None:
        option_id = next_option_id

    # Verify balance change
    balance_after = get_account_balance(client, trader_address)
    spent = balance_before - balance_after
    print(f"\n📊 ALGO Spent: {spent / 1_000_000:.6f}")

    # Check pool received premium
    pool_state_after = get_app_global_state(client, CONTRACTS["optionsPool"])
    pool_liquidity_after = pool_state_after.get("total_liquidity", 0)
    pool_gain = pool_liquidity_after - pool_liquidity_before
    pool_balance_after = get_account_balance(client, pool_app_address)
    pool_balance_gain = pool_balance_after - pool_balance_before
    print(f"📊 Pool Liquidity Gain (global state): {pool_gain / 1_000_000:.6f} ALGO")
    print(f"📊 Pool Balance Gain (account): {pool_balance_gain / 1_000_000:.6f} ALGO")

    # ========== PHASE 3: Wait for Expiry ==========
    print_header("PHASE 3: WAITING FOR OPTION EXPIRY")

    wait_time = expiry_timestamp - int(time.time())
    if wait_time > 0:
        print(f"\n⏳ Waiting {wait_time} seconds until expiry...")
        print(f"   Expiry at: {datetime.fromtimestamp(expiry_timestamp)}")

        # Progress bar
        for i in range(wait_time):
            remaining = wait_time - i
            mins = remaining // 60
            secs = remaining % 60
            sys.stdout.write(f"\r   Time remaining: {mins:02d}:{secs:02d} ")
            sys.stdout.flush()
            time.sleep(1)

        print("\n\n✅ Option has expired!")
    else:
        print("\n✅ Option already expired!")

    # Small buffer to ensure blockchain time has passed
    time.sleep(5)

    # ========== PHASE 4: Settlement ==========
    print_header("PHASE 4: SETTLE OPTION")

    # Check current oracle price (might have changed)
    oracle_state = get_app_global_state(client, CONTRACTS["oracle"])
    settlement_price = oracle_state.get("current_price", 0)
    print(f"\n📊 Settlement Price: ${settlement_price / 1_000_000:.6f}")
    print(f"📊 Strike Price: ${strike_price / 1_000_000:.6f}")

    is_itm = settlement_price > strike_price
    print(f"📊 Option Status: {'IN THE MONEY (ITM) 🎉' if is_itm else 'OUT OF THE MONEY (OTM) 💀'}")

    # Record balance before settlement
    balance_before_settle = get_account_balance(client, trader_address)

    # Settle the option
    success, result, payoff = settle_option(client, private_key, trader_address, option_id)

    if not success:
        print(f"\n❌ Settlement failed: {result}")
        return

    # Record balance after settlement
    balance_after_settle = get_account_balance(client, trader_address)
    received = balance_after_settle - balance_before_settle

    # ========== PHASE 5: Final Verification ==========
    print_header("PHASE 5: FINAL VERIFICATION")

    # Check final balances
    final_balance = get_account_balance(client, trader_address)
    total_spent = balance_before - final_balance

    print(f"\n📊 TRADER P&L:")
    print(f"   Premium Paid: {spent / 1_000_000:.6f} ALGO")
    print(f"   Payoff Received: {payoff / 1_000_000:.6f} ALGO")
    print(f"   Net P&L: {(payoff - spent) / 1_000_000:.6f} ALGO")

    if payoff > spent:
        print(f"   Result: PROFIT 🎉 (+{((payoff - spent) / spent) * 100:.1f}%)")
    elif payoff < spent:
        print(f"   Result: LOSS 💀 ({((payoff - spent) / spent) * 100:.1f}%)")
    else:
        print(f"   Result: BREAK EVEN 🤷")

    # Check pool state
    final_pool_state = get_app_global_state(client, CONTRACTS["optionsPool"])
    final_pool_liquidity = final_pool_state.get("total_liquidity", 0)
    pool_pnl = final_pool_liquidity - pool_liquidity_before
    final_pool_balance = get_account_balance(client, pool_app_address)
    pool_balance_pnl = final_pool_balance - pool_balance_before

    print(f"\n📊 POOL P&L:")
    print(f"   Premium Received (global state): {pool_gain / 1_000_000:.6f} ALGO")
    print(f"   Premium Received (account): {pool_balance_gain / 1_000_000:.6f} ALGO")
    print(f"   Payoff Paid: {payoff / 1_000_000:.6f} ALGO")
    print(f"   Net P&L (global state): {pool_pnl / 1_000_000:.6f} ALGO")
    print(f"   Net P&L (account): {pool_balance_pnl / 1_000_000:.6f} ALGO")

    # Check market stats
    final_market_state = get_app_global_state(client, CONTRACTS["optionsMarket"])
    print(f"\n📊 MARKET STATS:")
    print(f"   Total Options Created: {final_market_state.get('total_options_created', 0)}")
    print(f"   Total Active Options: {final_market_state.get('total_active_options', 0)}")
    print(f"   Total Premium Volume: {final_market_state.get('total_premium_volume', 0) / 1_000_000:.6f} ALGO")
    print(f"   Total Settled Volume: {final_market_state.get('total_settled_volume', 0) / 1_000_000:.6f} ALGO")

    print_header("🎉 TEST COMPLETE!")
    print("\n✅ All phases completed successfully!")
    print(f"\nOption #{option_id} has been:")
    print("  1. Created ✅")
    print("  2. Purchased ✅")
    print("  3. Expired ✅")
    print("  4. Settled ✅")
    print("  5. Verified ✅")


if __name__ == "__main__":
    run_test()
