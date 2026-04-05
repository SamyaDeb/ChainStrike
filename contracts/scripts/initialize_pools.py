"""
Initialize deployed pool contracts.
Must be run after deployment to set up LP tokens and cross-references.
"""

import base64
import ssl
import urllib.request
from pathlib import Path

from algosdk import account, mnemonic, transaction
from algosdk.v2client import algod
from algosdk.logic import get_application_address

# Fix SSL
ssl_context = ssl._create_unverified_context()
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context)))

TESTNET_ALGOD = "https://testnet-api.algonode.cloud"
DEPLOYER_MNEMONIC = "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss"

# Deployed contracts - Updated to latest deployment
CONTRACTS = {
    "oracle": 758290477,
    "strike_token": 758290478,
    "staking": 758290479,
    "options_pool": 758290646,
    "options_market": 758290651,
    "perps_pool": 758290663,
    "perps_market": 758290831,
}


def get_method_selector(signature: str) -> bytes:
    """Get ABI method selector (first 4 bytes of SHA-512/256 hash)."""
    import hashlib

    h = hashlib.new("sha512_256")
    h.update(signature.encode())
    return h.digest()[:4]


class PoolInitializer:
    def __init__(self):
        self.client = algod.AlgodClient("", TESTNET_ALGOD)
        self.private_key = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
        self.address = account.address_from_private_key(self.private_key)

        print(f"🔑 Deployer: {self.address}")
        account_info = self.client.account_info(self.address)
        print(f"💰 Balance: {account_info['amount'] / 1_000_000:.2f} ALGO")

    def wait_for_confirmation(self, txid: str) -> dict:
        last_round = self.client.status().get("last-round")
        while True:
            txinfo = self.client.pending_transaction_info(txid)
            if txinfo.get("confirmed-round", 0) > 0:
                return txinfo
            if txinfo.get("pool-error"):
                raise Exception(f"Transaction error: {txinfo['pool-error']}")
            self.client.status_after_block(last_round + 1)
            last_round += 1

    def fund_app_for_mbr(self, app_id: int, amount: int = 200_000):
        """Fund app to cover MBR for creating LP token."""
        app_address = get_application_address(app_id)
        sp = self.client.suggested_params()

        txn = transaction.PaymentTxn(
            sender=self.address,
            sp=sp,
            receiver=app_address,
            amt=amount,
        )

        signed = txn.sign(self.private_key)
        txid = self.client.send_transaction(signed)
        self.wait_for_confirmation(txid)
        print(f"   💰 Funded {app_id} with {amount / 1_000_000:.2f} ALGO for MBR")

    def initialize_options_pool(self):
        """Initialize the Options Pool contract."""
        print("\n📦 Initializing Options Pool...")

        app_id = CONTRACTS["options_pool"]
        options_market_addr = get_application_address(CONTRACTS["options_market"])
        staking_addr = get_application_address(CONTRACTS["staking"])

        # Fund for MBR first
        self.fund_app_for_mbr(app_id)

        # Method selector for "initialize(address,address)uint64"
        method_selector = get_method_selector("initialize(address,address)uint64")

        # Encode addresses (32 bytes each)
        from algosdk.encoding import decode_address

        options_market_bytes = decode_address(options_market_addr)
        staking_bytes = decode_address(staking_addr)

        sp = self.client.suggested_params()

        txn = transaction.ApplicationCallTxn(
            sender=self.address,
            sp=sp,
            index=app_id,
            on_complete=transaction.OnComplete.NoOpOC,
            app_args=[method_selector, options_market_bytes, staking_bytes],
        )

        signed = txn.sign(self.private_key)
        txid = self.client.send_transaction(signed)
        result = self.wait_for_confirmation(txid)

        # Extract LP token ID from logs
        if "logs" in result and result["logs"]:
            # ABI returns uint64 as 8 bytes
            lp_token_id = int.from_bytes(base64.b64decode(result["logs"][-1])[-8:], "big")
            print(f"   ✅ Options Pool initialized! LP Token ID: {lp_token_id}")
            return lp_token_id
        else:
            print(f"   ✅ Options Pool initialized!")
            return None

    def initialize_perps_pool(self):
        """Initialize the Perpetuals Pool contract."""
        print("\n📦 Initializing Perpetuals Pool...")

        app_id = CONTRACTS["perps_pool"]
        perps_market_addr = get_application_address(CONTRACTS["perps_market"])
        staking_addr = get_application_address(CONTRACTS["staking"])

        # Fund for MBR first
        self.fund_app_for_mbr(app_id)

        # Method selector for "initialize(address,address)uint64"
        method_selector = get_method_selector("initialize(address,address)uint64")

        from algosdk.encoding import decode_address

        perps_market_bytes = decode_address(perps_market_addr)
        staking_bytes = decode_address(staking_addr)

        sp = self.client.suggested_params()

        txn = transaction.ApplicationCallTxn(
            sender=self.address,
            sp=sp,
            index=app_id,
            on_complete=transaction.OnComplete.NoOpOC,
            app_args=[method_selector, perps_market_bytes, staking_bytes],
        )

        signed = txn.sign(self.private_key)
        txid = self.client.send_transaction(signed)
        result = self.wait_for_confirmation(txid)

        if "logs" in result and result["logs"]:
            lp_token_id = int.from_bytes(base64.b64decode(result["logs"][-1])[-8:], "big")
            print(f"   ✅ Perpetuals Pool initialized! LP Token ID: {lp_token_id}")
            return lp_token_id
        else:
            print(f"   ✅ Perpetuals Pool initialized!")
            return None

    def run(self):
        print("\n" + "=" * 60)
        print("🚀 Pool Contract Initialization")
        print("=" * 60)

        try:
            options_lp = self.initialize_options_pool()
            perps_lp = self.initialize_perps_pool()

            print("\n" + "=" * 60)
            print("🎉 INITIALIZATION COMPLETE")
            print("=" * 60)

            if options_lp:
                print(f"   Options LP Token: {options_lp}")
            if perps_lp:
                print(f"   Perps LP Token: {perps_lp}")

            print("\n📝 Next Steps:")
            print("   1. Test pool deposits in frontend")
            print("   2. Users need to opt-in to LP tokens to receive shares")

        except Exception as e:
            print(f"\n❌ Initialization failed: {e}")
            import traceback

            traceback.print_exc()


if __name__ == "__main__":
    initializer = PoolInitializer()
    initializer.run()
