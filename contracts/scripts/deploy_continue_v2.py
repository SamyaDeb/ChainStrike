"""
Continue deployment from where it stopped.
Already deployed: oracle, strike_token, staking, options_pool, options_market, perps_pool
Need to deploy: perps_market only
"""

import base64
import json
import os
import ssl
import time
import re
from pathlib import Path

from algosdk import account, mnemonic, transaction
from algosdk.v2client import algod
from algosdk.logic import get_application_address
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    AccountTransactionSigner,
)
from algosdk import abi

# Fix SSL
import urllib.request

ssl_context = ssl._create_unverified_context()
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context)))

# ====== CONFIG ======
TESTNET_ALGOD = "https://testnet-api.algonode.cloud"
DEPLOYER_MNEMONIC = os.getenv(
    "DEPLOYER_MNEMONIC",
    "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss",
)

CONTRACTS_DIR = Path(__file__).parent.parent
BUILD_DIR = CONTRACTS_DIR / ".build"
FRONTEND_DIR = CONTRACTS_DIR.parent / "frontend"

# Already deployed contracts
ALREADY_DEPLOYED = {
    "oracle": 758290477,
    "strike_token": 758290478,
    "staking": 758290479,
    "options_pool": 758290646,
    "options_market": 758290651,
    "perps_pool": 758290663,
}

# Contracts still to deploy - only perps_market remaining
REMAINING_CONTRACTS = [
    ("perps_market", "perpetuals_market.py", "PerpetualsMarket"),
]


class ContinueDeployer:
    def __init__(self):
        self.client = algod.AlgodClient("", TESTNET_ALGOD)
        self.pk = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
        self.addr = account.address_from_private_key(self.pk)
        self.signer = AccountTransactionSigner(self.pk)
        self.app_ids = ALREADY_DEPLOYED.copy()
        self.asset_ids = {}

    def sp(self):
        return self.client.suggested_params()

    def _sp_with_fee(self, fee: int):
        sp = self.sp()
        sp.flat_fee = True
        sp.fee = fee
        return sp

    def wait(self, txid, timeout=20):
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

    def balance(self):
        info = self.client.account_info(self.addr)
        return info["amount"]

    def compile_teal(self, source: str) -> bytes:
        result = self.client.compile(source)
        return base64.b64decode(result["result"])

    def _build_contract_from_arc56(self, arc56: dict, name: str) -> abi.Contract:
        """Build ABI Contract from ARC56 JSON."""
        methods = []
        for m in arc56.get("methods", []):
            args = [abi.Argument(a["type"], a.get("name", "")) for a in m.get("args", [])]
            returns = abi.Returns(m["returns"]["type"]) if m.get("returns") else abi.Returns("void")
            methods.append(abi.Method(m["name"], args, returns, m.get("desc", "")))
        return abi.Contract(name, methods)

    def compile_remaining(self):
        print("\n🔨 Compiling remaining contracts with puyapy...")
        import subprocess

        BUILD_DIR.mkdir(exist_ok=True)

        for name, source_file, class_name in REMAINING_CONTRACTS:
            src = CONTRACTS_DIR / source_file
            out = BUILD_DIR / name
            out.mkdir(parents=True, exist_ok=True)

            result = subprocess.run(
                ["puyapy", str(src), "--output-teal", "--out-dir", str(out)],
                capture_output=True,
                text=True,
                timeout=60,
            )

            approval_path = out / f"{class_name}.approval.teal"
            clear_path = out / f"{class_name}.clear.teal"

            if result.returncode != 0 or not approval_path.exists():
                print(f"  ❌ {name}: COMPILATION FAILED")
                if result.stderr:
                    for line in result.stderr.strip().split("\n")[-5:]:
                        print(f"     {line}")
                raise Exception(f"Compilation failed for {name}")

            a_size = approval_path.stat().st_size
            c_size = clear_path.stat().st_size
            print(f"  ✅ {name:20s} approval={a_size:>6} bytes  clear={c_size:>4} bytes")

    def deploy_remaining(self):
        print("\n🚀 Deploying remaining contracts to TestNet...")

        for name, source_file, class_name in REMAINING_CONTRACTS:
            out = BUILD_DIR / name
            approval_teal = (out / f"{class_name}.approval.teal").read_text()
            clear_teal = (out / f"{class_name}.clear.teal").read_text()

            approval_bin = self.compile_teal(approval_teal)
            clear_bin = self.compile_teal(clear_teal)

            total_size = len(approval_bin) + len(clear_bin)
            extra_pages = max(0, (total_size - 2048 + 2047) // 2048)
            if extra_pages > 3:
                extra_pages = 3

            sp = self.sp()
            sp.flat_fee = True
            sp.fee = 2000

            txn = transaction.ApplicationCreateTxn(
                sender=self.addr,
                sp=sp,
                on_complete=transaction.OnComplete.NoOpOC,
                approval_program=approval_bin,
                clear_program=clear_bin,
                global_schema=transaction.StateSchema(num_uints=32, num_byte_slices=16),
                local_schema=transaction.StateSchema(num_uints=8, num_byte_slices=4),
                extra_pages=extra_pages,
            )

            signed = txn.sign(self.pk)
            txid = self.client.send_transaction(signed)
            result = self.wait(txid)
            app_id = result["application-index"]
            self.app_ids[name] = app_id
            pages_str = f" (+{extra_pages} pages)" if extra_pages > 0 else ""
            print(f"  ✅ {name:20s} → App ID {app_id}  [{len(approval_bin)}B{pages_str}]")
            time.sleep(0.3)

    def fund_apps(self):
        print("\n💰 Funding apps for MBR + inner transactions...")

        amounts = {
            "oracle": 300_000,
            "strike_token": 500_000,
            "staking": 500_000,
            "options_pool": 1_000_000,  # More for LP ASA creation + inner txns
            "options_market": 1_000_000,  # More for Model 1 fee routing + boxes
            "perps_pool": 1_000_000,
            "perps_market": 1_000_000,  # More for Model 1 fee routing + boxes
        }

        for name, app_id in self.app_ids.items():
            amt = amounts.get(name, 500_000)
            app_addr = get_application_address(app_id)
            sp = self.sp()
            txn = transaction.PaymentTxn(self.addr, sp, app_addr, amt)
            signed = txn.sign(self.pk)
            txid = self.client.send_transaction(signed)
            self.wait(txid)
            print(f"  ✅ {name:20s} funded with {amt / 1e6:.1f} ALGO")
            time.sleep(0.2)

    def initialize_contracts(self):
        print("\n⚙️  Initializing contracts (only perps_market is new)...")

        oracle_id = self.app_ids["oracle"]
        staking_id = self.app_ids["staking"]
        perp_pool_id = self.app_ids["perps_pool"]
        perp_market_id = self.app_ids["perps_market"]

        oracle_addr = get_application_address(oracle_id)
        staking_addr = get_application_address(staking_id)
        perp_pool_addr = get_application_address(perp_pool_id)
        perp_market_addr = get_application_address(perp_market_id)

        # Re-initialize Perps Pool with the NEW perps_market address
        print("  ⏳ Perps Pool: Re-initializing with new Perps Market...")
        try:
            arc56 = json.loads((BUILD_DIR / "perps_pool" / "PerpetualsPool.arc56.json").read_text())
            contract = self._build_contract_from_arc56(arc56, "PerpetualsPool")

            atc = AtomicTransactionComposer()
            atc.add_method_call(
                app_id=perp_pool_id,
                method=contract.get_method_by_name("initialize"),
                sender=self.addr,
                sp=self._sp_with_fee(3000),
                signer=self.signer,
                method_args=[perp_market_addr, staking_addr],
            )
            result = atc.execute(self.client, 10)
            if result.abi_results and result.abi_results[0].return_value is not None:
                self.asset_ids["perps_lp"] = int(result.abi_results[0].return_value)
                print(f"  ✅ Perps Pool re-initialized: LP token ASA {self.asset_ids['perps_lp']}")
            else:
                print(f"  ✅ Perps Pool re-initialized")
        except Exception as e:
            # If already initialized, that's fine - just log it
            if "already initialized" in str(e).lower():
                print(f"  ℹ️  Perps Pool already initialized (will update market address manually if needed)")
            else:
                print(f"  ⚠️  Perps Pool init failed: {e}")

        # Initialize the NEW Perps Market - call initialize(oracle, perps_pool, staking, oracle_app_id)
        print("  ⏳ Perps Market: Initializing...")
        try:
            arc56 = json.loads((BUILD_DIR / "perps_market" / "PerpetualsMarket.arc56.json").read_text())
            contract = self._build_contract_from_arc56(arc56, "PerpetualsMarket")

            atc = AtomicTransactionComposer()
            atc.add_method_call(
                app_id=perp_market_id,
                method=contract.get_method_by_name("initialize"),
                sender=self.addr,
                sp=self._sp_with_fee(2000),
                signer=self.signer,
                method_args=[oracle_addr, perp_pool_addr, staking_addr, oracle_id],
                foreign_apps=[oracle_id],
            )
            atc.execute(self.client, 10)
            print(f"  ✅ Perps Market initialized")
        except Exception as e:
            print(f"  ⚠️  Perps Market init failed: {e}")

        # Update Oracle price (always safe to do)
        print("  ⏳ Oracle: Updating price...")
        try:
            arc56 = json.loads((BUILD_DIR / "oracle" / "Oracle.arc56.json").read_text())
            contract = self._build_contract_from_arc56(arc56, "Oracle")

            atc = AtomicTransactionComposer()
            atc.add_method_call(
                app_id=oracle_id,
                method=contract.get_method_by_name("update_price"),
                sender=self.addr,
                sp=self._sp_with_fee(2000),
                signer=self.signer,
                method_args=[250000],  # $0.25 in microUSD
            )
            atc.execute(self.client, 10)
            print(f"  ✅ Oracle price set to $0.25")
        except Exception as e:
            print(f"  ⚠️  Oracle price update failed: {e}")

    def save_config(self):
        print("\n📝 Updating configuration files...")

        # Save deployed_addresses.json
        deployed = {
            "network": "testnet",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "contracts": {
                name: {
                    "app_id": app_id,
                    "address": get_application_address(app_id),
                }
                for name, app_id in self.app_ids.items()
            },
            "assets": self.asset_ids,
        }

        addr_path = CONTRACTS_DIR / "deployed_addresses.json"
        addr_path.write_text(json.dumps(deployed, indent=2))
        print(f"  ✅ {addr_path}")

        # Update frontend contracts.ts
        ct_path = FRONTEND_DIR / "src" / "config" / "contracts.ts"
        if ct_path.exists():
            content = ct_path.read_text()

            # Update app IDs
            app_mappings = {
                "oracle": "oracle",
                "strike_token": "strikeToken",
                "staking": "staking",
                "options_pool": "optionsPool",
                "options_market": "optionsMarket",
                "perps_pool": "perpsPool",
                "perps_market": "perpsMarket",
            }

            for internal_name, ts_name in app_mappings.items():
                if internal_name in self.app_ids:
                    new_id = self.app_ids[internal_name]
                    # Match: optionsMarket: {\n      appId: NUMBER,
                    content = re.sub(
                        rf"({ts_name}:\s*\{{\s*\n\s*appId:\s*)\d+(\s*,)",
                        rf"\g<1>{new_id}\2",
                        content,
                        count=0,
                    )

            # Update asset IDs
            if self.asset_ids.get("strike"):
                content = re.sub(r"(strike:\s*\{\s*\n\s*id:\s*)\d+", rf"\g<1>{self.asset_ids['strike']}", content)
            if self.asset_ids.get("options_lp"):
                content = re.sub(
                    r"(optionsLP:\s*\{\s*\n\s*id:\s*)\d+", rf"\g<1>{self.asset_ids['options_lp']}", content
                )
            if self.asset_ids.get("perps_lp"):
                content = re.sub(r"(perpsLP:\s*\{\s*\n\s*id:\s*)\d+", rf"\g<1>{self.asset_ids['perps_lp']}", content)

            ct_path.write_text(content)
            print(f"  ✅ {ct_path}")

    def run(self):
        print("=" * 60)
        print("🚀 ChainStrike Deployment Continuation")
        print("=" * 60)
        print(f"Deployer: {self.addr}")
        print(f"Balance:  {self.balance() / 1e6:.2f} ALGO")
        print(f"\nAlready deployed:")
        for name, app_id in ALREADY_DEPLOYED.items():
            print(f"  {name:20s}: {app_id}")

        self.compile_remaining()
        self.deploy_remaining()
        self.fund_apps()
        self.initialize_contracts()
        self.save_config()

        print("\n" + "=" * 60)
        print("🎉 Deployment Complete!")
        print("=" * 60)
        print("\n📦 Contract Summary:")
        for name, app_id in self.app_ids.items():
            addr = get_application_address(app_id)
            print(f"  {name:20s}: {app_id} ({addr[:8]}...)")
        if self.asset_ids:
            print("\n🪙 Asset Summary:")
            for name, asset_id in self.asset_ids.items():
                if asset_id:
                    print(f"  {name:20s}: {asset_id}")

        print(f"\n💰 Remaining balance: {self.balance() / 1e6:.2f} ALGO")
        print("\n✅ Ready for end-to-end testing!")


if __name__ == "__main__":
    ContinueDeployer().run()
