#!/usr/bin/env python3
"""
ChainStrike Real-Time Trading Test
===================================

Complete end-to-end test with REAL-TIME ALGO prices:
1. Fetch real ALGO price from Binance/CoinGecko
2. Update oracle with real prices
3. Trader buys 1-minute CALL option
4. Wait for expiry
5. Settle option with current market price
6. Verify trader receives profit in wallet balance

Usage: python3 realtime_trading_test.py
"""

import ssl
import time
import sys
import json
import asyncio
import aiohttp
import math
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

# Price Sources
BINANCE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=ALGOUSDT"
COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=algorand&vs_currencies=usd"

# Volatility parameters
DEFAULT_IV = 0.80  # 80% implied volatility for ALGO (typical for crypto)
SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60  # ~31,557,600 seconds

# ============================================================================
# Volatility-Based Strike Calculation
# ============================================================================


def calculate_expected_move(price: float, iv: float, expiry_seconds: int) -> float:
    """
    Calculate expected price move using volatility formula.

    Formula: Expected Move = Price × IV × √(Time in Years)

    Args:
        price: Current price in USD
        iv: Implied volatility (e.g., 0.80 for 80%)
        expiry_seconds: Time to expiry in seconds

    Returns:
        Expected 1-sigma move in USD
    """
    time_in_years = expiry_seconds / SECONDS_PER_YEAR
    return price * iv * math.sqrt(time_in_years)


def get_strike_step_multiplier(expiry_seconds: int) -> float:
    """
    Get appropriate strike step multiplier based on timeframe.

    Shorter timeframes use smaller steps for tighter strike grids.
    Longer timeframes use larger steps for wider strike grids.
    """
    if expiry_seconds <= 60:  # 1 minute or less
        return 0.25  # 0.25 sigma steps
    elif expiry_seconds <= 300:  # 5 minutes
        return 0.33  # 0.33 sigma steps
    elif expiry_seconds <= 3600:  # 1 hour
        return 0.5  # 0.5 sigma steps
    elif expiry_seconds <= 86400:  # 1 day
        return 0.75  # 0.75 sigma steps
    else:  # > 1 day
        return 1.0  # 1 sigma steps


def calculate_volatility_strike(
    current_price: float, expiry_seconds: int, sigma_multiple: float = 0.3, is_call: bool = True, iv: float = DEFAULT_IV
) -> tuple:
    """
    Calculate a strike price based on volatility and expected move.

    Args:
        current_price: Current spot price in USD
        expiry_seconds: Time to expiry in seconds
        sigma_multiple: How many standard deviations from spot (e.g., 0.3 = 0.3σ OTM)
        is_call: True for call (strike above spot for OTM), False for put
        iv: Implied volatility

    Returns:
        Tuple of (strike_price, expected_move, move_percentage)
    """
    expected_move = calculate_expected_move(current_price, iv, expiry_seconds)
    move_percentage = (expected_move / current_price) * 100

    # For calls: OTM means strike > spot, ITM means strike < spot
    # For puts: OTM means strike < spot, ITM means strike > spot
    if is_call:
        # Positive sigma_multiple = OTM call (above spot)
        # Negative sigma_multiple = ITM call (below spot)
        strike = current_price + (expected_move * sigma_multiple)
    else:
        # Positive sigma_multiple = OTM put (below spot)
        # Negative sigma_multiple = ITM put (above spot)
        strike = current_price - (expected_move * sigma_multiple)

    return strike, expected_move, move_percentage


def print_expected_move_stats(current_price: float, expiry_seconds: int, iv: float = DEFAULT_IV):
    """Print expected move statistics for the given parameters."""
    expected_move = calculate_expected_move(current_price, iv, expiry_seconds)
    move_pct = (expected_move / current_price) * 100
    step_mult = get_strike_step_multiplier(expiry_seconds)

    print(f"\n   VOLATILITY-BASED STRIKE ANALYSIS:")
    print(f"   ----------------------------------------")
    print(f"   Current Price:    ${current_price:.6f}")
    print(f"   Implied Vol (IV): {iv * 100:.0f}%")
    print(f"   Time to Expiry:   {expiry_seconds}s ({expiry_seconds / 60:.1f} min)")
    print(f"   ----------------------------------------")
    print(f"   Expected 1σ Move: ${expected_move:.6f} (±{move_pct:.3f}%)")
    print(f"   Strike Step:      {step_mult}σ = ±{move_pct * step_mult:.4f}%")
    print(f"   ----------------------------------------")
    print(
        f"   68% chance price stays within: ${current_price - expected_move:.6f} - ${current_price + expected_move:.6f}"
    )
    print(
        f"   95% chance price stays within: ${current_price - 2 * expected_move:.6f} - ${current_price + 2 * expected_move:.6f}"
    )


# ============================================================================
# Real-Time Price Functions
# ============================================================================


async def fetch_binance_price() -> float:
    """Fetch ALGO/USD price from Binance"""
    try:
        connector = aiohttp.TCPConnector(ssl=False)
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.get(BINANCE_URL, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return float(data["price"])
    except Exception as e:
        print(f"   Binance fetch error: {e}")
    return 0.0


async def fetch_coingecko_price() -> float:
    """Fetch ALGO/USD price from CoinGecko"""
    try:
        connector = aiohttp.TCPConnector(ssl=False)
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.get(COINGECKO_URL, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return float(data["algorand"]["usd"])
    except Exception as e:
        print(f"   CoinGecko fetch error: {e}")
    return 0.0


async def get_realtime_algo_price() -> tuple:
    """Get real-time ALGO price from multiple sources"""
    print("\n   Fetching real-time ALGO price...")

    binance_price, coingecko_price = await asyncio.gather(fetch_binance_price(), fetch_coingecko_price())

    prices = []
    if binance_price > 0:
        prices.append(binance_price)
        print(f"   Binance:   ${binance_price:.6f}")
    if coingecko_price > 0:
        prices.append(coingecko_price)
        print(f"   CoinGecko: ${coingecko_price:.6f}")

    if not prices:
        raise Exception("Could not fetch price from any source!")

    # Use average of available prices
    avg_price = sum(prices) / len(prices)
    print(f"   Average:   ${avg_price:.6f}")

    return avg_price, binance_price, coingecko_price


def get_realtime_price_sync() -> tuple:
    """Synchronous wrapper for getting real-time price"""
    return asyncio.run(get_realtime_algo_price())


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


def format_usd(price_micro: int) -> str:
    """Format microUSD as USD"""
    return f"${price_micro / 1_000_000:.6f}"


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


def update_oracle_with_realtime_price(client, deployer_address: str, deployer_key: str) -> int:
    """Update oracle with real-time ALGO price from exchanges"""
    avg_price, binance_price, coingecko_price = get_realtime_price_sync()

    # Convert to microUSD (6 decimals)
    binance_micro = int(binance_price * 1_000_000) if binance_price > 0 else 0
    coingecko_micro = int(coingecko_price * 1_000_000) if coingecko_price > 0 else 0
    avg_micro = int(avg_price * 1_000_000)

    print(f"\n   Updating oracle with real-time price: ${avg_price:.6f}")

    oracle_abi = load_abi("Oracle")
    if not oracle_abi:
        raise Exception("Failed to load Oracle ABI")

    params = client.suggested_params()
    params.flat_fee = True
    params.fee = 2000

    # Try update_price with multi-source prices first
    if binance_micro > 0 and coingecko_micro > 0:
        try:
            atc = AtomicTransactionComposer()
            signer = AccountTransactionSigner(deployer_key)

            atc.add_method_call(
                app_id=CONTRACTS["oracle"],
                method=oracle_abi.get_method_by_name("update_price"),
                sender=deployer_address,
                sp=params,
                signer=signer,
                method_args=[binance_micro, coingecko_micro, binance_micro],  # Use binance for vestige
            )

            result = atc.execute(client, 4)
            print(f"   TX: {result.tx_ids[0]}")
            print(f"   Oracle updated via update_price!")
            return avg_micro
        except Exception as e:
            print(f"   update_price failed: {e}, trying emergency_set_price...")

    # Fallback to emergency_set_price
    atc = AtomicTransactionComposer()
    signer = AccountTransactionSigner(deployer_key)

    atc.add_method_call(
        app_id=CONTRACTS["oracle"],
        method=oracle_abi.get_method_by_name("emergency_set_price"),
        sender=deployer_address,
        sp=params,
        signer=signer,
        method_args=[avg_micro],
    )

    result = atc.execute(client, 4)
    print(f"   TX: {result.tx_ids[0]}")
    print(f"   Oracle updated via emergency_set_price!")
    return avg_micro


def create_option(
    client, trader_address: str, trader_key: str, is_call: bool, strike_micro: int, expiry_ts: int, size_microalgos: int
):
    """Create an option position"""
    print(f"\n   Creating {'CALL' if is_call else 'PUT'} option...")
    print(f"   Strike: {format_usd(strike_micro)}")
    print(f"   Size: {format_algo(size_microalgos)}")
    print(f"   Expiry: {datetime.fromtimestamp(expiry_ts)}")

    market_abi = load_abi("OptionsMarket")
    if not market_abi:
        raise Exception("Failed to load OptionsMarket ABI")

    signer = AccountTransactionSigner(trader_key)
    params = client.suggested_params()

    # Get premium quote
    print(f"   Getting premium quote...")

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

    premium = 0
    try:
        quote_result = atc_quote.execute(client, 4)
        if quote_result.abi_results:
            premium_quote = quote_result.abi_results[0].return_value
            if isinstance(premium_quote, (tuple, list)):
                premium = premium_quote[0]
            else:
                premium = int(premium_quote)
            print(f"   Contract premium quote: {format_algo(premium)}")
    except Exception as e:
        print(f"   Quote failed: {e}, using 2% estimate")
        premium = int(size_microalgos * 0.02)

    # Add buffer and MBR
    premium_with_fee = int(premium * 1.11)  # 10% buffer + 1% fee
    box_mbr = 100_000  # 0.1 ALGO
    total_payment = premium_with_fee + box_mbr

    print(f"   Total payment: {format_algo(total_payment)}")

    market_address = get_app_address(CONTRACTS["optionsMarket"])

    # Get next option ID for box reference
    market_state = get_global_state(client, CONTRACTS["optionsMarket"])
    next_option_id = market_state.get("next_option_id", 1)
    print(f"   Next option ID: {next_option_id}")

    box_name = b"opt_" + int(next_option_id).to_bytes(8, "big")

    atc = AtomicTransactionComposer()

    # Payment transaction (index 0)
    payment_txn = transaction.PaymentTxn(
        sender=trader_address,
        receiver=market_address,
        amt=total_payment,
        sp=params,
        note=b"option_premium",
    )
    atc.add_transaction(TransactionWithSigner(payment_txn, signer))

    # App call to create option
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
    print(f"   TX: {result.tx_ids[-1]}")

    if result.abi_results and result.abi_results[-1].return_value is not None:
        option_id = result.abi_results[-1].return_value
        print(f"   Option created! ID: {option_id}")
        return option_id, premium_with_fee

    return next_option_id, premium_with_fee


def settle_option(client, trader_address: str, trader_key: str, option_id: int):
    """Settle an expired option"""
    print(f"\n   Settling option ID {option_id}...")

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
    print(f"   TX: {result.tx_ids[0]}")

    if result.abi_results and result.abi_results[0].return_value is not None:
        payout = result.abi_results[0].return_value
        print(f"   Payout: {format_algo(payout)}")
        return payout

    return 0


# ============================================================================
# Oracle Keeper (Background Price Updates)
# ============================================================================


class OracleUpdater:
    """Continuously updates oracle with real-time prices"""

    def __init__(self, client, deployer_address: str, deployer_key: str):
        self.client = client
        self.deployer_address = deployer_address
        self.deployer_key = deployer_key
        self.running = True
        self.last_price = 0
        self.update_count = 0

    async def update_loop(self, interval: int = 10):
        """Update oracle every N seconds"""
        while self.running:
            try:
                avg_price, binance, coingecko = await get_realtime_algo_price()

                binance_micro = int(binance * 1_000_000) if binance > 0 else 0
                coingecko_micro = int(coingecko * 1_000_000) if coingecko > 0 else 0
                avg_micro = int(avg_price * 1_000_000)

                # Update oracle
                oracle_abi = load_abi("Oracle")
                params = self.client.suggested_params()
                params.flat_fee = True
                params.fee = 2000

                atc = AtomicTransactionComposer()
                signer = AccountTransactionSigner(self.deployer_key)

                if binance_micro > 0 and coingecko_micro > 0:
                    atc.add_method_call(
                        app_id=CONTRACTS["oracle"],
                        method=oracle_abi.get_method_by_name("update_price"),
                        sender=self.deployer_address,
                        sp=params,
                        signer=signer,
                        method_args=[binance_micro, coingecko_micro, binance_micro],
                    )
                else:
                    atc.add_method_call(
                        app_id=CONTRACTS["oracle"],
                        method=oracle_abi.get_method_by_name("emergency_set_price"),
                        sender=self.deployer_address,
                        sp=params,
                        signer=signer,
                        method_args=[avg_micro],
                    )

                atc.execute(self.client, 4)
                self.last_price = avg_micro
                self.update_count += 1
                print(f"\r   [Oracle] Price: ${avg_price:.6f} (update #{self.update_count})", end="", flush=True)

            except Exception as e:
                print(f"\r   [Oracle] Update error: {e}", end="", flush=True)

            await asyncio.sleep(interval)

    def stop(self):
        self.running = False


# ============================================================================
# Main Test Flow
# ============================================================================


def main():
    print("=" * 80)
    print("ChainStrike Real-Time Trading Test")
    print("=" * 80)
    print("Trading with REAL ALGO prices from Binance & CoinGecko")
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

    print(f"\n Addresses:")
    print(f"   Trader: {trader_address}")
    print(f"   Deployer: {deployer_address}")
    print(f"   Pool: {pool_address}")
    print(f"   Market: {market_address}")

    # ========================================================================
    # Step 1: Check Initial State
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 1: Check Initial Balances")
    print("=" * 80)

    trader_balance_start = get_account_balance(client, trader_address)
    pool_balance_start = get_account_balance(client, pool_address)

    print(f"\n   Trader Balance: {format_algo(trader_balance_start)}")
    print(f"   Pool Balance: {format_algo(pool_balance_start)}")

    if trader_balance_start < 5_000_000:
        print(f"\n   ERROR: Trader needs at least 5 ALGO!")
        print(f"   Fund address: {trader_address}")
        print(f"   Dispenser: https://bank.testnet.algorand.network/")
        return

    # ========================================================================
    # Step 2: Get Real-Time Price & Update Oracle
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 2: Fetch Real-Time ALGO Price & Update Oracle")
    print("=" * 80)

    current_price_micro = update_oracle_with_realtime_price(client, deployer_address, deployer_key)
    current_price_usd = current_price_micro / 1_000_000

    print(f"\n   Oracle now has real-time price: ${current_price_usd:.6f}")

    # ========================================================================
    # Step 3: Buy 1-Minute Call Option (ITM for profit)
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 3: Buy 1-Minute Call Option (Volatility-Based Strike)")
    print("=" * 80)

    option_size = 5_000_000  # 5 ALGO
    expiry_seconds = 75  # 75 seconds (> 1 min for safety)
    expiry_time = int(time.time()) + expiry_seconds

    # Show volatility-based expected move analysis
    print_expected_move_stats(current_price_usd, expiry_seconds)

    # Calculate strike using volatility formula
    # Use -0.5σ ITM for higher probability of profit (strike below spot for call)
    sigma_multiple = -0.5  # Negative = ITM for calls
    strike_usd, expected_move, move_pct = calculate_volatility_strike(
        current_price_usd, expiry_seconds, sigma_multiple=sigma_multiple, is_call=True
    )
    strike_micro = int(strike_usd * 1_000_000)

    # Calculate how much the price needs to move for profit
    itm_amount = current_price_usd - strike_usd
    itm_percentage = (itm_amount / current_price_usd) * 100

    print(f"\n   TRADE SETUP:")
    print(f"   ----------------------------------------")
    print(f"   Option Type:    CALL (bullish)")
    print(f"   Strike:         ${strike_usd:.6f} ({sigma_multiple}σ = {itm_percentage:.4f}% ITM)")
    print(f"   Position Size:  {format_algo(option_size)}")
    print(f"   Expiry:         {datetime.fromtimestamp(expiry_time)} ({expiry_seconds}s)")
    print(f"   ----------------------------------------")
    print(f"   Strategy: ITM call captures intrinsic value if price stays above strike")

    try:
        option_id, premium_paid = create_option(
            client,
            trader_address,
            trader_key,
            is_call=True,
            strike_micro=strike_micro,
            expiry_ts=expiry_time,
            size_microalgos=option_size,
        )
    except Exception as e:
        print(f"\n   Failed to create option: {e}")
        import traceback

        traceback.print_exc()
        return

    trader_balance_after_buy = get_account_balance(client, trader_address)
    actual_premium = trader_balance_start - trader_balance_after_buy

    print(f"\n   Premium Paid: {format_algo(actual_premium)}")
    print(f"   Balance After Buy: {format_algo(trader_balance_after_buy)}")

    # ========================================================================
    # Step 4: Wait for Expiry (Keep Updating Oracle with Real Prices)
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 4: Wait for Expiry (Continuous Real-Time Price Updates)")
    print("=" * 80)

    wait_seconds = expiry_time - int(time.time()) + 5  # +5s buffer
    print(f"\n   Waiting {wait_seconds} seconds for expiry...")
    print(f"   Oracle will be updated every 15 seconds with real prices")
    print()

    # Update oracle periodically during wait
    update_interval = 15
    elapsed = 0

    while elapsed < wait_seconds:
        remaining = wait_seconds - elapsed

        # Update oracle with fresh price
        if elapsed % update_interval == 0 and elapsed > 0:
            try:
                new_price = update_oracle_with_realtime_price(client, deployer_address, deployer_key)
                print(f"   [{remaining}s left] Oracle updated: ${new_price / 1_000_000:.6f}")
            except Exception as e:
                print(f"   [{remaining}s left] Oracle update failed: {e}")
        else:
            print(f"\r   {remaining}s remaining...", end="", flush=True)

        time.sleep(1)
        elapsed += 1

    print("\n\n   Option expired!")

    # Final oracle update before settlement
    print("\n   Final price update before settlement...")
    settlement_price_micro = update_oracle_with_realtime_price(client, deployer_address, deployer_key)
    settlement_price_usd = settlement_price_micro / 1_000_000

    # ========================================================================
    # Step 5: Settle Option
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 5: Settle Option & Receive Payout")
    print("=" * 80)

    strike_usd = strike_micro / 1_000_000

    # Calculate actual price movement in sigma terms
    price_change = settlement_price_usd - current_price_usd
    price_change_pct = (price_change / current_price_usd) * 100
    expected_move = calculate_expected_move(current_price_usd, DEFAULT_IV, expiry_seconds)
    sigma_move = price_change / expected_move if expected_move > 0 else 0

    print(f"\n   PRICE MOVEMENT ANALYSIS:")
    print(f"   ----------------------------------------")
    print(f"   Entry Price:      ${current_price_usd:.6f}")
    print(f"   Settlement Price: ${settlement_price_usd:.6f}")
    print(f"   Price Change:     ${price_change:+.6f} ({price_change_pct:+.4f}%)")
    print(f"   Move in Sigmas:   {sigma_move:+.2f}σ")
    print(f"   ----------------------------------------")
    print(f"   Strike Price:     ${strike_usd:.6f}")

    # Calculate expected payout
    if settlement_price_micro > strike_micro:
        # ITM: payout = (spot - strike) / spot * size
        intrinsic_value = settlement_price_micro - strike_micro
        expected_payout = int((intrinsic_value / settlement_price_micro) * option_size)
        print(f"   Option Status:    IN THE MONEY (ITM)")
        print(f"   Intrinsic Value:  ${intrinsic_value / 1_000_000:.6f}")
        print(f"   Expected Payout:  ~{format_algo(expected_payout)}")
    else:
        expected_payout = 0
        print(f"   Option Status:    OUT OF THE MONEY (OTM)")
        print(f"   Expected Payout:  0 ALGO")

    try:
        payout = settle_option(client, trader_address, trader_key, option_id)
    except Exception as e:
        print(f"\n   Settlement failed: {e}")
        import traceback

        traceback.print_exc()
        return

    # ========================================================================
    # Step 6: Final Results
    # ========================================================================

    print("\n" + "=" * 80)
    print("STEP 6: FINAL RESULTS")
    print("=" * 80)

    time.sleep(2)  # Wait for state to settle

    trader_balance_final = get_account_balance(client, trader_address)
    pool_balance_final = get_account_balance(client, pool_address)

    payout_received = trader_balance_final - trader_balance_after_buy
    net_profit = trader_balance_final - trader_balance_start

    print(f"\n   TRADER WALLET BALANCE:")
    print(f"   ----------------------------------------")
    print(f"   Before Trade:   {format_algo(trader_balance_start)}")
    print(f"   After Buy:      {format_algo(trader_balance_after_buy)}")
    print(f"   After Settle:   {format_algo(trader_balance_final)}")
    print(f"   ----------------------------------------")

    print(f"\n   P&L BREAKDOWN:")
    print(f"   ----------------------------------------")
    print(f"   Premium Paid:   -{format_algo(actual_premium)}")
    print(f"   Payout Received: +{format_algo(payout_received)}")
    print(f"   ----------------------------------------")

    if net_profit > 0:
        print(f"   NET PROFIT:     +{format_algo(net_profit)}")
        print(f"\n   RESULT: PROFITABLE TRADE!")
    elif net_profit < 0:
        print(f"   NET LOSS:       {format_algo(net_profit)}")
        print(f"\n   RESULT: LOSING TRADE")
        # Explain why short-term options are expensive
        print(f"\n   NOTE: Short-term options have high premiums relative to expected moves.")
        print(f"   For 75s options @ 80% IV, expected 1σ move is only ±{move_pct:.3f}%")
        print(f"   Profitable trades require price moves > premium percentage.")
    else:
        print(f"   NET:            {format_algo(net_profit)}")
        print(f"\n   RESULT: BREAKEVEN")

    print(f"\n   POOL IMPACT:")
    print(f"   ----------------------------------------")
    print(f"   Pool Before: {format_algo(pool_balance_start)}")
    print(f"   Pool After:  {format_algo(pool_balance_final)}")
    print(f"   Net Change:  {format_algo(pool_balance_final - pool_balance_start)}")

    # ========================================================================
    # Summary
    # ========================================================================

    print("\n" + "=" * 80)
    print("TEST COMPLETE")
    print("=" * 80)

    if payout > 0:
        print(f"\n   Trader successfully received {format_algo(payout)} payout")
        print(f"   from the liquidity pool to their wallet!")

    print(f"\n   Verify on AlgoExplorer:")
    print(f"   https://testnet.algoexplorer.io/address/{trader_address}")

    print("\n" + "=" * 80)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n   Test interrupted")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n   Test failed: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
