#!/usr/bin/env python3
"""
ChainStrike Profitable Trading Test
====================================

This test demonstrates a PROFITABLE options trade with REALISTIC strike prices:
- Use volatility-based strike calculation for the timeframe
- For 1-minute options: strikes within ±0.1% to ±0.5% of spot
- Wait for realistic price movement or simulate small favorable move
- Demonstrate trader receiving profit

Usage: python3 profitable_trade_test.py
"""

import ssl
import time
import sys
import json
import asyncio
import aiohttp
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

CONTRACTS = {
    "oracle": 758189767,
    "staking": 758189780,
    "optionsPool": 758222938,
    "optionsMarket": 758254794,
}

TRADER_MNEMONIC = "vacant extra will swarm love ability zone deny auto autumn outdoor swap weapon van net before version truck sister manage goose census grunt absorb sword"
DEPLOYER_MNEMONIC = "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss"

BINANCE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=ALGOUSDT"
COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=algorand&vs_currencies=usd"

# ============================================================================
# Strike Calculation & Price Movement Functions
# ============================================================================


def calculate_expected_move(price_usd: float, expiry_seconds: int, iv: float = 0.80) -> float:
    """
    Calculate expected price movement using volatility-based formula

    Expected Move = Price × IV × √(Time in Years)

    This gives us 1 standard deviation (68% confidence interval)
    """
    import math

    years_to_expiry = expiry_seconds / (365 * 24 * 60 * 60)
    expected_move = price_usd * iv * math.sqrt(years_to_expiry)
    return expected_move


def calculate_realistic_strike(
    price_usd: float, expiry_seconds: int, is_call: bool, distance_sigma: float = 0.5
) -> int:
    """
    Calculate a realistic strike price for the given timeframe

    Args:
        price_usd: Current ALGO price in USD
        expiry_seconds: Time to expiry in seconds
        is_call: True for CALL, False for PUT
        distance_sigma: How many standard deviations from spot (0.5 = half sigma)

    Returns:
        Strike price in microUSD
    """
    expected_move = calculate_expected_move(price_usd, expiry_seconds)

    # For CALL: slightly OTM (above spot) or ATM
    # For PUT: slightly OTM (below spot) or ATM
    if is_call:
        # CALL slightly OTM: spot + (0.5 sigma)
        strike_usd = price_usd + (expected_move * distance_sigma)
    else:
        # PUT slightly OTM: spot - (0.5 sigma)
        strike_usd = price_usd - (expected_move * distance_sigma)

    return int(strike_usd * 1_000_000)


def simulate_realistic_price_move(initial_price_usd: float, expiry_seconds: int, target_sigma: float = 1.5) -> int:
    """
    Simulate a realistic profitable price move for the timeframe

    For profitability: price should move MORE than the option premium
    We simulate a favorable move of ~1.5 sigma (88% probability of being within this)

    Returns:
        New price in microUSD
    """
    expected_move = calculate_expected_move(initial_price_usd, expiry_seconds)
    # Simulate a favorable move (1.5 standard deviations)
    new_price_usd = initial_price_usd + (expected_move * target_sigma)
    return int(new_price_usd * 1_000_000)


# ============================================================================
# Real-Time Price Functions
# ============================================================================


async def fetch_prices() -> tuple:
    """Fetch ALGO/USD price from Binance and CoinGecko"""

    async def fetch_binance():
        try:
            connector = aiohttp.TCPConnector(ssl=False)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.get(BINANCE_URL, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return float(data["price"])
        except:
            pass
        return 0.0

    async def fetch_coingecko():
        try:
            connector = aiohttp.TCPConnector(ssl=False)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.get(COINGECKO_URL, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return float(data["algorand"]["usd"])
        except:
            pass
        return 0.0

    binance, coingecko = await asyncio.gather(fetch_binance(), fetch_coingecko())
    prices = [p for p in [binance, coingecko] if p > 0]
    avg = sum(prices) / len(prices) if prices else 0
    return avg, binance, coingecko


def get_realtime_price() -> tuple:
    """Synchronous wrapper"""
    return asyncio.run(fetch_prices())


# ============================================================================
# Utility Functions
# ============================================================================


def get_app_address(app_id: int) -> str:
    return encoding.encode_address(encoding.checksum(b"appID" + app_id.to_bytes(8, "big")))


def get_algod_client():
    return algod.AlgodClient("", TESTNET_ALGOD)


def format_algo(microalgos: int) -> str:
    return f"{microalgos / 1_000_000:.6f} ALGO"


def format_usd(price_micro: int) -> str:
    return f"${price_micro / 1_000_000:.6f}"


def get_account_balance(client, address: str) -> int:
    try:
        info = client.account_info(address)
        return info.get("amount", 0)
    except:
        return 0


def get_global_state(client, app_id: int) -> dict:
    import base64

    try:
        app_info = client.application_info(app_id)
        state = {}
        if "params" in app_info and "global-state" in app_info["params"]:
            for item in app_info["params"]["global-state"]:
                key = base64.b64decode(item["key"]).decode("utf-8", errors="replace")
                value = item["value"]
                if value["type"] == 1:
                    val_bytes = base64.b64decode(value["bytes"])
                    state[key] = encoding.encode_address(val_bytes) if len(val_bytes) == 32 else val_bytes.hex()
                else:
                    state[key] = value["uint"]
        return state
    except Exception as e:
        return {"error": str(e)}


def load_abi(contract_name: str):
    try:
        with open(f"../{contract_name}.arc56.json", "r") as f:
            arc56 = json.load(f)
        return abi.Contract.from_json(json.dumps(arc56))
    except Exception as e:
        print(f"   Error loading ABI: {e}")
        return None


# ============================================================================
# Contract Interactions
# ============================================================================


def update_oracle(client, deployer_address: str, deployer_key: str, price_micro: int):
    """Update oracle with specific price"""
    oracle_abi = load_abi("Oracle")
    if not oracle_abi:
        raise Exception("Failed to load Oracle ABI")

    params = client.suggested_params()
    params.flat_fee = True
    params.fee = 2000

    atc = AtomicTransactionComposer()
    signer = AccountTransactionSigner(deployer_key)

    # Use emergency_set_price for direct control
    atc.add_method_call(
        app_id=CONTRACTS["oracle"],
        method=oracle_abi.get_method_by_name("emergency_set_price"),
        sender=deployer_address,
        sp=params,
        signer=signer,
        method_args=[price_micro],
    )

    result = atc.execute(client, 4)
    return result.tx_ids[0]


def create_option(
    client, trader_address: str, trader_key: str, is_call: bool, strike_micro: int, expiry_ts: int, size_microalgos: int
):
    """Create option position"""
    market_abi = load_abi("OptionsMarket")
    if not market_abi:
        raise Exception("Failed to load OptionsMarket ABI")

    signer = AccountTransactionSigner(trader_key)
    params = client.suggested_params()

    # Get premium quote
    atc_quote = AtomicTransactionComposer()
    atc_quote.add_method_call(
        app_id=CONTRACTS["optionsMarket"],
        method=market_abi.get_method_by_name("calculate_premium"),
        sender=trader_address,
        sp=params,
        signer=signer,
        method_args=[is_call, strike_micro, expiry_ts, size_microalgos],
        foreign_apps=[CONTRACTS["oracle"]],
    )

    premium = int(size_microalgos * 0.02)  # Default 2%
    try:
        quote_result = atc_quote.execute(client, 4)
        if quote_result.abi_results:
            pq = quote_result.abi_results[0].return_value
            premium = pq[0] if isinstance(pq, (tuple, list)) else int(pq)
    except:
        pass

    # Payment amount
    total_payment = int(premium * 1.11) + 100_000  # +11% buffer + MBR

    market_address = get_app_address(CONTRACTS["optionsMarket"])
    market_state = get_global_state(client, CONTRACTS["optionsMarket"])
    next_option_id = market_state.get("next_option_id", 1)
    box_name = b"opt_" + int(next_option_id).to_bytes(8, "big")

    atc = AtomicTransactionComposer()

    # Payment
    payment_txn = transaction.PaymentTxn(
        sender=trader_address,
        receiver=market_address,
        amt=total_payment,
        sp=params,
        note=b"option_premium",
    )
    atc.add_transaction(TransactionWithSigner(payment_txn, signer))

    # Create option
    params2 = client.suggested_params()
    params2.fee = 5000
    params2.flat_fee = True

    pool_address = get_app_address(CONTRACTS["optionsPool"])
    staking_address = get_app_address(CONTRACTS["staking"])

    atc.add_method_call(
        app_id=CONTRACTS["optionsMarket"],
        method=market_abi.get_method_by_name("create_option"),
        sender=trader_address,
        sp=params2,
        signer=signer,
        method_args=[is_call, strike_micro, expiry_ts, size_microalgos],
        foreign_apps=[CONTRACTS["optionsPool"], CONTRACTS["oracle"], CONTRACTS["staking"]],
        accounts=[pool_address, staking_address],
        boxes=[(CONTRACTS["optionsMarket"], box_name)],
    )

    result = atc.execute(client, 4)
    option_id = result.abi_results[-1].return_value if result.abi_results else next_option_id
    return option_id, premium, total_payment


def settle_option(client, trader_address: str, trader_key: str, option_id: int):
    """Settle expired option"""
    market_abi = load_abi("OptionsMarket")
    if not market_abi:
        raise Exception("Failed to load OptionsMarket ABI")

    atc = AtomicTransactionComposer()
    signer = AccountTransactionSigner(trader_key)
    params = client.suggested_params()
    params.fee = 5000
    params.flat_fee = True

    box_name = b"opt_" + int(option_id).to_bytes(8, "big")
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

    result = atc.execute(client, 4)
    payout = result.abi_results[0].return_value if result.abi_results else 0
    return payout


# ============================================================================
# Main Test
# ============================================================================


def main():
    print("=" * 80)
    print("ChainStrike PROFITABLE Trade Test")
    print("=" * 80)
    print()
    print("Strategy: Buy ATM CALL, then price increases = PROFIT")
    print()

    client = get_algod_client()

    # Load accounts
    trader_key = mnemonic.to_private_key(TRADER_MNEMONIC)
    trader_address = account.address_from_private_key(trader_key)
    deployer_key = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
    deployer_address = account.address_from_private_key(deployer_key)

    pool_address = get_app_address(CONTRACTS["optionsPool"])

    print(f"Trader: {trader_address}")
    print(f"Pool:   {pool_address}")

    # ========================================================================
    # Step 1: Get real price and initial balances
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 1: Initial State")
    print("=" * 80)

    trader_balance_start = get_account_balance(client, trader_address)
    pool_balance_start = get_account_balance(client, pool_address)

    print(f"\nTrader Balance: {format_algo(trader_balance_start)}")
    print(f"Pool Balance:   {format_algo(pool_balance_start)}")

    if trader_balance_start < 3_000_000:
        print(f"\nERROR: Need at least 3 ALGO. Fund: {trader_address}")
        return

    # Get real ALGO price
    avg_price, binance, coingecko = get_realtime_price()
    print(f"\nReal ALGO Price:")
    print(f"  Binance:   ${binance:.6f}")
    print(f"  CoinGecko: ${coingecko:.6f}")
    print(f"  Average:   ${avg_price:.6f}")

    # Calculate expected move for 1-minute option
    expiry_sec = 75
    expected_move = calculate_expected_move(avg_price, expiry_sec, 0.80)
    expected_move_pct = (expected_move / avg_price) * 100

    print(f"\nExpected Move for {expiry_sec}s ({expiry_sec / 60:.1f} min):")
    print(f"  1 Sigma: ±${expected_move:.6f} (±{expected_move_pct:.3f}%)")
    print(f"  This means ALGO typically moves ±{expected_move_pct:.3f}% in this timeframe")

    # ========================================================================
    # Step 2: Set initial oracle price
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 2: Set Oracle to Real Price")
    print("=" * 80)

    initial_price_micro = int(avg_price * 1_000_000)
    tx = update_oracle(client, deployer_address, deployer_key, initial_price_micro)
    print(f"\nOracle set to: ${avg_price:.6f}")
    print(f"TX: {tx}")

    # ========================================================================
    # Step 3: Buy Slightly OTM CALL option with realistic strike
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 3: Buy 1-Minute Slightly OTM CALL Option")
    print("=" * 80)

    # Calculate realistic strike using volatility-based formula
    # Slightly OTM = +0.5 sigma from spot
    # This is cheaper premium but still has good profit potential
    expiry_duration = 75  # 75 seconds

    strike_micro = calculate_realistic_strike(
        price_usd=avg_price,
        expiry_seconds=expiry_duration,
        is_call=True,
        distance_sigma=0.3,  # 0.3 sigma OTM = cheap premium, realistic for profit
    )

    strike_usd = strike_micro / 1_000_000
    strike_pct_diff = ((strike_usd - avg_price) / avg_price) * 100

    option_size = 5_000_000  # 5 ALGO
    expiry_time = int(time.time()) + expiry_duration

    print(f"\nOption Parameters (Volatility-Based Strike):")
    print(f"  Type:          CALL")
    print(f"  Spot Price:    ${avg_price:.6f}")
    print(f"  Strike:        ${strike_usd:.6f} ({strike_pct_diff:+.3f}% from spot)")
    print(f"  Moneyness:     Slightly OTM (cheaper premium)")
    print(f"  Size:          {format_algo(option_size)}")
    print(f"  Expiry:        {expiry_duration}s from now")

    expected_move = calculate_expected_move(avg_price, expiry_duration)
    print(f"\nExpected Price Movement:")
    print(f"  1σ Move: ±${expected_move:.6f} (±{(expected_move / avg_price) * 100:.3f}%)")
    print(f"  For profit, we need price > ${strike_usd:.6f} at expiry")

    try:
        option_id, premium, total_paid = create_option(
            client,
            trader_address,
            trader_key,
            is_call=True,
            strike_micro=strike_micro,
            expiry_ts=expiry_time,
            size_microalgos=option_size,
        )
        print(f"\nOption Created!")
        print(f"  ID:      {option_id}")
        print(f"  Premium: {format_algo(premium)}")
        print(f"  Total:   {format_algo(total_paid)}")
    except Exception as e:
        print(f"\nFailed: {e}")
        import traceback

        traceback.print_exc()
        return

    trader_after_buy = get_account_balance(client, trader_address)
    actual_cost = trader_balance_start - trader_after_buy
    print(f"\nActual Cost: {format_algo(actual_cost)}")
    print(f"Balance After Buy: {format_algo(trader_after_buy)}")

    # ========================================================================
    # Step 4: Wait and simulate REALISTIC price increase
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 4: Wait & Realistic Price Movement")
    print("=" * 80)

    # For profitability with 0.3σ OTM strike:
    # Price needs to move up by MORE than (0.3σ strike distance + premium)
    # We'll simulate a 1.5σ favorable move (realistic but profitable)
    settlement_price_micro = simulate_realistic_price_move(
        initial_price_usd=avg_price,
        expiry_seconds=expiry_duration,
        target_sigma=1.5,  # 1.5 sigma move = ~88% probability bound
    )

    settlement_price_usd = settlement_price_micro / 1_000_000
    actual_move_pct = ((settlement_price_usd - avg_price) / avg_price) * 100

    print(f"\nSimulated Price Movement:")
    print(f"  Entry:      ${avg_price:.6f}")
    print(f"  Settlement: ${settlement_price_usd:.6f}")
    print(f"  Change:     +{actual_move_pct:.3f}% (~1.5σ move)")
    print(f"  This is a realistic favorable move for {expiry_duration}s timeframe")

    print(f"\nWaiting for expiry...")
    wait_time = expiry_time - int(time.time()) + 3

    for i in range(wait_time):
        remaining = wait_time - i
        if remaining == 30:
            # Update price mid-way to new settlement price
            print(f"\n[{remaining}s] Updating oracle with settlement price...")
            update_oracle(client, deployer_address, deployer_key, settlement_price_micro)
            print(f"Oracle updated to: ${settlement_price_micro / 1_000_000:.6f}")
        else:
            print(f"\r{remaining}s...", end="", flush=True)
        time.sleep(1)

    print("\n\nOption Expired!")

    # Ensure final price is set
    update_oracle(client, deployer_address, deployer_key, settlement_price_micro)

    # ========================================================================
    # Step 5: Settle Option
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 5: Settle & Receive Payout")
    print("=" * 80)

    print(f"\nSettlement:")
    print(f"  Strike:     ${strike_micro / 1_000_000:.6f}")
    print(f"  Spot:       ${settlement_price_micro / 1_000_000:.6f}")
    print(f"  Move:       +{actual_move_pct:.3f}% (1.5σ)")
    print(f"  Status:     {'ITM ✓' if settlement_price_micro > strike_micro else 'OTM ✗'}")

    # Expected payout for CALL: (spot - strike) / spot * size
    if settlement_price_micro > strike_micro:
        intrinsic = settlement_price_micro - strike_micro
        expected_payout = int((intrinsic / settlement_price_micro) * option_size)
        print(f"  Expected:   ~{format_algo(expected_payout)}")
    else:
        expected_payout = 0
        print(f"  Expected:   0 ALGO (expired worthless)")

    try:
        payout = settle_option(client, trader_address, trader_key, option_id)
        print(f"\n  PAYOUT RECEIVED: {format_algo(payout)}")
    except Exception as e:
        print(f"\nSettle failed: {e}")
        import traceback

        traceback.print_exc()
        return

    # ========================================================================
    # Step 6: Final Results
    # ========================================================================

    print("\n" + "=" * 80)
    print("FINAL RESULTS")
    print("=" * 80)

    time.sleep(2)

    trader_final = get_account_balance(client, trader_address)
    pool_final = get_account_balance(client, pool_address)

    payout_received = trader_final - trader_after_buy
    net_pnl = trader_final - trader_balance_start

    print(f"\n  TRADER WALLET:")
    print(f"  ─────────────────────────────────────")
    print(f"  Start:         {format_algo(trader_balance_start)}")
    print(f"  After Buy:     {format_algo(trader_after_buy)}")
    print(f"  After Settle:  {format_algo(trader_final)}")
    print(f"  ─────────────────────────────────────")

    print(f"\n  P&L:")
    print(f"  ─────────────────────────────────────")
    print(f"  Cost (Premium): -{format_algo(actual_cost)}")
    print(f"  Payout:         +{format_algo(payout_received)}")
    print(f"  ─────────────────────────────────────")

    if net_pnl > 0:
        print(f"  NET PROFIT:     +{format_algo(net_pnl)} ✓")
        print(f"\n  PROFITABLE TRADE!")
    else:
        print(f"  NET LOSS:       {format_algo(net_pnl)}")

    print(f"\n  POOL:")
    print(f"  ─────────────────────────────────────")
    print(f"  Before:  {format_algo(pool_balance_start)}")
    print(f"  After:   {format_algo(pool_final)}")
    print(f"  Change:  {format_algo(pool_final - pool_balance_start)}")

    print("\n" + "=" * 80)
    print("TEST COMPLETE")
    print("=" * 80)

    if payout > 0:
        print(f"\nTrader received {format_algo(payout)} from pool!")
        print(f"Verify: https://testnet.algoexplorer.io/address/{trader_address}")

    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nInterrupted")
        sys.exit(1)
    except Exception as e:
        print(f"\n\nFailed: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
