"""
Complete deployment script for ChainStrike contracts with extra program pages.

Uses Algorand's ExtraProgramPages feature to deploy contracts larger than 2048 bytes.
Each extra page adds 2048 bytes capacity (max 3 extra pages = 8KB total).

Deployment Order:
1. Oracle - Price feeds
2. STRIKE Token - Governance token
3. Staking - STRIKE staking & rewards
4. Options Pool - Options liquidity pool (WITH DEPOSIT FIX)
5. Options Market - Options trading
6. Perpetuals Pool - Perpetuals liquidity pool (WITH DEPOSIT FIX)
7. Perpetuals Market - Perpetuals trading
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

# Fix SSL certificate verification issue on macOS
import urllib.request

ssl_context = ssl._create_unverified_context()
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context)))

# Configuration
TESTNET_ALGOD = "https://testnet-api.algonode.cloud"
DEPLOYER_MNEMONIC = os.getenv(
    "DEPLOYER_MNEMONIC",
    "crack scout prefer purchase seat fever tilt tornado knee ridge twice pulp man card stereo worry come disease thunder crash liberty toss leader abstract toss",
)

# Contracts directory
CONTRACTS_DIR = Path(__file__).parent.parent

# Contract TEAL files
CONTRACT_FILES = {
    "oracle": ("Oracle.approval.teal", "Oracle.clear.teal"),
    "strike_token": ("StrikeToken.approval.teal", "StrikeToken.clear.teal"),
    "staking": ("Staking.approval.teal", "Staking.clear.teal"),
    "options_pool": ("OptionsPool.approval.teal", "OptionsPool.clear.teal"),
    "options_market": ("OptionsMarket.approval.teal", "OptionsMarket.clear.teal"),
    "perps_pool": ("PerpetualsPool.approval.teal", "PerpetualsPool.clear.teal"),
    "perps_market": ("PerpetualsMarket.approval.teal", "PerpetualsMarket.clear.teal"),
}

# Initial pool funding (in microALGO)
INITIAL_POOL_FUNDING = 500_000  # 0.5 ALGO per pool


class ChainStrikeDeployer:
    """Deploy all ChainStrike contracts with extra program pages support."""

    def __init__(self):
        self.client = algod.AlgodClient("", TESTNET_ALGOD)
        self.private_key = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
        self.address = account.address_from_private_key(self.private_key)
        self.contracts = {}
        self.assets = {}

        print(f"\n{'=' * 60}")
        print("🚀 ChainStrike Complete Deployment")
        print(f"{'=' * 60}")
        print(f"\n🔑 Deployer: {self.address}")

    def check_balance(self) -> int:
        """Check account balance."""
        account_info = self.client.account_info(self.address)
        balance = account_info.get("amount", 0)
        print(f"💰 Balance: {balance / 1_000_000:.2f} ALGO")
        return balance

    def wait_for_confirmation(self, txid: str) -> dict:
        """Wait for transaction confirmation."""
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
        """Compile TEAL source to bytecode."""
        teal_source = teal_path.read_text()
        compile_response = self.client.compile(teal_source)
        return base64.b64decode(compile_response["result"])

    def calculate_extra_pages(self, bytecode_size: int) -> int:
        """Calculate number of extra program pages needed."""
        if bytecode_size <= 2048:
            return 0
        # Each extra page adds 2048 bytes
        extra_bytes_needed = bytecode_size - 2048
        extra_pages = math.ceil(extra_bytes_needed / 2048)
        return min(extra_pages, 3)  # Max 3 extra pages

    def deploy_contract(self, name: str, approval_file: str, clear_file: str) -> int:
        """Deploy a smart contract with extra program pages if needed."""
        print(f"\n📦 Deploying {name}...")

        # Compile TEAL
        approval_path = CONTRACTS_DIR / approval_file
        clear_path = CONTRACTS_DIR / clear_file

        approval_program = self.compile_teal(approval_path)
        clear_program = self.compile_teal(clear_path)

        approval_size = len(approval_program)
        extra_pages = self.calculate_extra_pages(approval_size)

        print(f"   Approval program: {approval_size} bytes")
        if extra_pages > 0:
            print(f"   Extra pages: {extra_pages} (max capacity: {2048 * (1 + extra_pages)} bytes)")

        # Get suggested params
        sp = self.client.suggested_params()

        # Create application with extra pages
        # Use larger schema for contracts that need more state (max 64 each)
        txn = transaction.ApplicationCreateTxn(
            sender=self.address,
            sp=sp,
            on_complete=transaction.OnComplete.NoOpOC,
            approval_program=approval_program,
            clear_program=clear_program,
            global_schema=transaction.StateSchema(num_uints=32, num_byte_slices=32),
            local_schema=transaction.StateSchema(num_uints=16, num_byte_slices=16),
            extra_pages=extra_pages,
        )

        # Sign and send
        signed = txn.sign(self.private_key)
        txid = self.client.send_transaction(signed)

        # Wait for confirmation
        result = self.wait_for_confirmation(txid)
        app_id = result["application-index"]
        app_addr = get_application_address(app_id)

        print(f"   ✅ App ID: {app_id}")
        print(f"   📍 Address: {app_addr[:16]}...")

        return app_id

    def fund_app(self, app_id: int, amount: int) -> None:
        """Fund an application with ALGO."""
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

    def deploy_all(self) -> bool:
        """Deploy all contracts in order."""
        # Check balance
        balance = self.check_balance()
        if balance < 10_000_000:  # 10 ALGO minimum
            print("\n❌ Insufficient balance! Need at least 10 ALGO.")
            print(f"   Fund at: https://bank.testnet.algorand.network/?account={self.address}")
            return False

        print("\n📋 Deployment Plan:")
        print("   1. Oracle (price feeds)")
        print("   2. STRIKE Token (governance)")
        print("   3. Staking (rewards)")
        print("   4. Options Pool (with deposit fix)")
        print("   5. Options Market")
        print("   6. Perpetuals Pool (with deposit fix)")
        print("   7. Perpetuals Market")

        try:
            # 1. Oracle
            self.contracts["oracle"] = self.deploy_contract("Oracle", *CONTRACT_FILES["oracle"])

            # 2. STRIKE Token
            self.contracts["strike_token"] = self.deploy_contract("STRIKE Token", *CONTRACT_FILES["strike_token"])

            # 3. Staking
            self.contracts["staking"] = self.deploy_contract("Staking", *CONTRACT_FILES["staking"])

            # 4. Options Pool (with deposit fix)
            self.contracts["options_pool"] = self.deploy_contract(
                "Options Pool (FIXED)", *CONTRACT_FILES["options_pool"]
            )
            self.fund_app(self.contracts["options_pool"], INITIAL_POOL_FUNDING)

            # 5. Options Market
            self.contracts["options_market"] = self.deploy_contract("Options Market", *CONTRACT_FILES["options_market"])

            # 6. Perpetuals Pool (with deposit fix)
            self.contracts["perps_pool"] = self.deploy_contract(
                "Perpetuals Pool (FIXED)", *CONTRACT_FILES["perps_pool"]
            )
            self.fund_app(self.contracts["perps_pool"], INITIAL_POOL_FUNDING)

            # 7. Perpetuals Market
            self.contracts["perps_market"] = self.deploy_contract("Perpetuals Market", *CONTRACT_FILES["perps_market"])

            print("\n✅ All contracts deployed successfully!")
            return True

        except Exception as e:
            print(f"\n❌ Deployment failed: {e}")
            import traceback

            traceback.print_exc()
            return False

    def save_addresses(self):
        """Save deployed addresses to JSON and update frontend config."""
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())

        # Save JSON
        output = {
            "network": "testnet",
            "deployer": self.address,
            "timestamp": timestamp,
            "contracts": self.contracts,
            "assets": self.assets,
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

        # Update frontend contracts.ts with new App IDs
        self.update_contracts_ts()

    def update_contracts_ts(self):
        """Update the main contracts.ts with new App IDs."""
        contracts_path = CONTRACTS_DIR.parent / "frontend" / "src" / "config" / "contracts.ts"

        if not contracts_path.exists():
            print(f"⚠️  Could not find {contracts_path}")
            return

        content = contracts_path.read_text()

        # Update App IDs in contracts.ts
        replacements = {
            "optionsPool": self.contracts.get("options_pool"),
            "optionsMarket": self.contracts.get("options_market"),
            "perpsPool": self.contracts.get("perps_pool"),
            "perpsMarket": self.contracts.get("perps_market"),
            "oracle": self.contracts.get("oracle"),
            "staking": self.contracts.get("staking"),
        }

        import re

        for key, new_id in replacements.items():
            if new_id:
                # Match patterns like: optionsPool: { appId: 123456,
                pattern = rf"({key}:\s*{{\s*appId:\s*)\d+"
                content = re.sub(pattern, rf"\g<1>{new_id}", content)

        contracts_path.write_text(content)
        print(f"📝 Updated: {contracts_path}")

    def print_summary(self):
        """Print deployment summary."""
        print(f"\n{'=' * 60}")
        print("🎉 DEPLOYMENT COMPLETE")
        print(f"{'=' * 60}")

        print("\n📜 Contract Addresses:")
        print("-" * 50)
        for name, app_id in self.contracts.items():
            app_addr = get_application_address(app_id)
            print(f"  {name:20s}: {app_id}")
            print(f"  {'':20s}  {app_addr}")

        print("\n🔗 TestNet Explorer Links:")
        for name, app_id in self.contracts.items():
            print(f"  {name}: https://testnet.explorer.perawallet.app/application/{app_id}/")

        print("\n📝 Next Steps:")
        print("  1. Start the frontend: cd frontend && pnpm dev")
        print("  2. Connect Pera Wallet (TestNet)")
        print("  3. Test pool deposits at http://localhost:3000/pool")
        print("  4. Verify transactions succeed without ApprovalProgram errors")

        print(f"\n{'=' * 60}")


def main():
    """Main deployment function."""
    deployer = ChainStrikeDeployer()

    if deployer.deploy_all():
        deployer.save_addresses()
        deployer.print_summary()
    else:
        print("\n⚠️  Deployment incomplete. Please resolve issues and retry.")


if __name__ == "__main__":
    main()
