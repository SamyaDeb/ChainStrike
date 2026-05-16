# ChainStrike — Institution-Grade RWA Orderbook Exchange on Algorand

A permissioned, compliant orderbook-based exchange for Real World Asset (RWA) tokenization and trading, built on the Algorand blockchain. ChainStrike enables institutions to issue tokenized assets, manage KYC/KYB compliance, and execute atomic settlement with cryptographic certainty.

## 🏗️ Architecture

ChainStrike is a full-stack monorepo with:

- **Frontend Applications**
  - `apps/web` — Investor trading platform (Next.js + Wallet integration)
  - `apps/issuer` — Asset issuer dashboard (Next.js + Admin UI)
  - `apps/admin` — Platform administration (Next.js)

- **Backend Services**
  - `services/asset` — Asset tokenization & lifecycle management
  - `services/compliance` — AML/KYC/KYB rule engine
  - `services/identity` — User authentication & wallet management
  - `services/orderbook` — Central limit order book (CLOB) with WebSocket feeds
  - `services/settlement` — Atomic settlement execution & clearing
  - `services/analytics` — Event aggregation & reporting
  - `services/notification` — Real-time user notifications

- **Core Packages**
  - `packages/algorand` — Algorand SDK wrapper (ASA, ARC-20, transactions)
  - `packages/types` — Shared TypeScript type definitions

- **Smart Contracts**
  - `contracts/token-vault` — Asset custody & issuance
  - `contracts/issuance-escrow` — Settlement escrow logic
  - `contracts/marketplace` — Orderbook execution (if applicable)

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- Algorand Sandbox (optional, for local testing)

### Development

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Start all services (Turbo monorepo)
npm run dev

# Run services individually
npm run dev --filter=asset-service
npm run dev --filter=web

# Build for production
npm run build

# Run tests
npm run test
```

### Docker Deployment

```bash
# Start entire stack with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

## 📋 Core Features

### Asset Issuance
- Create and manage RWA tokens using ARC-20 standard
- Multi-step issuance workflow with document uploads
- Asset metadata management (ISIN, currency, yield, etc.)

### Compliance Engine
- **KYC/KYB** — Multi-tier identity verification
- **AML Checks** — Sanctions list screening & transaction monitoring
- **Whitelist Management** — Institutional investor control
- **Audit Trail** — Complete compliance history

### Trading Infrastructure
- **Orderbook** — Central limit order book with real-time WebSocket feeds
- **Order Types** — Limit, market, and conditional orders
- **Risk Management** — Position limits, collateral tracking
- **Asset Opt-In** — Algorand asset opt-in workflow (ASA)

### Settlement
- **Atomic Swaps** — Crypto-verified settlement
- **Custody** — Multi-sig escrow for assets
- **Clearing** — T+0 or T+N settlement cycles
- **Vault Management** — Token custody & recovery

### Market Data
- Real-time order feeds via WebSocket
- Historical trade data & analytics
- Performance reporting & P&L tracking

## 🔐 Security Considerations

- **All authentication** uses Wallet-based signing (no passwords)
- **Smart contracts** hold assets in custody (not centralized wallets)
- **Settlement** requires cryptographic proof & multi-sig approval
- **Compliance rules** are enforced at the service layer
- **Audit logging** captures all state changes

## 📦 Deployment

### Environment Variables
See `.env.example` for full configuration. Key variables:

```
ALGORAND_NETWORK=mainnet|testnet|devnet
ALGORAND_NODE_URL=https://...
ALGOD_TOKEN=...

# Database connections
DATABASE_URL=postgres://...
REDIS_URL=redis://...

# Service ports
ASSET_SERVICE_PORT=3001
COMPLIANCE_SERVICE_PORT=3002
ORDERBOOK_SERVICE_PORT=3003
SETTLEMENT_SERVICE_PORT=3004
```

### Vercel Deployment (Next.js apps)
```bash
# Deploy web app
vercel deploy --prod apps/web

# Deploy issuer app
vercel deploy --prod apps/issuer

# Deploy admin app
vercel deploy --prod apps/admin
```

### Kubernetes (Services)
Helm charts and k8s manifests available in `infrastructure/k8s/`.

## 📊 Project Phases (Implementation)

1. ✅ **Architecture & Infrastructure** — Monorepo setup, service scaffolding
2. ✅ **Core Authentication** — Wallet-based sign-in
3. ✅ **Asset Management** — Issuance & tokenization
4. ✅ **Algorand Integration** — On-chain ASA interaction
5. ✅ **Compliance Engine** — KYC/AML/Whitelist
6. ✅ **Orderbook** — CLOB implementation
7. ✅ **Settlement** — Atomic swap execution
8. ✅ **Web Trading App** — Investor platform
9. ✅ **Issuer Dashboard** — Asset management UI
10. ✅ **Admin Panel** — Platform operations

**Current Phase:** Phase 11 (Analytics, Notifications, Production Hardening)

## 🧪 Testing

```bash
# Unit tests
npm run test

# Integration tests
npm run test:integration

# E2E tests (Playwright)
npm run test:e2e

# Contract testing
npm run test:contracts
```

## 📚 Documentation

- **[Implementation Guide](./Implementation.md)** — Detailed phase-wise architecture & decisions
- **[API Reference](./docs/api.md)** — REST & WebSocket endpoints
- **[Smart Contract Specs](./contracts/README.md)** — ARC-20, escrow, settlement logic
- **[Deployment Guide](./docs/deployment.md)** — Production setup & monitoring

## 🔗 External Integrations

- **Algorand** — Blockchain for asset settlement
- **PostgreSQL** — Core relational data (assets, orders, users)
- **Redis** — Order cache, session management
- **WebSocket** — Real-time order feeds & notifications

## 📞 Support & Contributing

- **Issues** — GitHub Issues for bugs & feature requests
- **Discussions** — GitHub Discussions for architecture questions
- **Contributing** — See CONTRIBUTING.md for PR guidelines

## 📄 License

Proprietary — All rights reserved.

---

**Built with:** TypeScript, Next.js, NestJS, Algorand SDK, PostgreSQL, Redis
