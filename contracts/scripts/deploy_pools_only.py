"""
Targeted deployment script for pool contracts only.
Uses existing Oracle, STRIKE Token, and Staking contracts.

This deploys ONLY the fixed pool contracts:
1. Options Pool (with fixed deposit method)
2. Options Market (referencing new pool)
3. Perpetuals Pool (with fixed deposit method)
4. Perpetuals Market (referencing new pool)
"""

import json
import os
import ssl
import time
from pathlib import Path

from algosdk import account, mnemonic, transaction
from algosdk.v2client import algod

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

# Existing contract addresses (already deployed)
EXISTING_CONTRACTS = {
    "oracle": 758189295,
    "strike_token": 758189307,
    "staking": 758164068,  # Using old Staking (under 2048 bytes)
}

# Contracts directory
CONTRACTS_DIR = Path(__file__).parent.parent


class PoolDeployer:
    """Deploy only the pool contracts with fixes."""

    def __init__(self):
        self.client = algod.AlgodClient("", TESTNET_ALGOD)
        self.private_key = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
        self.address = account.address_from_private_key(self.private_key)
        self.contracts = EXISTING_CONTRACTS.copy()

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
        """Compile TEAL to bytecode."""
        import base64

        teal_source = teal_path.read_text()
        compile_response = self.client.compile(teal_source)
        return base64.b64decode(compile_response["result"])

    def deploy_contract(self, name: str, approval_teal_path: Path, clear_teal_path: Path) -> int:
        """Deploy a smart contract."""
        print(f"\n📦 Deploying {name}...")

        # Compile TEAL
        approval_program = self.compile_teal(approval_teal_path)
        clear_program = self.compile_teal(clear_teal_path)

        # Get suggested params
        sp = self.client.suggested_params()

        # Create application
        txn = transaction.ApplicationCreateTxn(
            sender=self.address,
            sp=sp,
            on_complete=transaction.OnComplete.NoOpOC,
            approval_program=approval_program,
            clear_program=clear_program,
            global_schema=transaction.StateSchema(num_uints=10, num_byte_slices=10),
            local_schema=transaction.StateSchema(num_uints=5, num_byte_slices=5),
        )

        # Sign and send
        signed = txn.sign(self.private_key)
        txid = self.client.send_transaction(signed)

        # Wait for confirmation
        result = self.wait_for_confirmation(txid)
        app_id = result["application-index"]

        print(f"  ✅ Deployed: App ID {app_id}")
        return app_id

    def get_app_address(self, app_id: int) -> str:
        """Get application address from app ID."""
        from algosdk.logic import get_application_address

        return get_application_address(app_id)

    def fund_app(self, app_id: int, amount: int) -> None:
        """Fund an application with ALGO."""
        app_address = self.get_app_address(app_id)
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
        print(f"  💰 Funded app {app_id} with {amount / 1_000_000:.2f} ALGO")

    def deploy_pools(self):
        """Deploy pool contracts."""
        print("\n" + "=" * 60)
        print("🚀 ChainStrike Pool Contract Deployment")
        print("=" * 60)

        # Check balance
        balance = self.check_balance()
        if balance < 2_000_000:  # 2 ALGO minimum
            print("\n❌ Insufficient balance!")
            return False

        print("\n📋 Using existing contracts:")
        print(f"  • Oracle: {self.contracts['oracle']}")
        print(f"  • STRIKE Token: {self.contracts['strike_token']}")
        print(f"  • Staking: {self.contracts['staking']}")

        print("\n📋 Deploying fixed pool contracts:")
        print("  1. Options Pool (with deposit fix)")
        print("  2. Options Market")
        print("  3. Perpetuals Pool (with deposit fix)")
        print("  4. Perpetuals Market")

        try:
            # 1. Options Pool
            self.contracts["options_pool"] = self.deploy_contract(
                "Options Pool", CONTRACTS_DIR / "OptionsPool.approval.teal", CONTRACTS_DIR / "OptionsPool.clear.teal"
            )

            # Fund options pool
            self.fund_app(self.contracts["options_pool"], 500_000)  # 0.5 ALGO

            # 2. Options Market
            self.contracts["options_market"] = self.deploy_contract(
                "Options Market",
                CONTRACTS_DIR / "OptionsMarket.approval.teal",
                CONTRACTS_DIR / "OptionsMarket.clear.teal",
            )

            # 3. Perpetuals Pool
            self.contracts["perps_pool"] = self.deploy_contract(
                "Perpetuals Pool",
                CONTRACTS_DIR / "PerpetualsPool.approval.teal",
                CONTRACTS_DIR / "PerpetualsPool.clear.teal",
            )

            # Fund perps pool
            self.fund_app(self.contracts["perps_pool"], 500_000)  # 0.5 ALGO

            # 4. Perpetuals Market
            self.contracts["perps_market"] = self.deploy_contract(
                "Perpetuals Market",
                CONTRACTS_DIR / "PerpetualsMarket.approval.teal",
                CONTRACTS_DIR / "PerpetualsMarket.clear.teal",
            )

            print("\n✅ All pool contracts deployed!")
            return True

        except Exception as e:
            print(f"\n❌ Deployment failed: {e}")
            return False

    def save_addresses(self):
        """Save deployed addresses."""
        output = {
            "network": "testnet",
            "deployer": self.address,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "contracts": self.contracts,
        }

        # Save JSON
        output_path = CONTRACTS_DIR / "deployed_addresses.json"
        with open(output_path, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\n💾 Addresses saved to: {output_path}")

        # Update frontend deployed-contracts.ts
        frontend_config = CONTRACTS_DIR.parent / "frontend" / "src" / "config" / "deployed-contracts.ts"

        config_content = f"""/**
 * ChainStrike Deployed Contract Addresses
 * Auto-generated by deployment script
 * Network: TestNet
 * Deployed: {time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())}
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
"""

        with open(frontend_config, "w") as f:
            f.write(config_content)
        print(f"📝 Frontend config updated: {frontend_config}")

    def print_summary(self):
        """Print deployment summary."""
        print("\n" + "=" * 60)
        print("🎉 Deployment Complete!")
        print("=" * 60)

        print("\n📜 All Contract Addresses:")
        print("-" * 40)
        for name, app_id in self.contracts.items():
            app_addr = self.get_app_address(app_id)
            print(f"  {name:20s}: {app_id} ({app_addr[:8]}...)")

        print("\n📝 Next Steps:")
        print("  1. Test pool deposits in frontend")
        print("  2. Initialize contracts with cross-references (if needed)")
        print("  3. Create LP tokens via pool initialization")
        print("  4. Verify transactions succeed without ApprovalProgram errors")

        print("\n🔗 TestNet Explorer Links:")
        print(f"  Options Pool: https://testnet.explorer.perawallet.app/application/{self.contracts['options_pool']}/")
        print(f"  Perps Pool: https://testnet.explorer.perawallet.app/application/{self.contracts['perps_pool']}/")


def main():
    """Main deployment function."""
    deployer = PoolDeployer()

    if deployer.deploy_pools():
        deployer.save_addresses()
        deployer.print_summary()
    else:
        print("\n⚠️  Deployment incomplete.")


if __name__ == "__main__":
    main()
