"""
Continue deployment from where we left off.
Deploys only Perpetuals Pool and Perpetuals Market.
"""

import base64
import json
import math
import os
import ssl
import time
from pathlib import Path

from algosdk import account, mnemonic, transaction
from algosdk.v2client import algod
from algosdk.logic import get_application_address

# Fix SSL
import urllib.request

ssl_context = ssl._create_unverified_context()
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context)))

# Configuration
TESTNET_ALGOD = "https://testnet-api.algonode.cloud"
DEPLOYER_MNEMONIC = "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss"

CONTRACTS_DIR = Path(__file__).parent.parent

# Already deployed contracts
DEPLOYED = {
    "oracle": 758189767,
    "strike_token": 758189778,
    "staking": 758189780,
    "options_pool": 758189781,
    "options_market": 758189793,
}


class Deployer:
    def __init__(self):
        self.client = algod.AlgodClient("", TESTNET_ALGOD)
        self.private_key = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
        self.address = account.address_from_private_key(self.private_key)
        self.contracts = DEPLOYED.copy()

        print(f"\n🔑 Deployer: {self.address}")
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

    def compile_teal(self, teal_path: Path) -> bytes:
        teal_source = teal_path.read_text()
        compile_response = self.client.compile(teal_source)
        return base64.b64decode(compile_response["result"])

    def deploy_contract(self, name: str, approval_file: str, clear_file: str) -> int:
        print(f"\n📦 Deploying {name}...")

        approval_program = self.compile_teal(CONTRACTS_DIR / approval_file)
        clear_program = self.compile_teal(CONTRACTS_DIR / clear_file)

        approval_size = len(approval_program)
        extra_pages = math.ceil(max(0, approval_size - 2048) / 2048)
        extra_pages = min(extra_pages, 3)

        print(f"   Approval program: {approval_size} bytes")
        if extra_pages > 0:
            print(f"   Extra pages: {extra_pages}")

        sp = self.client.suggested_params()

        # Global: max 64 total (uints + byteslices), Local: max 16 total
        txn = transaction.ApplicationCreateTxn(
            sender=self.address,
            sp=sp,
            on_complete=transaction.OnComplete.NoOpOC,
            approval_program=approval_program,
            clear_program=clear_program,
            global_schema=transaction.StateSchema(num_uints=32, num_byte_slices=32),
            local_schema=transaction.StateSchema(num_uints=8, num_byte_slices=8),
            extra_pages=extra_pages,
        )

        signed = txn.sign(self.private_key)
        txid = self.client.send_transaction(signed)
        result = self.wait_for_confirmation(txid)
        app_id = result["application-index"]

        print(f"   ✅ App ID: {app_id}")
        return app_id

    def fund_app(self, app_id: int, amount: int) -> None:
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
        print(f"   💰 Funded with {amount / 1_000_000:.2f} ALGO")

    def deploy_remaining(self):
        print("\n📋 Deploying remaining contracts...")

        # Perpetuals Pool
        self.contracts["perps_pool"] = self.deploy_contract(
            "Perpetuals Pool (FIXED)", "PerpetualsPool.approval.teal", "PerpetualsPool.clear.teal"
        )
        self.fund_app(self.contracts["perps_pool"], 500_000)

        # Perpetuals Market
        self.contracts["perps_market"] = self.deploy_contract(
            "Perpetuals Market", "PerpetualsMarket.approval.teal", "PerpetualsMarket.clear.teal"
        )

        print("\n✅ All contracts deployed!")
        return True

    def save_addresses(self):
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())

        # Save JSON
        output = {
            "network": "testnet",
            "deployer": self.address,
            "timestamp": timestamp,
            "contracts": self.contracts,
        }

        output_path = CONTRACTS_DIR / "deployed_addresses.json"
        with open(output_path, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\n💾 Saved: {output_path}")

        # Update frontend deployed-contracts.ts
        frontend_config = CONTRACTS_DIR.parent / "frontend" / "src" / "config" / "deployed-contracts.ts"

        config_content = f"""/**
 * ChainStrike Deployed Contract Addresses
 * Auto-generated by deployment script
 * Network: TestNet
 * Deployed: {timestamp}
 * 
 * These contracts include the fixed deposit() method that handles
 * both opt-in and non-opt-in transaction groups correctly.
 */

export const DEPLOYED_CONTRACTS = {{
  oracle: {self.contracts.get("oracle", 0)},
  strikeToken: {self.contracts.get("strike_token", 0)},
  staking: {self.contracts.get("staking", 0)},
  optionsPool: {self.contracts.get("options_pool", 0)},
  optionsMarket: {self.contracts.get("options_market", 0)},
  perpsPool: {self.contracts.get("perps_pool", 0)},
  perpsMarket: {self.contracts.get("perps_market", 0)},
}} as const;

export type ContractName = keyof typeof DEPLOYED_CONTRACTS;
"""

        with open(frontend_config, "w") as f:
            f.write(config_content)
        print(f"📝 Updated: {frontend_config}")

        # Update contracts.ts
        contracts_path = CONTRACTS_DIR.parent / "frontend" / "src" / "config" / "contracts.ts"
        if contracts_path.exists():
            import re

            content = contracts_path.read_text()
            for key, new_id in [
                ("optionsPool", self.contracts.get("options_pool")),
                ("optionsMarket", self.contracts.get("options_market")),
                ("perpsPool", self.contracts.get("perps_pool")),
                ("perpsMarket", self.contracts.get("perps_market")),
                ("oracle", self.contracts.get("oracle")),
                ("staking", self.contracts.get("staking")),
            ]:
                if new_id:
                    pattern = rf"({key}:\s*{{\s*appId:\s*)\d+"
                    content = re.sub(pattern, rf"\g<1>{new_id}", content)
            contracts_path.write_text(content)
            print(f"📝 Updated: {contracts_path}")

    def print_summary(self):
        print(f"\n{'=' * 60}")
        print("🎉 DEPLOYMENT COMPLETE")
        print(f"{'=' * 60}")

        print("\n📜 All Contract Addresses:")
        for name, app_id in self.contracts.items():
            app_addr = get_application_address(app_id)
            print(f"  {name:20s}: {app_id}")

        print("\n🔗 TestNet Explorer Links:")
        print(f"  Options Pool: https://testnet.explorer.perawallet.app/application/{self.contracts['options_pool']}/")
        print(f"  Perps Pool:   https://testnet.explorer.perawallet.app/application/{self.contracts['perps_pool']}/")

        print("\n📝 Next Steps:")
        print("  1. cd frontend && pnpm dev")
        print("  2. Connect Pera Wallet (TestNet)")
        print("  3. Test pool deposits at http://localhost:3000/pool")


if __name__ == "__main__":
    deployer = Deployer()
    if deployer.deploy_remaining():
        deployer.save_addresses()
        deployer.print_summary()
