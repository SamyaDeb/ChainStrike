#!/bin/bash
#
# ChainStrike Keeper Services
# Runs both Oracle and Settlement keepers for Quick Options support
#
# Usage:
#   ./run_keepers.sh          # Run both keepers
#   ./run_keepers.sh oracle   # Run only oracle keeper
#   ./run_keepers.sh settle   # Run only settlement keeper
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           ChainStrike Keeper Services                      ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "Python3 is required but not installed."
    exit 1
fi

# Activate virtual environment if it exists
if [ -d "../.venv" ]; then
    source "../.venv/bin/activate"
    echo -e "${YELLOW}Activated virtual environment${NC}"
fi

case "${1:-all}" in
    oracle)
        echo "Starting Oracle Keeper only..."
        python3 keeper_oracle.py
        ;;
    settle|settlement)
        echo "Starting Settlement Keeper only..."
        python3 keeper_settlement.py
        ;;
    all|*)
        echo "Starting both Oracle and Settlement Keepers..."
        echo ""
        
        # Run both keepers in parallel
        python3 keeper_oracle.py &
        ORACLE_PID=$!
        
        python3 keeper_settlement.py &
        SETTLE_PID=$!
        
        echo -e "${GREEN}Oracle Keeper PID: $ORACLE_PID${NC}"
        echo -e "${GREEN}Settlement Keeper PID: $SETTLE_PID${NC}"
        echo ""
        echo "Press Ctrl+C to stop both keepers..."
        
        # Wait for both processes
        trap "kill $ORACLE_PID $SETTLE_PID 2>/dev/null; exit" SIGINT SIGTERM
        wait
        ;;
esac
