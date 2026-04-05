"""
ChainStrike - Update Options Market Expiry Limits

Sets the minimum expiry to 1 minute (60 seconds) to enable 1-Minute Options.

Usage:
    python update_expiry_limits.py

Environment:
    ADMIN_MNEMONIC: Admin account mnemonic (must be contract admin)
"""

import json
import os
import ssl
import certifi
from pathlib import Path

# Fix SSL certificate verification issue on macOS
import urllib.request

ssl_context = ssl._create_unverified_context()
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context)))

from algosdk import account, mnemonic, abi
from algosdk.v2client import algod
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    AccountTransactionSigner,
)

# Configuration
TESTNET_ALGOD = "https://testnet-api.algonode.cloud"
OPTIONS_MARKET_APP_ID = 758254794  # Updated deployment

# New expiry limits
MIN_EXPIRY = 60  # 1 minute (for 1-minute options)
MAX_EXPIRY = 2592000  # 30 days (unchanged)


def load_options_market_contract():
    """Load OptionsMarket ABI contract from ARC-56 JSON."""
    arc56_path = Path(__file__).parent.parent / ".build" / "options_market" / "OptionsMarket.arc56.json"
    if arc56_path.exists():
        arc56 = json.loads(arc56_path.read_text())
        methods = []
        for m in arc56.get("methods", []):
            args = [abi.Argument(a["type"], a.get("name", "")) for a in m.get("args", [])]
            returns = abi.Returns(m.get("returns", {}).get("type", "void"))
            methods.append(abi.Method(m["name"], args, returns, m.get("desc", "")))
        return abi.Contract("OptionsMarket", methods)
    raise FileNotFoundError(f"OptionsMarket ARC-56 not found at {arc56_path}")


def update_expiry_limits():
    """Update the expiry limits on the options market contract."""
    # Get admin mnemonic
    admin_mnemonic = os.getenv(
        "ADMIN_MNEMONIC",
        "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss",
    )

    client = algod.AlgodClient("", TESTNET_ALGOD)
    private_key = mnemonic.to_private_key(admin_mnemonic)
    address = account.address_from_private_key(private_key)
    signer = AccountTransactionSigner(private_key)

    print("=" * 60)
    print("ChainStrike - Update Expiry Limits")
    print("=" * 60)
    print(f"Admin Address: {address}")
    print(f"Options Market App ID: {OPTIONS_MARKET_APP_ID}")
    print(f"New Min Expiry: {MIN_EXPIRY} seconds ({MIN_EXPIRY // 60} minutes)")
    print(f"New Max Expiry: {MAX_EXPIRY} seconds ({MAX_EXPIRY // 86400} days)")
    print("=" * 60)

    # Load contract
    contract = load_options_market_contract()
    method = contract.get_method_by_name("set_expiry_limits")

    # Build transaction
    sp = client.suggested_params()
    sp.flat_fee = True
    sp.fee = 2000

    atc = AtomicTransactionComposer()
    atc.add_method_call(
        app_id=OPTIONS_MARKET_APP_ID,
        method=method,
        sender=address,
        sp=sp,
        signer=signer,
        method_args=[MIN_EXPIRY, MAX_EXPIRY],
    )

    # Execute
    try:
        result = atc.execute(client, 10)
        print(f"\n✅ Expiry limits updated successfully!")
        print(f"   Transaction ID: {result.tx_ids[0]}")
        print(f"\n   Quick Options (5-minute expiry) now enabled!")
    except Exception as e:
        print(f"\n❌ Failed to update expiry limits: {e}")
        raise


if __name__ == "__main__":
    update_expiry_limits()
