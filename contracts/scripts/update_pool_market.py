#!/usr/bin/env python3
"""
Update Options Pool to use new Options Market contract
"""

import ssl

ssl._create_default_https_context = ssl._create_unverified_context

import json
from algosdk import account, mnemonic, encoding
from algosdk.v2client import algod
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    AccountTransactionSigner,
)
from algosdk import abi

TESTNET_ALGOD = "https://testnet-api.algonode.cloud"

# Contract App IDs
OPTIONS_POOL = 758222938
NEW_OPTIONS_MARKET = 758254794

DEPLOYER_MNEMONIC = "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss"


def get_app_address(app_id: int) -> str:
    return encoding.encode_address(encoding.checksum(b"appID" + app_id.to_bytes(8, "big")))


def main():
    print("Updating Options Pool to use new Options Market contract")
    print("=" * 60)

    client = algod.AlgodClient("", TESTNET_ALGOD)

    deployer_key = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
    deployer_address = account.address_from_private_key(deployer_key)

    new_market_address = get_app_address(NEW_OPTIONS_MARKET)

    print(f"Deployer: {deployer_address}")
    print(f"Pool App ID: {OPTIONS_POOL}")
    print(f"New Market App ID: {NEW_OPTIONS_MARKET}")
    print(f"New Market Address: {new_market_address}")

    # Load Pool ABI
    with open("../OptionsPool.arc56.json", "r") as f:
        arc56 = json.load(f)
    pool_abi = abi.Contract.from_json(json.dumps(arc56))

    # Call set_options_market
    atc = AtomicTransactionComposer()
    signer = AccountTransactionSigner(deployer_key)
    params = client.suggested_params()

    atc.add_method_call(
        app_id=OPTIONS_POOL,
        method=pool_abi.get_method_by_name("set_options_market"),
        sender=deployer_address,
        sp=params,
        signer=signer,
        method_args=[new_market_address],
    )

    print("\nUpdating options_market address...")
    result = atc.execute(client, 4)
    print(f"TX: {result.tx_ids[0]}")
    print("✅ Pool updated successfully!")

    # Verify
    import base64

    app_info = client.application_info(OPTIONS_POOL)
    if "params" in app_info and "global-state" in app_info["params"]:
        for item in app_info["params"]["global-state"]:
            key = base64.b64decode(item["key"]).decode("utf-8", errors="replace")
            if key == "options_market":
                val_bytes = base64.b64decode(item["value"]["bytes"])
                val = encoding.encode_address(val_bytes)
                print(f"\nVerified options_market: {val}")
                if val == new_market_address:
                    print("✅ Address matches new market!")
                else:
                    print("❌ Address mismatch!")


if __name__ == "__main__":
    main()
