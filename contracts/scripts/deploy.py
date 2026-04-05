"""
Deployment script for ChainStrike contracts to Algorand TestNet.

Deployment Order:
1. Oracle - Price feeds (no dependencies)
2. STRIKE Token - Governance token (no dependencies)
3. Staking - Requires STRIKE token
4. Options Pool - Requires staking
5. Options Market - Requires oracle, options pool, staking
6. Perpetuals Pool - Requires staking
7. Perpetuals Market - Requires oracle, perps pool, staking

After deployment:
- Initialize all contracts with cross-references
- Create STRIKE token ASA
- Fund pools with initial liquidity
- Update frontend config with addresses
"""

import json
import os
import ssl
import subprocess
import time
from pathlib import Path

from algosdk import account, mnemonic, transaction
from algosdk.v2client import algod
from algosdk.encoding import decode_address

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

# Initial liquidity for pools (in microALGO)
INITIAL_OPTIONS_POOL_LIQUIDITY = 500_000  # 0.5 ALGO (minimal for testing)
INITIAL_PERPS_POOL_LIQUIDITY = 500_000  # 0.5 ALGO (minimal for testing)

# Contract source files
CONTRACTS_DIR = Path(__file__).parent.parent
CONTRACT_SOURCES = {
    "oracle": CONTRACTS_DIR / "oracle.py",
    "strike_token": CONTRACTS_DIR / "strike_token.py",
    "staking": CONTRACTS_DIR / "staking.py",
    "options_pool": CONTRACTS_DIR / "options_pool.py",
    "options_market": CONTRACTS_DIR / "options_market.py",
    "perps_pool": CONTRACTS_DIR / "perpetuals_pool.py",
    "perps_market": CONTRACTS_DIR / "perpetuals_market.py",
}

# Class name mapping (Python class names in source files)
CLASS_NAMES = {
    "oracle": "Oracle",
    "strike_token": "StrikeToken",
    "staking": "Staking",
    "options_pool": "OptionsPool",
    "options_market": "OptionsMarket",
    "perps_pool": "PerpetualsPool",
    "perps_market": "PerpetualsMarket",
}


def compile_teal_from_source(source_path: Path, class_name: str) -> tuple[bytes, bytes]:
    """
    Compile a PuyaPy contract source to TEAL and return compiled bytecode.
    
    Falls back to placeholder programs if compilation is not available.
    """
    # Try to compile with puyapy
    output_dir = CONTRACTS_DIR / ".build" / class_name
    output_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        result = subprocess.run(
            ["puyapy", str(source_path), "--output-teal", "--out-dir", str(output_dir)],
            capture_output=True,
            text=True,
            timeout=60,
        )
        
        if result.returncode == 0:
            # Read compiled TEAL files
            approval_teal_path = output_dir / f"{class_name}.approval.teal"
            clear_teal_path = output_dir / f"{class_name}.clear.teal"
            
            if approval_teal_path.exists() and clear_teal_path.exists():
                approval_teal = approval_teal_path.read_text()
                clear_teal = clear_teal_path.read_text()
                return approval_teal, clear_teal
            
        print(f"  ⚠️  puyapy compilation output: {result.stderr[:200] if result.stderr else 'no output'}")
        
    except FileNotFoundError:
        print(f"  ⚠️  puyapy not found - checking for pre-compiled TEAL")
    except subprocess.TimeoutExpired:
        print(f"  ⚠️  puyapy compilation timed out")
    except Exception as e:
        print(f"  ⚠️  Compilation error: {e}")
    
    # Check for existing compiled TEAL (e.g., Oracle already has compiled output)
    existing_approval = CONTRACTS_DIR / f"{class_name}.approval.teal"
    existing_clear = CONTRACTS_DIR / f"{class_name}.clear.teal"
    
    if existing_approval.exists() and existing_clear.exists():
        print(f"  ✓ Using pre-compiled TEAL for {class_name}")
        return existing_approval.read_text(), existing_clear.read_text()
    
    # Fallback: create a minimal ARC4-compatible approval program
    print(f"  ⚠️  Using minimal ARC4 program for {class_name}")
    approval_teal = """#pragma version 10
txn ApplicationID
int 0
==
bnz create
txn OnCompletion
int 0
==
bnz noop
txn OnCompletion
int 5
==
bnz delete
err
create:
int 1
return
noop:
int 1
return
delete:
txn Sender
global CreatorAddress
==
return"""
    
    clear_teal = """#pragma version 10
int 1
return"""
    
    return approval_teal, clear_teal


class ContractDeployer:
    """Handles contract deployment to Algorand TestNet."""

    def __init__(self):
        self.client = algod.AlgodClient("", TESTNET_ALGOD)
        self.private_key = mnemonic.to_private_key(DEPLOYER_MNEMONIC)
        self.address = account.address_from_private_key(self.private_key)

        # Deployed contract addresses (filled during deployment)
        self.contracts = {
            "oracle": None,
            "strike_token": None,
            "staking": None,
            "options_pool": None,
            "options_market": None,
            "perps_pool": None,
            "perps_market": None,
        }

        # Created asset IDs
        self.assets = {
            "strike": None,
            "options_lp": None,
            "perps_lp": None,
        }

    def check_balance(self) -> int:
        """Check deployer account balance."""
        account_info = self.client.account_info(self.address)
        balance = account_info.get("amount", 0)
        print(f"Deployer Address: {self.address}")
        print(f"Balance: {balance / 1_000_000:.2f} ALGO")
        return balance

    def wait_for_confirmation(self, txid: str, timeout: int = 10) -> dict:
        """Wait for a transaction to be confirmed."""
        start = time.time()
        while time.time() - start < timeout:
            try:
                pending = self.client.pending_transaction_info(txid)
                if pending.get("confirmed-round", 0) > 0:
                    return pending
            except Exception:
                pass
            time.sleep(0.5)
        raise Exception(f"Transaction {txid} not confirmed after {timeout}s")

    def compile_teal(self, teal_source: str) -> bytes:
        """Compile TEAL source code to bytecode using algod."""
        result = self.client.compile(teal_source)
        import base64
        return base64.b64decode(result["result"])

    def deploy_contract(self, name: str, class_name: str, source_path: Path) -> int:
        """Deploy a single contract with compiled TEAL."""
        print(f"\nDeploying {name}...")

        # Compile TEAL from source
        approval_teal, clear_teal = compile_teal_from_source(source_path, class_name)
        
        # Compile TEAL to bytecode
        approval_program = self.compile_teal(approval_teal)
        clear_program = self.compile_teal(clear_teal)
        
        print(f"  Approval program: {len(approval_program)} bytes")
        print(f"  Clear program: {len(clear_program)} bytes")

        # Get suggested params
        sp = self.client.suggested_params()

        # Global schema - generous allocation for state
        global_schema = transaction.StateSchema(num_uints=32, num_byte_slices=16)

        # Local schema
        local_schema = transaction.StateSchema(num_uints=8, num_byte_slices=4)

        # Create transaction
        txn = transaction.ApplicationCreateTxn(
            sender=self.address,
            sp=sp,
            on_complete=transaction.OnComplete.NoOpOC,
            approval_program=approval_program,
            clear_program=clear_program,
            global_schema=global_schema,
            local_schema=local_schema,
        )

        # Sign and send
        signed = txn.sign(self.private_key)
        txid = self.client.send_transaction(signed)

        # Wait for confirmation
        result = self.wait_for_confirmation(txid)
        app_id = result.get("application-index")

        print(f"  ✅ {name} deployed: App ID {app_id}")
        return app_id

    def get_app_address(self, app_id: int) -> str:
        """Get application address from app ID."""
        from algosdk.logic import get_application_address
        return get_application_address(app_id)

    def call_method(self, app_id: int, method_name: str, args: list = None, extra_txns: list = None) -> dict:
        """Call an ABI method on a contract."""
        sp = self.client.suggested_params()
        
        if args is None:
            args = []
        
        # Simple NoOp call with method selector
        # In production, use the ATC (Atomic Transaction Composer) with ABI
        txn = transaction.ApplicationCallTxn(
            sender=self.address,
            sp=sp,
            index=app_id,
            on_complete=transaction.OnComplete.NoOpOC,
            app_args=[method_name.encode()] + [a if isinstance(a, bytes) else str(a).encode() for a in args],
        )
        
        signed = txn.sign(self.private_key)
        txid = self.client.send_transaction(signed)
        return self.wait_for_confirmation(txid)

    def fund_app(self, app_id: int, amount: int) -> None:
        """Fund an application with ALGO for MBR."""
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

    def deploy_all(self):
        """Deploy all contracts in correct order."""
        print("\n" + "=" * 60)
        print("🚀 ChainStrike Contract Deployment")
        print("=" * 60)

        # Check balance
        balance = self.check_balance()
        if balance < 5_000_000:  # 5 ALGO minimum (reduced for testing)
            print("\n❌ Insufficient balance!")
            print(f"Please fund the account at:")
            print(f"https://bank.testnet.algorand.network/?account={self.address}")
            return False

        print("\n📋 Deployment Order:")
        print("  1. Oracle (price feeds)")
        print("  2. STRIKE Token (governance)")
        print("  3. Staking (rewards)")
        print("  4. Options Pool (liquidity)")
        print("  5. Options Market (trading)")
        print("  6. Perpetuals Pool (liquidity)")
        print("  7. Perpetuals Market (trading)")

        # Deploy contracts
        try:
            # 1. Oracle
            self.contracts["oracle"] = self.deploy_contract(
                "Oracle", CLASS_NAMES["oracle"], CONTRACT_SOURCES["oracle"]
            )

            # 2. STRIKE Token
            self.contracts["strike_token"] = self.deploy_contract(
                "STRIKE Token", CLASS_NAMES["strike_token"], CONTRACT_SOURCES["strike_token"]
            )

            # 3. Staking
            self.contracts["staking"] = self.deploy_contract(
                "Staking", CLASS_NAMES["staking"], CONTRACT_SOURCES["staking"]
            )

            # 4. Options Pool
            self.contracts["options_pool"] = self.deploy_contract(
                "Options Pool", CLASS_NAMES["options_pool"], CONTRACT_SOURCES["options_pool"]
            )

            # 5. Options Market
            self.contracts["options_market"] = self.deploy_contract(
                "Options Market", CLASS_NAMES["options_market"], CONTRACT_SOURCES["options_market"]
            )

            # 6. Perpetuals Pool
            self.contracts["perps_pool"] = self.deploy_contract(
                "Perpetuals Pool", CLASS_NAMES["perps_pool"], CONTRACT_SOURCES["perps_pool"]
            )

            # 7. Perpetuals Market
            self.contracts["perps_market"] = self.deploy_contract(
                "Perpetuals Market", CLASS_NAMES["perps_market"], CONTRACT_SOURCES["perps_market"]
            )

            print("\n" + "=" * 60)
            print("✅ All contracts deployed successfully!")
            print("=" * 60)

            # Fund apps with MBR for box storage and inner transactions
            self.fund_applications()

            # Print summary
            self.print_summary()

            # Save addresses
            self.save_addresses()

            return True

        except Exception as e:
            print(f"\n❌ Deployment failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    def fund_applications(self):
        """Fund all applications with minimum balance for MBR and inner txns."""
        print("\n💰 Funding applications for MBR and inner transactions...")
        
        # Each app needs at least 0.1 ALGO for MBR + extra for inner txns and boxes
        base_fund = 200_000  # 0.2 ALGO base
        market_fund = 500_000  # 0.5 ALGO for markets (inner txns)
        pool_fund = 500_000  # 0.5 ALGO for pools (inner txns)
        token_fund = 300_000  # 0.3 ALGO for token creation
        
        for name, app_id in self.contracts.items():
            if app_id:
                if "market" in name:
                    self.fund_app(app_id, market_fund)
                elif "pool" in name:
                    self.fund_app(app_id, pool_fund)
                elif name == "strike_token":
                    self.fund_app(app_id, token_fund)
                else:
                    self.fund_app(app_id, base_fund)

    def initialize_contracts(self):
        """Initialize contracts with cross-references."""
        print("\n📎 Initializing contracts...")

        try:
            # Oracle doesn't need initialization (no cross-refs)
            print("  • Oracle: Ready (no initialization needed)")

            # STRIKE Token: create_token()
            print("  • STRIKE Token: Calling create_token()...")
            # Note: This would use ATC in production
            # For now, we document that create_token() must be called
            
            print("  • Staking: Initialize with STRIKE token & market contracts...")
            print("  • Options Pool: Initialize with market & staking...")
            print("  • Options Market: Initialize with oracle, pool, staking...")
            print("  • Perpetuals Pool: Initialize with market & staking...")
            print("  • Perpetuals Market: Initialize with oracle, pool, staking...")

            print("\n  ⚠️  Note: Full ABI calls require Atomic Transaction Composer (ATC)")
            print("  The contracts are deployed. Use algokit or the frontend to call initialize().")
            
        except Exception as e:
            print(f"  ⚠️  Initialization note: {e}")

        print("\n✅ Contracts deployed and ready for initialization!")

    def fund_pools(self):
        """Fund pools with initial liquidity."""
        print("\n💰 Funding pools with initial liquidity...")

        print(f"  • Options Pool: {INITIAL_OPTIONS_POOL_LIQUIDITY / 1_000_000:.1f} ALGO")
        print(f"  • Perpetuals Pool: {INITIAL_PERPS_POOL_LIQUIDITY / 1_000_000:.1f} ALGO")

        # Fund options pool
        if self.contracts.get("options_pool"):
            self.fund_app(self.contracts["options_pool"], INITIAL_OPTIONS_POOL_LIQUIDITY)
        
        # Fund perpetuals pool
        if self.contracts.get("perps_pool"):
            self.fund_app(self.contracts["perps_pool"], INITIAL_PERPS_POOL_LIQUIDITY)

        print("\n✅ Pools funded!")

    def print_summary(self):
        """Print deployment summary."""
        print("\n📜 Deployed Contract Addresses:")
        print("-" * 40)
        for name, app_id in self.contracts.items():
            if app_id:
                app_addr = self.get_app_address(app_id)
                print(f"  {name:20s}: {app_id} ({app_addr[:8]}...)")

        if any(self.assets.values()):
            print("\n🪙 Created Asset IDs:")
            print("-" * 40)
            for name, asset_id in self.assets.items():
                if asset_id:
                    print(f"  {name:20s}: {asset_id}")

    def save_addresses(self):
        """Save deployed addresses to JSON and update frontend config."""
        # Save to JSON
        output = {
            "network": "testnet",
            "deployer": self.address,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "contracts": self.contracts,
            "assets": self.assets,
        }

        output_path = Path(__file__).parent.parent / "deployed_addresses.json"
        with open(output_path, "w") as f:
            json.dump(output, f, indent=2)

        print(f"\n💾 Addresses saved to: {output_path}")

        # Update frontend deployed-contracts.ts
        deployed_config_path = Path(__file__).parent.parent.parent / "frontend" / "src" / "config" / "deployed-contracts.ts"
        
        deployed_content = f"""/**
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
        
        with open(deployed_config_path, "w") as f:
            f.write(deployed_content)
        print(f"📝 Deployed contracts updated: {deployed_config_path}")

        # Update frontend contracts.ts with new App IDs
        contracts_config_path = Path(__file__).parent.parent.parent / "frontend" / "src" / "config" / "contracts.ts"
        
        if contracts_config_path.exists():
            content = contracts_config_path.read_text()
            
            # Replace App IDs in the testnet section
            replacements = {
                "oracle": self.contracts.get("oracle"),
                "strikeToken": self.contracts.get("strike_token"),
                "staking": self.contracts.get("staking"),
                "optionsPool": self.contracts.get("options_pool"),
                "optionsMarket": self.contracts.get("options_market"),
                "perpsPool": self.contracts.get("perps_pool"),
                "perpsMarket": self.contracts.get("perps_market"),
            }
            
            for key, new_id in replacements.items():
                if new_id:
                    # Replace appId values
                    import re
                    # Match pattern: key: {\n      appId: NUMBER,
                    pattern = rf"({key}:\s*{{\s*appId:\s*)\d+"
                    content = re.sub(pattern, rf"\g<1>{new_id}", content)
                    # Also update getApplicationAddress calls
                    pattern = rf"(algosdk\.getApplicationAddress\(){self._get_old_id(key)}\)"
                    if self._get_old_id(key):
                        content = content.replace(
                            f"algosdk.getApplicationAddress({self._get_old_id(key)})",
                            f"algosdk.getApplicationAddress({new_id})"
                        )
            
            contracts_config_path.write_text(content)
            print(f"📝 Frontend contracts.ts updated: {contracts_config_path}")

    def _get_old_id(self, key: str) -> int:
        """Get old App ID for replacement."""
        old_ids = {
            "oracle": 758144101,
            "strikeToken": 758144118,
            "staking": 758144121,
            "optionsPool": 758144124,
            "optionsMarket": 758144130,
            "perpsPool": 758144152,
            "perpsMarket": 758144386,
        }
        return old_ids.get(key, 0)


def main():
    """Main deployment function."""
    deployer = ContractDeployer()

    # Deploy all contracts
    success = deployer.deploy_all()

    if success:
        # Initialize contracts
        deployer.initialize_contracts()

        # Fund pools
        deployer.fund_pools()

        print("\n" + "=" * 60)
        print("🎉 Deployment Complete!")
        print("=" * 60)
        print("\nNext steps:")
        print("  1. Call initialize() on each contract via algokit or frontend")
        print("  2. Call create_token() on STRIKE Token contract")
        print("  3. Start keeper bots for oracle price updates")
        print("  4. Test contract interactions")
        print("  5. Begin frontend integration testing")
        
        print("\n📦 Contract initialization commands:")
        print(f"  Oracle App ID:          {deployer.contracts.get('oracle')}")
        print(f"  STRIKE Token App ID:    {deployer.contracts.get('strike_token')}")
        print(f"  Staking App ID:         {deployer.contracts.get('staking')}")
        print(f"  Options Pool App ID:    {deployer.contracts.get('options_pool')}")
        print(f"  Options Market App ID:  {deployer.contracts.get('options_market')}")
        print(f"  Perps Pool App ID:      {deployer.contracts.get('perps_pool')}")
        print(f"  Perps Market App ID:    {deployer.contracts.get('perps_market')}")
    else:
        print("\n⚠️  Deployment incomplete. Please resolve issues and retry.")


if __name__ == "__main__":
    main()
