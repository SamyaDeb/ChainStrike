# ChainStrike Smart Contracts

Algorand smart contracts for the ChainStrike derivatives exchange.

## Contracts

1. **OptionsPool** - Manages liquidity pool for options trading
2. **OptionsMarket** - Handles options creation, trading, and settlement
3. **PerpetualsPool** - Manages liquidity for perpetual contracts
4. **PerpetualsMarket** - Perpetuals trading and position management
5. **Oracle** - Multi-source price oracle for ALGO
6. **StrikeToken** - STRIKE governance token
7. **Staking** - STRIKE token staking and rewards

## Development

```bash
# Install dependencies
algokit project bootstrap all

# Build contracts
algokit project run build

# Run tests
algokit project run test

# Deploy to TestNet
algokit project deploy testnet
```

## Contract Architecture

- All contracts built with Algorand Python (Puya)
- Deployed on Algorand TestNet
- Price oracle aggregates from Binance, CoinGecko, and Vestige
- Options and perps use liquidity pool model
- Automated liquidation and settlement via keeper bots
