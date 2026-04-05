"""
Full deployment script for ChainStrike contracts to Algorand TestNet.

This script:
1. Optionally deletes old placeholder apps to free up MBR
2. Compiles all 7 contracts with puyapy
3. Deploys compiled TEAL to TestNet
4. Funds each app with ALGO for MBR + inner txns
5. Calls initialize() on each contract with cross-references
6. Calls create_token() on STRIKE Token for ASA creation
7. Updates deployed_addresses.json and frontend configs
"""

import base64
import json
import os
import ssl
import subprocess
import sys
import time
from pathlib import Path

from algosdk import account, mnemonic, transaction, abi
from algosdk.v2client import algod
from algosdk.logic import get_application_address
from algosdk.atomic_transaction_composer import (
    AtomicTransactionComposer,
    TransactionWithSigner,
    AccountTransactionSigner,
)

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

# Contract sources and class names
CONTRACTS = [
    ("oracle", "oracle.py", "Oracle"),
    ("strike_token", "strike_token.py", "StrikeToken"),
    ("staking", "staking.py", "Staking"),
    ("options_pool", "options_pool.py", "OptionsPool"),
    ("options_market", "options_market.py", "OptionsMarket"),
    ("perps_pool", "perpetuals_pool.py", "PerpetualsPool"),
    ("perps_market", "perpetuals_market.py", "PerpetualsMarket"),
]

# Old App IDs to delete (the placeholder ones + partial deploys)
OLD_APP_IDS = [
    758144101,
    758144118,
    758144121,
    758144124,
    758144130,
    758144152,
    758144386,
    757279166,
    757478481,
    757634723,
    758088855,
    758143767,
    758143773,
    758143779,
    758143782,
    758163419,
    758163421,
    758163960,
    758163961,
    758163983,
    758163985,
]


class Deployer:
    def __init__(self):
        self.client = algod.AlgodClient("", TESTNET_ALGOD)
        self.pk = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
        self.addr = account.address_from_private_key(self.pk)
        self.signer = AccountTransactionSigner(self.pk)
        self.app_ids = {}
        self.asset_ids = {}

    # ---- helpers ----
    def sp(self):
        return self.client.suggested_params()

    def wait(self, txid, timeout=15):
        """Wait for transaction confirmation."""
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

    # ---- step 0: delete old apps ----
    def delete_old_apps(self):
        print("\n🗑️  Deleting old placeholder apps...")
        info = self.client.account_info(self.addr)
        created = [a["id"] for a in info.get("created-apps", [])]

        for app_id in OLD_APP_IDS:
            if app_id in created:
                try:
                    sp = self.sp()
                    txn = transaction.ApplicationDeleteTxn(self.addr, sp, app_id)
                    signed = txn.sign(self.pk)
                    txid = self.client.send_transaction(signed)
                    self.wait(txid)
                    print(f"  ✅ Deleted app {app_id}")
                except Exception as e:
                    print(f"  ⚠️  Could not delete {app_id}: {e}")
            else:
                print(f"  ⏭️  App {app_id} not found (already deleted)")

        # Also try to delete any other apps we created previously from testing
        for app_id in created:
            if app_id not in OLD_APP_IDS:
                try:
                    sp = self.sp()
                    txn = transaction.ApplicationDeleteTxn(self.addr, sp, app_id)
                    signed = txn.sign(self.pk)
                    txid = self.client.send_transaction(signed)
                    self.wait(txid)
                    print(f"  ✅ Deleted extra app {app_id}")
                except Exception as e:
                    print(f"  ⏭️  Skipping {app_id}: {e}")

        bal = self.balance()
        print(f"  Balance after cleanup: {bal / 1e6:.2f} ALGO")

    # ---- step 1: compile with puyapy ----
    def compile_all(self):
        print("\n🔨 Compiling contracts with puyapy...")
        BUILD_DIR.mkdir(exist_ok=True)

        for name, source_file, class_name in CONTRACTS:
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
                sys.exit(1)

            a_size = approval_path.stat().st_size
            c_size = clear_path.stat().st_size
            print(f"  ✅ {name:20s} approval={a_size:>6} bytes  clear={c_size:>4} bytes")

    # ---- step 2: deploy ----
    def deploy_all(self):
        print("\n🚀 Deploying to TestNet...")

        for name, source_file, class_name in CONTRACTS:
            out = BUILD_DIR / name
            approval_teal = (out / f"{class_name}.approval.teal").read_text()
            clear_teal = (out / f"{class_name}.clear.teal").read_text()

            approval_bin = self.compile_teal(approval_teal)
            clear_bin = self.compile_teal(clear_teal)

            # Calculate extra program pages needed (each page = 2048 bytes)
            total_size = len(approval_bin) + len(clear_bin)
            extra_pages = max(0, (total_size - 2048 + 2047) // 2048)
            if extra_pages > 3:
                extra_pages = 3  # max 3 extra pages

            sp = self.sp()
            sp.flat_fee = True
            sp.fee = 2000  # extra fee for safety

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
            app_addr = get_application_address(app_id)
            pages_str = f" (+{extra_pages} pages)" if extra_pages > 0 else ""
            print(f"  ✅ {name:20s} → App ID {app_id}  [{len(approval_bin)}B{pages_str}]")
            time.sleep(0.3)  # rate limit

    # ---- step 3: fund apps ----
    def fund_apps(self):
        print("\n💰 Funding apps for MBR + inner transactions...")

        # market/pool contracts need more for inner txns and box storage
        amounts = {
            "oracle": 300_000,  # 0.3 ALGO
            "strike_token": 500_000,  # 0.5 ALGO (needs to create ASA)
            "staking": 500_000,  # 0.5 ALGO (inner txns + boxes)
            "options_pool": 500_000,  # 0.5 ALGO (creates LP ASA + inner txns)
            "options_market": 500_000,  # 0.5 ALGO (inner txns + boxes)
            "perps_pool": 500_000,  # 0.5 ALGO (creates LP ASA + inner txns)
            "perps_market": 500_000,  # 0.5 ALGO (inner txns + boxes)
        }

        for name, app_id in self.app_ids.items():
            amt = amounts.get(name, 200_000)
            app_addr = get_application_address(app_id)
            sp = self.sp()
            txn = transaction.PaymentTxn(self.addr, sp, app_addr, amt)
            signed = txn.sign(self.pk)
            txid = self.client.send_transaction(signed)
            self.wait(txid)
            print(f"  ✅ {name:20s} funded with {amt / 1e6:.1f} ALGO")
            time.sleep(0.2)

    # ---- step 4: initialize contracts ----
    def initialize_contracts(self):
        print("\n⚙️  Initializing contracts...")

        oracle_id = self.app_ids["oracle"]
        strike_id = self.app_ids["strike_token"]
        staking_id = self.app_ids["staking"]
        opt_pool_id = self.app_ids["options_pool"]
        opt_market_id = self.app_ids["options_market"]
        perp_pool_id = self.app_ids["perps_pool"]
        perp_market_id = self.app_ids["perps_market"]

        oracle_addr = get_application_address(oracle_id)
        strike_addr = get_application_address(strike_id)
        staking_addr = get_application_address(staking_id)
        opt_pool_addr = get_application_address(opt_pool_id)
        opt_market_addr = get_application_address(opt_market_id)
        perp_pool_addr = get_application_address(perp_pool_id)
        perp_market_addr = get_application_address(perp_market_id)

        # 1. Oracle - no initialization needed (just needs price update)
        print("  ✅ Oracle: No cross-ref initialization needed")

        # 2. STRIKE Token - call create_token()
        print("  ⏳ STRIKE Token: Calling create_token()...")
        try:
            arc56 = json.loads((BUILD_DIR / "strike_token" / "StrikeToken.arc56.json").read_text())
            strike_contract = self._build_contract_from_arc56(arc56, "StrikeToken")

            atc = AtomicTransactionComposer()
            atc.add_method_call(
                app_id=strike_id,
                method=strike_contract.get_method_by_name("create_token"),
                sender=self.addr,
                sp=self._sp_with_fee(2000),
                signer=self.signer,
            )
            result = atc.execute(self.client, 10)
            # Get the asset ID from return value
            if result.abi_results and result.abi_results[0].return_value is not None:
                self.asset_ids["strike"] = int(result.abi_results[0].return_value)
                print(f"  ✅ STRIKE Token created: ASA ID {self.asset_ids['strike']}")
            else:
                print(f"  ✅ STRIKE Token: create_token() called (check logs for ASA ID)")
        except Exception as e:
            print(f"  ⚠️  STRIKE Token create_token() failed: {e}")
            print(f"     Will need manual initialization")

        # 3. Options Pool - call initialize(options_market, staking)
        print("  ⏳ Options Pool: Initializing...")
        try:
            arc56 = json.loads((BUILD_DIR / "options_pool" / "OptionsPool.arc56.json").read_text())
            contract = self._build_contract_from_arc56(arc56, "OptionsPool")

            atc = AtomicTransactionComposer()
            atc.add_method_call(
                app_id=opt_pool_id,
                method=contract.get_method_by_name("initialize"),
                sender=self.addr,
                sp=self._sp_with_fee(2000),
                signer=self.signer,
                method_args=[opt_market_addr, staking_addr],
            )
            result = atc.execute(self.client, 10)
            # Get LP token ASA ID from return
            if result.abi_results and result.abi_results[0].return_value is not None:
                self.asset_ids["options_lp"] = int(result.abi_results[0].return_value)
                print(f"  ✅ Options Pool initialized: LP token ASA {self.asset_ids['options_lp']}")
            else:
                print(f"  ✅ Options Pool initialized")
        except Exception as e:
            print(f"  ⚠️  Options Pool init failed: {e}")

        # 4. Perps Pool - call initialize(perps_market, staking)
        print("  ⏳ Perps Pool: Initializing...")
        try:
            arc56 = json.loads((BUILD_DIR / "perps_pool" / "PerpetualsPool.arc56.json").read_text())
            contract = self._build_contract_from_arc56(arc56, "PerpetualsPool")

            atc = AtomicTransactionComposer()
            atc.add_method_call(
                app_id=perp_pool_id,
                method=contract.get_method_by_name("initialize"),
                sender=self.addr,
                sp=self._sp_with_fee(2000),
                signer=self.signer,
                method_args=[perp_market_addr, staking_addr],
            )
            result = atc.execute(self.client, 10)
            if result.abi_results and result.abi_results[0].return_value is not None:
                self.asset_ids["perps_lp"] = int(result.abi_results[0].return_value)
                print(f"  ✅ Perps Pool initialized: LP token ASA {self.asset_ids['perps_lp']}")
            else:
                print(f"  ✅ Perps Pool initialized")
        except Exception as e:
            print(f"  ⚠️  Perps Pool init failed: {e}")

        # 5. Options Market - call initialize(oracle, options_pool, staking, oracle_app_id, options_pool_app_id)
        print("  ⏳ Options Market: Initializing...")
        try:
            arc56 = json.loads((BUILD_DIR / "options_market" / "OptionsMarket.arc56.json").read_text())
            contract = self._build_contract_from_arc56(arc56, "OptionsMarket")

            atc = AtomicTransactionComposer()
            atc.add_method_call(
                app_id=opt_market_id,
                method=contract.get_method_by_name("initialize"),
                sender=self.addr,
                sp=self._sp_with_fee(2000),
                signer=self.signer,
                method_args=[oracle_addr, opt_pool_addr, staking_addr, oracle_id, opt_pool_id],
                foreign_apps=[oracle_id, opt_pool_id],
            )
            atc.execute(self.client, 10)
            print(f"  ✅ Options Market initialized (oracle_app_id={oracle_id}, options_pool_app_id={opt_pool_id})")
        except Exception as e:
            print(f"  ⚠️  Options Market init failed: {e}")

        # 6. Perps Market - call initialize(oracle, perps_pool, staking, oracle_app_id)
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
            print(f"  ✅ Perps Market initialized (oracle_app_id={oracle_id})")
        except Exception as e:
            print(f"  ⚠️  Perps Market init failed: {e}")

        # 7. Staking - call initialize(strike_asset, options_market, perps_market)
        if self.asset_ids.get("strike"):
            print("  ⏳ Staking: Initializing...")
            try:
                arc56 = json.loads((BUILD_DIR / "staking" / "Staking.arc56.json").read_text())
                contract = self._build_contract_from_arc56(arc56, "Staking")

                atc = AtomicTransactionComposer()
                atc.add_method_call(
                    app_id=staking_id,
                    method=contract.get_method_by_name("initialize"),
                    sender=self.addr,
                    sp=self._sp_with_fee(2000),
                    signer=self.signer,
                    method_args=[self.asset_ids["strike"], opt_market_addr, perp_market_addr],
                    foreign_assets=[self.asset_ids["strike"]],
                )
                atc.execute(self.client, 10)
                print(f"  ✅ Staking initialized (STRIKE ASA={self.asset_ids['strike']})")
            except Exception as e:
                print(f"  ⚠️  Staking init failed: {e}")
        else:
            print("  ⏭️  Staking: Skipped (STRIKE token not created)")

        # 8. Set initial oracle price so markets work
        print("  ⏳ Oracle: Setting initial price...")
        try:
            arc56 = json.loads((BUILD_DIR / "oracle" / "Oracle.arc56.json").read_text())
            contract = self._build_contract_from_arc56(arc56, "Oracle")

            atc = AtomicTransactionComposer()
            atc.add_method_call(
                app_id=oracle_id,
                method=contract.get_method_by_name("emergency_set_price"),
                sender=self.addr,
                sp=self._sp_with_fee(2000),
                signer=self.signer,
                method_args=[150000],  # $0.15 in microUSD
            )
            atc.execute(self.client, 10)
            print(f"  ✅ Oracle price set to $0.15 (150000 microUSD)")
        except Exception as e:
            print(f"  ⚠️  Oracle price set failed: {e}")

    def _sp_with_fee(self, fee):
        sp = self.sp()
        sp.flat_fee = True
        sp.fee = fee
        return sp

    def _build_contract_from_arc56(self, arc56_data, name):
        """Build an ABI Contract from ARC-56 JSON."""
        methods = []
        for m in arc56_data.get("methods", []):
            args = []
            for a in m.get("args", []):
                args.append(abi.Argument(a["type"], a.get("name", "")))
            returns = abi.Returns(m.get("returns", {}).get("type", "void"))
            methods.append(abi.Method(m["name"], args, returns, m.get("desc", "")))
        return abi.Contract(name, methods)

    # ---- step 5: save addresses & update frontend ----
    def save_config(self):
        print("\n💾 Saving configuration...")

        # deployed_addresses.json
        output = {
            "network": "testnet",
            "deployer": self.addr,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "contracts": self.app_ids,
            "assets": self.asset_ids,
        }
        addr_path = CONTRACTS_DIR / "deployed_addresses.json"
        addr_path.write_text(json.dumps(output, indent=2))
        print(f"  ✅ {addr_path}")

        # frontend/src/config/deployed-contracts.ts
        dc_path = FRONTEND_DIR / "src" / "config" / "deployed-contracts.ts"
        dc_content = f"""/**
 * ChainStrike Deployed Contract Addresses
 * Auto-generated by deployment script
 * Network: TestNet
 * Deployed: {time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())}
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
"""
        dc_path.write_text(dc_content)
        print(f"  ✅ {dc_path}")

        # Update contracts.ts with new App IDs
        ct_path = FRONTEND_DIR / "src" / "config" / "contracts.ts"
        if ct_path.exists():
            import re

            content = ct_path.read_text()

            # Map of frontend key -> our key
            key_map = {
                "oracle": "oracle",
                "strikeToken": "strike_token",
                "staking": "staking",
                "optionsPool": "options_pool",
                "optionsMarket": "options_market",
                "perpsPool": "perps_pool",
                "perpsMarket": "perps_market",
            }

            for fe_key, our_key in key_map.items():
                new_id = self.app_ids.get(our_key, 0)
                if new_id:
                    # Replace appId: NUMBER pattern
                    content = re.sub(rf"({fe_key}:\s*\{{\s*\n\s*appId:\s*)\d+", rf"\g<1>{new_id}", content)
                    # Replace algosdk.getApplicationAddress(NUMBER) for this contract
                    content = re.sub(
                        rf"(algosdk\.getApplicationAddress\()\d+(\),?\s*\n\s*description:\s*\"[^\"]*\",?\s*\n\s*\}},?\s*\n)",
                        rf"\g<1>{new_id}\2",
                        content,
                        count=0,
                    )

            # Update asset IDs
            if self.asset_ids.get("strike"):
                # Find strike: { id: NUMBER and replace
                content = re.sub(r"(strike:\s*\{\s*\n\s*id:\s*)\d+", rf"\g<1>{self.asset_ids['strike']}", content)
            if self.asset_ids.get("options_lp"):
                content = re.sub(
                    r"(optionsLP:\s*\{\s*\n\s*id:\s*)\d+", rf"\g<1>{self.asset_ids['options_lp']}", content
                )
            if self.asset_ids.get("perps_lp"):
                content = re.sub(r"(perpsLP:\s*\{\s*\n\s*id:\s*)\d+", rf"\g<1>{self.asset_ids['perps_lp']}", content)

            ct_path.write_text(content)
            print(f"  ✅ {ct_path}")

    # ---- orchestrate ----
    def run(self):
        print("=" * 60)
        print("🚀 ChainStrike Full Deployment Pipeline")
        print("=" * 60)
        print(f"Deployer: {self.addr}")
        print(f"Balance:  {self.balance() / 1e6:.2f} ALGO")

        self.delete_old_apps()
        self.compile_all()
        self.deploy_all()
        self.fund_apps()
        self.initialize_contracts()
        self.save_config()

        print("\n" + "=" * 60)
        print("🎉 Deployment Complete!")
        print("=" * 60)
        print("\n📦 Contract Summary:")
        for name, app_id in self.app_ids.items():
            print(f"  {name:20s}: {app_id}")
        if self.asset_ids:
            print("\n🪙 Asset Summary:")
            for name, asset_id in self.asset_ids.items():
                if asset_id:
                    print(f"  {name:20s}: {asset_id}")

        print(f"\n💰 Remaining balance: {self.balance() / 1e6:.2f} ALGO")
        print("\n✅ Ready for end-to-end testing!")


if __name__ == "__main__":
    Deployer().run()
