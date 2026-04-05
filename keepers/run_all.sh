#!/bin/bash
# Run all ChainStrike keeper bots

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================="
echo "ChainStrike Keeper Bots"
echo "=========================================="
echo ""

# Check dependencies
python3 -c "import algosdk; import aiohttp" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "Installing dependencies..."
    pip install -r "$SCRIPT_DIR/requirements.txt"
fi

echo "Starting keepers..."
echo ""

# Start Oracle Keeper
echo "[1/3] Starting Oracle Keeper..."
python3 "$SCRIPT_DIR/oracle_keeper.py" --dry-run &
ORACLE_PID=$!
echo "      PID: $ORACLE_PID"

# Start Liquidation Keeper
echo "[2/3] Starting Liquidation Keeper..."
python3 "$SCRIPT_DIR/liquidation_keeper.py" --dry-run &
LIQUIDATION_PID=$!
echo "      PID: $LIQUIDATION_PID"

# Start Settlement Keeper
echo "[3/3] Starting Settlement Keeper..."
python3 "$SCRIPT_DIR/settlement_keeper.py" --dry-run &
SETTLEMENT_PID=$!
echo "      PID: $SETTLEMENT_PID"

echo ""
echo "All keepers started in dry-run mode."
echo "Press Ctrl+C to stop all keepers."
echo ""

# Wait for interrupt
trap "echo 'Stopping keepers...'; kill $ORACLE_PID $LIQUIDATION_PID $SETTLEMENT_PID 2>/dev/null; exit" INT TERM

wait
