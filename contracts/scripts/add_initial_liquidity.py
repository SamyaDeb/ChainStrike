"""
Add initial liquidity to pools so trading can work.
"""

import base64
import ssl
import urllib.request
from pathlib import Path

from algosdk import account, mnemonic, transaction
from algosdk.v2client import algod
from algosdk.logic import get_application_address
from algosdk import encoding

# Fix SSL
ssl_context = ssl._create_unverified_context()
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context)))

TESTNET_ALGOD = "https://testnet-api.algonode.cloud"
DEPLOYER_MNEMONIC = "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss"

# Deployed contracts
CONTRACTS = {
    "oracle": 758290477,
    "strike_token": 758290478,
    "staking": 758290479,
    "options_pool": 758290646,
    "options_market": 758290651,
    "perps_pool": 758290663,
    "perps_market": 758290831,
}

# LP Token IDs
LP_TOKENS = {
    "options": 758299080,
    "perps": 758290870,
}


def get_method_selector(signature: str) -> bytes:
    """Get ABI method selector (first 4 bytes of SHA-512/256 hash)."""
    import hashlib

    h = hashlib.new("sha512_256")
    h.update(signature.encode())
    return h.digest()[:4]


class LiquidityAdder:
    def __init__(self):
        self.client = algod.AlgodClient("", TESTNET_ALGOD)
        self.private_key = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
        self.address = account.address_from_private_key(self.private_key)

        print(f"🔑 Depositor: {self.address}")
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

    def opt_into_lp_token(self, token_id: int):
        """Opt into LP token ASA."""
        print(f"   🔄 Opting into LP token {token_id}...")

        # Check if already opted in
        account_info = self.client.account_info(self.address)
        assets = account_info.get("assets", [])
        for asset in assets:
            if asset["asset-id"] == token_id:
                print(f"   ✅ Already opted into LP token {token_id}")
                return

        sp = self.client.suggested_params()
        txn = transaction.AssetTransferTxn(
            sender=self.address,
            sp=sp,
            receiver=self.address,
            amt=0,
            index=token_id,
        )

        signed = txn.sign(self.private_key)
        txid = self.client.send_transaction(signed)
        self.wait_for_confirmation(txid)
        print(f"   ✅ Opted into LP token {token_id}")

    def deposit_to_options_pool(self, amount_algo: float):
        """Deposit ALGO to Options Pool."""
        print(f"\n💧 Depositing {amount_algo} ALGO to Options Pool...")

        pool_app_id = CONTRACTS["options_pool"]
        pool_address = get_application_address(pool_app_id)
        lp_token_id = LP_TOKENS["options"]
        staking_address = get_application_address(CONTRACTS["staking"])

        # Opt into LP token first
        self.opt_into_lp_token(lp_token_id)

        amount_micro = int(amount_algo * 1_000_000)
        sp = self.client.suggested_params()

        # Transaction 0: Payment to pool
        payment_txn = transaction.PaymentTxn(
            sender=self.address,
            sp=sp,
            receiver=pool_address,
            amt=amount_micro,
            note=b"pool_deposit",
        )

        # Transaction 1: App call to deposit
        # Method: deposit()uint64
        method_selector = get_method_selector("deposit()uint64")

        # Box reference for LP position: "olp_" + sender_address (32 bytes)
        box_prefix = b"olp_"
        sender_bytes = encoding.decode_address(self.address)
        box_name = box_prefix + sender_bytes

        app_call_txn = transaction.ApplicationCallTxn(
            sender=self.address,
            sp=sp,
            index=pool_app_id,
            on_complete=transaction.OnComplete.NoOpOC,
            app_args=[method_selector],
            accounts=[staking_address],
            foreign_assets=[lp_token_id],
            boxes=[(pool_app_id, box_name)],
            note=b"ChainStrike:Deposit",
        )

        # Group transactions
        gid = transaction.calculate_group_id([payment_txn, app_call_txn])
        payment_txn.group = gid
        app_call_txn.group = gid

        # Sign
        signed_payment = payment_txn.sign(self.private_key)
        signed_app_call = app_call_txn.sign(self.private_key)

        # Send
        txid = self.client.send_transactions([signed_payment, signed_app_call])
        result = self.wait_for_confirmation(txid)

        print(f"   ✅ Deposited {amount_algo} ALGO to Options Pool")
        print(f"   📝 TxID: {txid}")

    def deposit_to_perps_pool(self, amount_algo: float):
        """Deposit ALGO to Perpetuals Pool."""
        print(f"\n💧 Depositing {amount_algo} ALGO to Perps Pool...")

        pool_app_id = CONTRACTS["perps_pool"]
        pool_address = get_application_address(pool_app_id)
        lp_token_id = LP_TOKENS["perps"]
        staking_address = get_application_address(CONTRACTS["staking"])

        # Opt into LP token first
        self.opt_into_lp_token(lp_token_id)

        amount_micro = int(amount_algo * 1_000_000)
        sp = self.client.suggested_params()

        # Transaction 0: Payment to pool
        payment_txn = transaction.PaymentTxn(
            sender=self.address,
            sp=sp,
            receiver=pool_address,
            amt=amount_micro,
            note=b"pool_deposit",
        )

        # Transaction 1: App call to deposit
        # Method: deposit()uint64
        method_selector = get_method_selector("deposit()uint64")

        # Box reference for LP position: "plp_" + sender_address (32 bytes)
        box_prefix = b"plp_"
        sender_bytes = encoding.decode_address(self.address)
        box_name = box_prefix + sender_bytes

        app_call_txn = transaction.ApplicationCallTxn(
            sender=self.address,
            sp=sp,
            index=pool_app_id,
            on_complete=transaction.OnComplete.NoOpOC,
            app_args=[method_selector],
            accounts=[staking_address],
            foreign_assets=[lp_token_id],
            boxes=[(pool_app_id, box_name)],
            note=b"ChainStrike:Deposit",
        )

        # Group transactions
        gid = transaction.calculate_group_id([payment_txn, app_call_txn])
        payment_txn.group = gid
        app_call_txn.group = gid

        # Sign
        signed_payment = payment_txn.sign(self.private_key)
        signed_app_call = app_call_txn.sign(self.private_key)

        # Send
        txid = self.client.send_transactions([signed_payment, signed_app_call])
        result = self.wait_for_confirmation(txid)

        print(f"   ✅ Deposited {amount_algo} ALGO to Perps Pool")
        print(f"   📝 TxID: {txid}")

    def run(self, options_amount: float = 1000, perps_amount: float = 2000):
        print("\n" + "=" * 60)
        print("💧 Adding Initial Liquidity to Pools")
        print("=" * 60)

        try:
            self.deposit_to_options_pool(options_amount)
            self.deposit_to_perps_pool(perps_amount)

            print("\n" + "=" * 60)
            print("🎉 LIQUIDITY ADDED SUCCESSFULLY")
            print("=" * 60)
            print(f"   Options Pool: +{options_amount} ALGO")
            print(f"   Perps Pool: +{perps_amount} ALGO")
            print("\n✅ Trading should now work on the frontend!")

        except Exception as e:
            print(f"\n❌ Failed to add liquidity: {e}")
            import traceback

            traceback.print_exc()


if __name__ == "__main__":
    import sys

    # Parse command line args
    options_amt = float(sys.argv[1]) if len(sys.argv) > 1 else 1000
    perps_amt = float(sys.argv[2]) if len(sys.argv) > 2 else 2000

    adder = LiquidityAdder()
    adder.run(options_amt, perps_amt)
