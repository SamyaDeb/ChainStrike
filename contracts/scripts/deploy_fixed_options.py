"""
Deploy ONLY the fixed OptionsPool and OptionsMarket contracts.

These contracts have been updated with cross-contract calls for proper
premium accounting (receive_premium and pay_settlement).

Reuses existing:
- Oracle (758189767)
- Staking (758189780)
- StrikeToken (758189778)
"""

import base64
import json
import math
import os
import ssl
import time
from pathlib import Path

from algosdk import account, mnemonic, transaction, abi
from algosdk.v2client import algod
from algosdk.logic import get_application_address
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    AccountTransactionSigner,
)

# Fix SSL
import urllib.request

ssl_context = ssl._create_unverified_context()
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context)))

# Configuration
TESTNET_ALGOD = "https://testnet-api.algonode.cloud"

# Use trader account which has more spendable balance
DEPLOYER_MNEMONIC = os.getenv(
    "DEPLOYER_MNEMONIC",
    # Fallback to admin mnemonic
    "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss",
)

CONTRACTS_DIR = Path(__file__).parent.parent

# Existing contracts to reuse
EXISTING = {
    "oracle": 758189767,
    "staking": 758189780,
    "strike_token": 758189778,
}


class FixedOptionsDeployer:
    def __init__(self):
        self.client = algod.AlgodClient("", TESTNET_ALGOD)
        self.pk = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
        self.addr = account.address_from_private_key(self.pk)
        self.signer = AccountTransactionSigner(self.pk)
        self.app_ids = EXISTING.copy()
        self.asset_ids = {}

        print(f"\n{'=' * 60}")
        print("🔧 Deploy Fixed Options Contracts")
        print(f"{'=' * 60}")
        print(f"Deployer: {self.addr}")

    def check_balance(self):
        info = self.client.account_info(self.addr)
        amount = info["amount"]
        min_bal = info["min-balance"]
        spendable = amount - min_bal
        print(f"Balance: {amount / 1e6:.2f} ALGO")
        print(f"Min Balance: {min_bal / 1e6:.2f} ALGO")
        print(f"Spendable: {spendable / 1e6:.2f} ALGO")
        return spendable

    def wait(self, txid, timeout=15):
        start = time.time()
        while time.time() - start < timeout:
            try:
                info = self.client.pending_transaction_info(txid)
                if info.get("confirmed-round", 0) > 0:
                    return info
            except Exception:
                pass
            time.sleep(0.5)
        raise Exception(f"Tx {txid} not confirmed in {timeout}s")

    def compile_teal(self, source: str) -> bytes:
        result = self.client.compile(source)
        return base64.b64decode(result["result"])

    def sp(self):
        return self.client.suggested_params()

    def deploy_contract(self, name: str, approval_file: str, clear_file: str) -> int:
        print(f"\n📦 Deploying {name}...")

        approval_teal = (CONTRACTS_DIR / approval_file).read_text()
        clear_teal = (CONTRACTS_DIR / clear_file).read_text()

        approval_bin = self.compile_teal(approval_teal)
        clear_bin = self.compile_teal(clear_teal)

        total_size = len(approval_bin) + len(clear_bin)
        extra_pages = max(0, (total_size - 2048 + 2047) // 2048)
        extra_pages = min(extra_pages, 3)

        print(f"   Approval: {len(approval_bin)} bytes, Extra pages: {extra_pages}")

        sp = self.sp()
        sp.flat_fee = True
        sp.fee = 2000

        # Use actual schema from ARC56
        # OptionsPool: 14 ints, 3 bytes
        # OptionsMarket: 17 ints, 4 bytes
        if "Pool" in name:
            global_schema = transaction.StateSchema(num_uints=14, num_byte_slices=3)
        else:
            global_schema = transaction.StateSchema(num_uints=18, num_byte_slices=5)

        local_schema = transaction.StateSchema(num_uints=0, num_byte_slices=0)

        txn = transaction.ApplicationCreateTxn(
            sender=self.addr,
            sp=sp,
            on_complete=transaction.OnComplete.NoOpOC,
            approval_program=approval_bin,
            clear_program=clear_bin,
            global_schema=global_schema,
            local_schema=local_schema,
            extra_pages=extra_pages,
        )

        signed = txn.sign(self.pk)
        txid = self.client.send_transaction(signed)
        result = self.wait(txid)
        app_id = result["application-index"]

        print(f"   ✅ App ID: {app_id}")
        return app_id

    def fund_app(self, app_id: int, amount: int):
        app_addr = get_application_address(app_id)
        sp = self.sp()
        txn = transaction.PaymentTxn(self.addr, sp, app_addr, amount)
        signed = txn.sign(self.pk)
        txid = self.client.send_transaction(signed)
        self.wait(txid)
        print(f"   💰 Funded with {amount / 1e6:.2f} ALGO")

    def _build_contract_from_arc56(self, arc56_data, name):
        methods = []
        for m in arc56_data.get("methods", []):
            args = []
            for a in m.get("args", []):
                args.append(abi.Argument(a["type"], a.get("name", "")))
            returns = abi.Returns(m.get("returns", {}).get("type", "void"))
            methods.append(abi.Method(m["name"], args, returns, m.get("desc", "")))
        return abi.Contract(name, methods)

    def initialize_pool(self, pool_id: int, market_addr: str):
        """Initialize OptionsPool with market and staking addresses."""
        print(f"\n⚙️  Initializing Options Pool...")

        staking_addr = get_application_address(EXISTING["staking"])

        arc56 = json.loads((CONTRACTS_DIR / "OptionsPool.arc56.json").read_text())
        contract = self._build_contract_from_arc56(arc56, "OptionsPool")

        sp = self.sp()
        sp.flat_fee = True
        sp.fee = 2000

        atc = AtomicTransactionComposer()
        atc.add_method_call(
            app_id=pool_id,
            method=contract.get_method_by_name("initialize"),
            sender=self.addr,
            sp=sp,
            signer=self.signer,
            method_args=[market_addr, staking_addr],
        )

        result = atc.execute(self.client, 10)
        if result.abi_results and result.abi_results[0].return_value:
            lp_token = int(result.abi_results[0].return_value)
            print(f"   ✅ LP Token ASA: {lp_token}")
            return lp_token
        print("   ✅ Initialized")
        return None

    def initialize_market(self, market_id: int, pool_id: int):
        """Initialize OptionsMarket with oracle, pool, staking, and app IDs."""
        print(f"\n⚙️  Initializing Options Market...")

        oracle_addr = get_application_address(EXISTING["oracle"])
        pool_addr = get_application_address(pool_id)
        staking_addr = get_application_address(EXISTING["staking"])

        arc56 = json.loads((CONTRACTS_DIR / "OptionsMarket.arc56.json").read_text())
        contract = self._build_contract_from_arc56(arc56, "OptionsMarket")

        sp = self.sp()
        sp.flat_fee = True
        sp.fee = 2000

        atc = AtomicTransactionComposer()
        atc.add_method_call(
            app_id=market_id,
            method=contract.get_method_by_name("initialize"),
            sender=self.addr,
            sp=sp,
            signer=self.signer,
            method_args=[
                oracle_addr,
                pool_addr,
                staking_addr,
                EXISTING["oracle"],  # oracle_app_id
                pool_id,  # options_pool_app_id (NEW!)
            ],
            foreign_apps=[EXISTING["oracle"], pool_id],
        )

        atc.execute(self.client, 10)
        print(f"   ✅ Initialized with oracle_app={EXISTING['oracle']}, pool_app={pool_id}")

    def set_min_expiry(self, market_id: int):
        """Set minimum expiry to 300 seconds (5 minutes)."""
        print(f"\n⚙️  Setting min expiry to 300 seconds...")

        arc56 = json.loads((CONTRACTS_DIR / "OptionsMarket.arc56.json").read_text())
        contract = self._build_contract_from_arc56(arc56, "OptionsMarket")

        sp = self.sp()
        sp.flat_fee = True
        sp.fee = 2000

        atc = AtomicTransactionComposer()
        atc.add_method_call(
            app_id=market_id,
            method=contract.get_method_by_name("set_expiry_limits"),
            sender=self.addr,
            sp=sp,
            signer=self.signer,
            method_args=[300, 2592000],  # 5 min to 30 days
        )

        atc.execute(self.client, 10)
        print(f"   ✅ Min expiry set to 300 seconds")

    def save_config(self):
        print(f"\n💾 Saving configuration...")

        timestamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())

        # Update deployed_addresses.json
        output = {
            "network": "testnet",
            "deployer": self.addr,
            "timestamp": timestamp,
            "contracts": self.app_ids,
            "assets": self.asset_ids,
            "note": "Fixed options contracts with cross-contract premium accounting",
        }

        addr_path = CONTRACTS_DIR / "deployed_addresses.json"
        addr_path.write_text(json.dumps(output, indent=2))
        print(f"   ✅ {addr_path}")

        # Update frontend deployed-contracts.ts
        frontend_dir = CONTRACTS_DIR.parent / "frontend"
        dc_path = frontend_dir / "src" / "config" / "deployed-contracts.ts"

        dc_content = f"""/**
 * ChainStrike Deployed Contract Addresses
 * Auto-generated by deployment script
 * Network: TestNet
 * Deployed: {timestamp}
 * 
 * FIXED: Options contracts now use cross-contract calls for proper
 * premium accounting (receive_premium and pay_settlement).
 */

export const DEPLOYED_CONTRACTS = {{
  oracle: {self.app_ids.get("oracle", 0)},
  strikeToken: {self.app_ids.get("strike_token", 0)},
  staking: {self.app_ids.get("staking", 0)},
  optionsPool: {self.app_ids.get("options_pool", 0)},
  optionsMarket: {self.app_ids.get("options_market", 0)},
  perpsPool: {self.app_ids.get("perps_pool", 0)},
  perpsMarket: {self.app_ids.get("perps_market", 0)},
}} as const;

export type ContractName = keyof typeof DEPLOYED_CONTRACTS;
"""
        dc_path.write_text(dc_content)
        print(f"   ✅ {dc_path}")

        # Update contracts.ts
        ct_path = frontend_dir / "src" / "config" / "contracts.ts"
        if ct_path.exists():
            import re

            content = ct_path.read_text()

            updates = {
                "optionsPool": self.app_ids.get("options_pool"),
                "optionsMarket": self.app_ids.get("options_market"),
            }

            for key, new_id in updates.items():
                if new_id:
                    pattern = rf"({key}:\s*{{\s*appId:\s*)\d+"
                    content = re.sub(pattern, rf"\g<1>{new_id}", content)

            ct_path.write_text(content)
            print(f"   ✅ {ct_path}")

    def run(self):
        spendable = self.check_balance()

        if spendable < 3_000_000:  # Need ~3 ALGO
            print(f"\n❌ Need at least 3 ALGO spendable. Have {spendable / 1e6:.2f}")
            print("   Fund the account or use a different deployer.")
            return False

        print(f"\n📋 Deployment Plan:")
        print(f"   1. Deploy OptionsPool (FIXED)")
        print(f"   2. Deploy OptionsMarket (FIXED)")
        print(f"   3. Fund both contracts")
        print(f"   4. Initialize pool (creates LP token)")
        print(f"   5. Initialize market (with pool app ID)")
        print(f"   6. Set min expiry to 300 seconds")

        try:
            # 1. Deploy OptionsPool
            self.app_ids["options_pool"] = self.deploy_contract(
                "Options Pool (FIXED)",
                "OptionsPool.approval.teal",
                "OptionsPool.clear.teal",
            )
            self.fund_app(self.app_ids["options_pool"], 500_000)

            # 2. Deploy OptionsMarket
            self.app_ids["options_market"] = self.deploy_contract(
                "Options Market (FIXED)",
                "OptionsMarket.approval.teal",
                "OptionsMarket.clear.teal",
            )
            self.fund_app(self.app_ids["options_market"], 500_000)

            # 3. Initialize pool
            market_addr = get_application_address(self.app_ids["options_market"])
            lp_token = self.initialize_pool(self.app_ids["options_pool"], market_addr)
            if lp_token:
                self.asset_ids["options_lp"] = lp_token

            # 4. Initialize market
            self.initialize_market(
                self.app_ids["options_market"],
                self.app_ids["options_pool"],
            )

            # 5. Set min expiry
            self.set_min_expiry(self.app_ids["options_market"])

            # Keep perps contracts from previous deployment
            self.app_ids["perps_pool"] = 758190050
            self.app_ids["perps_market"] = 758190064

            # Save config
            self.save_config()

            print(f"\n{'=' * 60}")
            print("🎉 Deployment Complete!")
            print(f"{'=' * 60}")
            print(f"\n📦 Contract Summary:")
            for name, app_id in self.app_ids.items():
                print(f"   {name:20s}: {app_id}")

            if self.asset_ids:
                print(f"\n🪙 Assets:")
                for name, asset_id in self.asset_ids.items():
                    if asset_id:
                        print(f"   {name:20s}: {asset_id}")

            info = self.client.account_info(self.addr)
            print(f"\n💰 Remaining: {info['amount'] / 1e6:.2f} ALGO")

            print(f"\n✅ Ready for testing!")
            print(f"   Run: python3 scripts/test_options_trading.py")

            return True

        except Exception as e:
            print(f"\n❌ Deployment failed: {e}")
            import traceback

            traceback.print_exc()
            return False


if __name__ == "__main__":
    FixedOptionsDeployer().run()
