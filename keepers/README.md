# ChainStrike Keepers

Automated keeper bots for maintaining the ChainStrike protocol on Algorand.

## Available Keepers

### 1. Oracle Keeper (`oracle_keeper.py`)
Updates the on-chain price oracle with ALGO/USD prices from multiple sources:
- Binance (real-time trading)
- CoinGecko (aggregated market)
- Vestige (on-chain DEX)

### 2. Liquidation Keeper (`liquidation_keeper.py`)
Monitors perpetual futures positions and liquidates unhealthy positions when margin ratio falls below the minimum threshold (5%).

### 3. Settlement Keeper (`settlement_keeper.py`)
Settles expired options contracts automatically, distributing payouts to in-the-money option holders.

## Installation

```bash
# Install dependencies
pip install py-algorand-sdk aiohttp

# Or with pip and requirements
pip install -r requirements.txt
```

## Usage

### Oracle Keeper
```bash
# Run continuously (updates every 60 seconds)
python oracle_keeper.py

# Custom interval
python oracle_keeper.py --interval 30

# Dry run (no transactions)
python oracle_keeper.py --dry-run

# Run once and exit
python oracle_keeper.py --once
```

### Liquidation Keeper
```bash
# Run continuously (checks every 30 seconds)
python liquidation_keeper.py

# Dry run mode
python liquidation_keeper.py --dry-run
```

### Settlement Keeper
```bash
# Run continuously (checks every 60 seconds)
python settlement_keeper.py

# Dry run mode
python settlement_keeper.py --dry-run
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `KEEPER_MNEMONIC` | 25-word mnemonic for keeper account | TestNet deployer |
| `ORACLE_APP_ID` | Oracle contract app ID | From deployed_addresses.json |
| `PERPS_MARKET_APP_ID` | Perps market app ID | From deployed_addresses.json |
| `OPTIONS_MARKET_APP_ID` | Options market app ID | From deployed_addresses.json |

## Running All Keepers

To run all keepers simultaneously:

```bash
# Start all keepers in background
python oracle_keeper.py &
python liquidation_keeper.py &
python settlement_keeper.py &

# Or use the run_all script
./run_all.sh
```

## Funding the Keeper

The keeper account needs ALGO for transaction fees. On TestNet:

1. Get your keeper address from the output
2. Visit https://bank.testnet.algorand.network/
3. Request TestNet ALGO

## Architecture

```
keepers/
├── oracle_keeper.py      # Price oracle updater
├── liquidation_keeper.py # Position liquidator
├── settlement_keeper.py  # Option settlement
├── requirements.txt      # Python dependencies
└── README.md            # This file
```

## Monitoring

Each keeper prints status updates including:
- Current prices/positions
- Transaction hashes
- Error counts
- Success statistics

For production, consider:
- Running keepers as systemd services
- Adding logging to files
- Setting up alerts for errors
- Using a dedicated keeper account
