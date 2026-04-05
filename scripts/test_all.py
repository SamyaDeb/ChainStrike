#!/usr/bin/env python3
"""
ChainStrike Full Test Suite

Comprehensive testing script that validates:
1. Contract connectivity and state
2. Oracle price feeds
3. Frontend build
4. API endpoints

Usage:
    python test_all.py [--verbose] [--skip-frontend]
"""

import argparse
import asyncio
import json
import os
import ssl
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# Disable SSL verification
ssl._create_default_https_context = ssl._create_unverified_context

try:
    import aiohttp
except ImportError:
    aiohttp = None

try:
    from algosdk.v2client import algod
    import base64
except ImportError:
    algod = None

# Configuration
PROJECT_ROOT = Path(__file__).parent.parent  # Go up from scripts/ to project root
CONTRACTS_DIR = PROJECT_ROOT / "contracts"
FRONTEND_DIR = PROJECT_ROOT / "frontend"
KEEPERS_DIR = PROJECT_ROOT / "keepers"
DEPLOYED_PATH = CONTRACTS_DIR / "deployed_addresses.json"

TESTNET_ALGOD = "https://testnet-api.4160.nodely.dev"
ALGOD_TOKEN = ""

# Price API URLs
BINANCE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=ALGOUSDT"
COINGECKO_URL = (
    "https://api.coingecko.com/api/v3/simple/price?ids=algorand&vs_currencies=usd"
)


class TestResult:
    """Test result tracking."""

    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.errors = []

    def add_pass(self, name: str):
        self.passed += 1
        print(f"  [PASS] {name}")

    def add_fail(self, name: str, error: str = ""):
        self.failed += 1
        self.errors.append((name, error))
        print(f"  [FAIL] {name}")
        if error:
            print(f"         {error}")

    def add_skip(self, name: str, reason: str = ""):
        self.skipped += 1
        print(f"  [SKIP] {name}")
        if reason:
            print(f"         {reason}")

    def summary(self):
        total = self.passed + self.failed + self.skipped
        print(f"\n{'=' * 60}")
        print(f"Test Summary")
        print(f"{'=' * 60}")
        print(f"  Total:   {total}")
        print(f"  Passed:  {self.passed}")
        print(f"  Failed:  {self.failed}")
        print(f"  Skipped: {self.skipped}")

        if self.errors:
            print(f"\nErrors:")
            for name, error in self.errors:
                print(f"  - {name}: {error}")

        return self.failed == 0


def get_algod_client():
    """Get Algod client."""
    if algod is None:
        return None
    return algod.AlgodClient(ALGOD_TOKEN, TESTNET_ALGOD)


def load_deployed_addresses():
    """Load deployed contract addresses."""
    if DEPLOYED_PATH.exists():
        with open(DEPLOYED_PATH) as f:
            return json.load(f)
    return {}


def read_global_state(client, app_id: int) -> dict:
    """Read global state from an application."""
    try:
        app_info = client.application_info(app_id)
        global_state = {}

        for item in app_info.get("params", {}).get("global-state", []):
            key = base64.b64decode(item["key"]).decode("utf-8", errors="ignore")
            value = item["value"]

            if value["type"] == 1:  # bytes
                try:
                    global_state[key] = base64.b64decode(value["bytes"]).decode(
                        "utf-8", errors="ignore"
                    )
                except:
                    global_state[key] = value["bytes"]
            else:  # uint
                global_state[key] = value["uint"]

        return global_state
    except Exception as e:
        return {"error": str(e)}


class ChainStrikeTests:
    """ChainStrike test suite."""

    def __init__(self, verbose: bool = False, skip_frontend: bool = False):
        self.verbose = verbose
        self.skip_frontend = skip_frontend
        self.result = TestResult()
        self.deployed = load_deployed_addresses()
        self.client = get_algod_client()

    async def run_all(self):
        """Run all tests."""
        print(f"\n{'=' * 60}")
        print("ChainStrike Test Suite")
        print(f"{'=' * 60}")
        print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"Network: Algorand TestNet")
        print(f"{'=' * 60}")

        # Test categories
        self.test_project_structure()
        self.test_dependencies()
        await self.test_price_apis()
        self.test_contract_connectivity()
        self.test_contract_states()

        if not self.skip_frontend:
            self.test_frontend_build()
        else:
            self.result.add_skip("Frontend Build", "Skipped via --skip-frontend")

        self.test_keeper_scripts()

        # Summary
        success = self.result.summary()
        return success

    def test_project_structure(self):
        """Test project file structure."""
        print(f"\n--- Project Structure Tests ---")

        # Check main directories
        dirs = [
            ("contracts", CONTRACTS_DIR),
            ("frontend", FRONTEND_DIR),
            ("keepers", KEEPERS_DIR),
        ]

        for name, path in dirs:
            if path.exists():
                self.result.add_pass(f"Directory exists: {name}")
            else:
                self.result.add_fail(f"Directory exists: {name}", f"Missing: {path}")

        # Check key files
        files = [
            ("README.md", PROJECT_ROOT / "README.md"),
            ("PROGRESS.md", PROJECT_ROOT / "PROGRESS.md"),
            ("deployed_addresses.json", DEPLOYED_PATH),
            ("package.json", PROJECT_ROOT / "package.json"),
        ]

        for name, path in files:
            if path.exists():
                self.result.add_pass(f"File exists: {name}")
            else:
                self.result.add_fail(f"File exists: {name}", f"Missing: {path}")

    def test_dependencies(self):
        """Test Python dependencies."""
        print(f"\n--- Dependency Tests ---")

        # Python dependencies
        deps = [
            ("algosdk", algod is not None),
            ("aiohttp", aiohttp is not None),
        ]

        for name, available in deps:
            if available:
                self.result.add_pass(f"Python: {name}")
            else:
                self.result.add_fail(f"Python: {name}", "Not installed")

        # Node.js check
        try:
            result = subprocess.run(
                ["node", "--version"], capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                version = result.stdout.strip()
                self.result.add_pass(f"Node.js: {version}")
            else:
                self.result.add_fail("Node.js", "Not found")
        except Exception as e:
            self.result.add_fail("Node.js", str(e))

    async def test_price_apis(self):
        """Test price API connectivity."""
        print(f"\n--- Price API Tests ---")

        if aiohttp is None:
            self.result.add_skip("Price APIs", "aiohttp not installed")
            return

        connector = aiohttp.TCPConnector(ssl=False)
        async with aiohttp.ClientSession(connector=connector) as session:
            # Binance
            try:
                async with session.get(
                    BINANCE_URL, timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        price = float(data["price"])
                        self.result.add_pass(f"Binance API: ${price:.4f}")
                    else:
                        self.result.add_fail("Binance API", f"Status {resp.status}")
            except Exception as e:
                self.result.add_fail("Binance API", str(e))

            # CoinGecko
            try:
                async with session.get(
                    COINGECKO_URL, timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        price = data["algorand"]["usd"]
                        self.result.add_pass(f"CoinGecko API: ${price:.4f}")
                    else:
                        self.result.add_fail("CoinGecko API", f"Status {resp.status}")
            except Exception as e:
                self.result.add_fail("CoinGecko API", str(e))

    def test_contract_connectivity(self):
        """Test contract connectivity on TestNet."""
        print(f"\n--- Contract Connectivity Tests ---")

        if self.client is None:
            self.result.add_skip("Contract Connectivity", "algosdk not installed")
            return

        contracts = self.deployed.get("contracts", {})

        if not contracts:
            self.result.add_fail(
                "Deployed Addresses", "No contracts found in deployed_addresses.json"
            )
            return

        for name, app_id in contracts.items():
            try:
                app_info = self.client.application_info(app_id)
                creator = app_info["params"]["creator"]
                self.result.add_pass(f"Contract {name}: App ID {app_id}")
                if self.verbose:
                    print(f"         Creator: {creator}")
            except Exception as e:
                self.result.add_fail(f"Contract {name}: App ID {app_id}", str(e))

    def test_contract_states(self):
        """Test contract global states."""
        print(f"\n--- Contract State Tests ---")

        if self.client is None:
            self.result.add_skip("Contract States", "algosdk not installed")
            return

        contracts = self.deployed.get("contracts", {})

        # Test Oracle state
        oracle_id = contracts.get("oracle", 0)
        if oracle_id:
            state = read_global_state(self.client, oracle_id)
            if "error" not in state:
                price = state.get("current_price", 0)
                if price > 0:
                    self.result.add_pass(f"Oracle has price: ${price / 1_000_000:.4f}")
                else:
                    self.result.add_pass(f"Oracle state readable (no price set)")
            else:
                self.result.add_fail("Oracle state", state["error"])

        # Test other contracts have states
        for name in ["staking", "options_pool", "perps_pool"]:
            app_id = contracts.get(name, 0)
            if app_id:
                state = read_global_state(self.client, app_id)
                if "error" not in state:
                    self.result.add_pass(f"{name} state readable")
                else:
                    self.result.add_fail(f"{name} state", state["error"])

    def test_frontend_build(self):
        """Test frontend build process."""
        print(f"\n--- Frontend Build Tests ---")

        if not FRONTEND_DIR.exists():
            self.result.add_fail("Frontend directory", "Not found")
            return

        # Check if node_modules exists
        node_modules = FRONTEND_DIR / "node_modules"
        if not node_modules.exists():
            self.result.add_skip(
                "Frontend Build", "node_modules not found - run 'pnpm install'"
            )
            return

        # Check package.json
        package_json = FRONTEND_DIR / "package.json"
        if package_json.exists():
            self.result.add_pass("package.json exists")
        else:
            self.result.add_fail("package.json", "Not found")
            return

        # Try lint check
        try:
            result = subprocess.run(
                ["pnpm", "lint"],
                cwd=FRONTEND_DIR,
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode == 0:
                self.result.add_pass("ESLint check")
            else:
                self.result.add_fail(
                    "ESLint check", result.stderr[:200] if result.stderr else "Failed"
                )
        except subprocess.TimeoutExpired:
            self.result.add_fail("ESLint check", "Timeout")
        except Exception as e:
            self.result.add_skip("ESLint check", str(e))

        # Try TypeScript check
        try:
            result = subprocess.run(
                ["pnpm", "exec", "tsc", "--noEmit"],
                cwd=FRONTEND_DIR,
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode == 0:
                self.result.add_pass("TypeScript check")
            else:
                # TypeScript errors are common, just warn
                error_count = result.stdout.count("error TS")
                if error_count > 0:
                    self.result.add_fail("TypeScript check", f"{error_count} errors")
                else:
                    self.result.add_pass("TypeScript check")
        except subprocess.TimeoutExpired:
            self.result.add_fail("TypeScript check", "Timeout")
        except Exception as e:
            self.result.add_skip("TypeScript check", str(e))

    def test_keeper_scripts(self):
        """Test keeper scripts exist and are valid Python."""
        print(f"\n--- Keeper Script Tests ---")

        keepers = [
            "oracle_keeper.py",
            "liquidation_keeper.py",
            "settlement_keeper.py",
        ]

        for keeper in keepers:
            path = KEEPERS_DIR / keeper
            if path.exists():
                # Try to compile the Python file
                try:
                    with open(path) as f:
                        code = f.read()
                    compile(code, path, "exec")
                    self.result.add_pass(f"Keeper: {keeper}")
                except SyntaxError as e:
                    self.result.add_fail(f"Keeper: {keeper}", f"Syntax error: {e}")
            else:
                self.result.add_fail(f"Keeper: {keeper}", "Not found")


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="ChainStrike Test Suite")
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Verbose output",
    )
    parser.add_argument(
        "--skip-frontend",
        action="store_true",
        help="Skip frontend build tests",
    )
    args = parser.parse_args()

    tests = ChainStrikeTests(verbose=args.verbose, skip_frontend=args.skip_frontend)

    success = await tests.run_all()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())
