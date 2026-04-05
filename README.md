# ChainStrike

**Decentralized Derivatives Trading Platform on Algorand**

ChainStrike is a cutting-edge DeFi platform enabling perpetual futures and options trading on the Algorand blockchain. Built with Algorand Python (Puya) smart contracts and a modern Next.js frontend.

![Algorand](https://img.shields.io/badge/Algorand-000000?style=for-the-badge&logo=algorand&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)

## Features

### Perpetual Futures Trading

- **Up to 50x Leverage** - Trade ALGO/USD perpetuals with high leverage
- **Long & Short Positions** - Profit from both rising and falling markets
- **Funding Rate Mechanism** - Fair price discovery through periodic funding payments
- **Real-time Liquidations** - Automated keeper bots ensure protocol solvency

### Options Trading

- **Call & Put Options** - Trade European-style options on ALGO/USD
- **Multiple Expiries** - 5-minute, hourly, daily, and weekly options
- **Dynamic Strike Prices** - ATM, ITM, and OTM strikes based on oracle price
- **Black-Scholes Pricing** - Industry-standard premium calculations

### Liquidity Pools

- **Single-sided ALGO Deposits** - Provide liquidity with just ALGO
- **Protocol Revenue Sharing** - Earn trading fees and premiums
- **Auto-compounding** - Rewards automatically reinvested

### Staking

- **STRIKE Token Staking** - Stake governance tokens for rewards
- **Tiered Rewards** - Higher stakes earn better multipliers
- **Platform Fee Distribution** - Share in protocol revenue

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                        │
├─────────────────────────────────────────────────────────────────┤
│  Components    │    Hooks      │   Services   │    Stores       │
│  - Trading UI  │  - useTrading │  - contracts │  - priceStore   │
│  - Pool UI     │  - usePool    │  - oracle    │  - uiStore      │
│  - Staking UI  │  - useStaking │  - premium   │                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Algorand Smart Contracts                      │
├─────────────────────────────────────────────────────────────────┤
│  Oracle          │  Perpetuals     │  Options       │  Staking  │
│  - Price feeds   │  - Market       │  - Market      │  - Stake  │
│  - TWAP          │  - Pool         │  - Pool        │  - Claim  │
│  - Updates       │  - Positions    │  - Options     │  - Unstake│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Keeper Bots                               │
├─────────────────────────────────────────────────────────────────┤
│  Oracle Keeper     │  Settlement Keeper   │  Liquidation Keeper │
│  - Price updates   │  - Option expiry     │  - Position health  │
│  - Every 30s       │  - Payout calc       │  - Auto-liquidate   │
└─────────────────────────────────────────────────────────────────┘
```

## Smart Contracts

| Contract         | Description                     | App ID (TestNet) |
| ---------------- | ------------------------------- | ---------------- |
| Oracle           | Price feed aggregator with TWAP | 758290477        |
| PerpetualsMarket | Perpetual futures trading logic | 758290831        |
| PerpetualsPool   | Liquidity pool for perps        | 758290663        |
| OptionsMarket    | Options trading and settlement  | 758290651        |
| OptionsPool      | Liquidity pool for options      | 758290646        |
| Staking          | STRIKE token staking rewards    | -                |
| StrikeToken      | Governance token (ARC-20)       | -                |

## Project Structure

```
ChainStrike/
├── contracts/              # Algorand Python smart contracts
│   ├── oracle.py          # Price oracle with TWAP
│   ├── perpetuals_market.py  # Perps trading engine
│   ├── perpetuals_pool.py    # Perps liquidity pool
│   ├── options_market.py     # Options trading engine
│   ├── options_pool.py       # Options liquidity pool
│   ├── staking.py            # Token staking
│   ├── strike_token.py       # Governance token
│   └── scripts/              # Deployment & testing scripts
├── frontend/               # Next.js web application
│   ├── src/
│   │   ├── app/           # Next.js app router pages
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── services/      # Contract interaction services
│   │   ├── stores/        # Zustand state stores
│   │   ├── lib/           # Utility functions
│   │   ├── types/         # TypeScript definitions
│   │   └── config/        # Configuration files
│   └── public/            # Static assets
├── keepers/                # Automated keeper bots
│   ├── oracle_keeper.py   # Price feed updates
│   ├── settlement_keeper.py  # Option settlements
│   └── liquidation_keeper.py # Position liquidations
└── docs/                   # Documentation
```

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Python 3.12+
- AlgoKit CLI
- Algorand TestNet account with ALGO

### Installation

```bash
# Clone the repository
git clone https://github.com/SamyaDeb/ChainStrike.git
cd ChainStrike

# Install frontend dependencies
cd frontend
npm install

# Install contract dependencies
cd ../contracts
pip install -r requirements.txt  # or use algokit
```

### Running the Frontend

```bash
cd frontend
npm run dev
```

Visit `http://localhost:3000` to access the application.

### Compiling Contracts

```bash
cd contracts
algokit compile py oracle.py
algokit compile py perpetuals_market.py
algokit compile py perpetuals_pool.py
algokit compile py options_market.py
algokit compile py options_pool.py
```

### Running Keepers

```bash
cd keepers
# Set environment variables
export ALGORAND_MNEMONIC="your mnemonic here"

# Run individual keepers
python oracle_keeper.py
python settlement_keeper.py
python liquidation_keeper.py

# Or run all keepers
./run_all.sh
```

## Trading Guide

### Opening a Perpetual Position

1. Connect your wallet (Pera, Defly, or Lute)
2. Navigate to Trade → Perpetuals
3. Select Long or Short
4. Enter position size and leverage (1x-50x)
5. Review margin requirement and liquidation price
6. Click "Open Position"

### Trading Options

1. Connect your wallet
2. Navigate to Trade → Options
3. Select Call or Put
4. Choose strike price and expiry
5. Enter number of contracts
6. Review premium and potential payout
7. Click "Buy Option"

### Providing Liquidity

1. Navigate to Pool
2. Enter amount of ALGO to deposit
3. Review expected LP tokens
4. Click "Deposit"

## Technical Details

### Position Mechanics

**Perpetuals:**

- Positions stored in contract box storage (BoxMap)
- Position struct: 106 bytes (id, trader, is_long, size, collateral, leverage, entry_price, liquidation_price, funding_time, accumulated_funding, open_time, is_open)
- Liquidation when margin ratio falls below 5%
- Funding rate calculated every 8 hours

**Options:**

- European-style (exercise only at expiry)
- Premium calculated using Black-Scholes model
- Settlement based on oracle price at expiry
- ITM options auto-exercised by settlement keeper

### Oracle Design

- Price updates every 30 seconds by keeper
- 6-decimal precision (1 ALGO = 1,000,000 units)
- TWAP (Time-Weighted Average Price) for liquidations
- Multiple authorized price feeders supported

### Security Features

- Reentrancy protection on all state-changing methods
- Access control on admin functions
- Price staleness checks
- Maximum leverage limits
- Minimum collateral requirements

## Tech Stack

### Frontend

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + Custom Cyberpunk Theme
- **UI Components**: shadcn/ui + Radix UI
- **State Management**: Zustand
- **Blockchain**: algosdk, @txnlab/use-wallet-react
- **Charts**: Lightweight Charts
- **Animations**: Framer Motion

### Smart Contracts

- **Language**: Algorand Python (Puya)
- **Network**: Algorand TestNet
- **Oracle**: Multi-source (Binance + CoinGecko + Vestige)
- **Standards**: ARC4, ARC56

### Design System

- **Theme**: Dark Cyberpunk
- **Colors**: Neon purple, blue, cyan gradients
- **Effects**: Glassmorphism, neon glows, shadows
- **Fonts**: Inter (sans), JetBrains Mono (mono)

## Development

### Running Tests

```bash
# Contract tests
cd contracts
python -m pytest scripts/test_*.py

# Frontend tests
cd frontend
npm run test
```

### Building for Production

```bash
cd frontend
npm run build
```

## Deployment

### TestNet (Current)

The contracts are deployed on Algorand TestNet. Get TestNet ALGO from the [Algorand Faucet](https://bank.testnet.algorand.network/).

### MainNet

For MainNet deployment, update the contract app IDs in `frontend/src/config/contracts.ts` and set the network configuration in `frontend/src/config/networks.ts`.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Algorand Foundation](https://algorand.foundation/) for the blockchain infrastructure
- [AlgoKit](https://github.com/algorandfoundation/algokit-cli) for development tooling
- [Pera Wallet](https://perawallet.app/) for wallet integration
- [TradingView](https://www.tradingview.com/) for charting widgets

## Contact

- GitHub: [@SamyaDeb](https://github.com/SamyaDeb)
- Email: sammodeb28@gmail.com

---

**Disclaimer:** This is experimental software. Use at your own risk. Always test thoroughly on TestNet before using real funds.

**Built with love on Algorand**
