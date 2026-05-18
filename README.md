# ChainStrike

**Institutional RWA tokenization and AMM trading on Algorand.**

ChainStrike lets issuers tokenize real-world assets (real estate, private credit, bonds, commodities) as Algorand Standard Assets and list them on a Tinyman V2 AMM pool — with built-in KYC/KYB compliance, multi-step issuer verification, and on-chain custody through per-asset smart contracts.

---

## How It Works

### For Issuers
1. Register and complete KYC/KYB
2. Submit asset application with legal documents and USDC liquidity deposit
3. Admin verifies the asset through 5 compliance stages
4. Admin deploys the ASA and seeds the Tinyman V2 liquidity pool
5. Asset goes live — LP tokens held in vault for 90-day lockup, then claimable by issuer

### For Investors
1. Register, complete KYC, connect Algorand wallet (Pera / Defly)
2. Opt into the RWA asset (admin unfreezes wallet via compliance registry)
3. Swap USDC ↔ RWA tokens directly on the Tinyman pool
4. Provide liquidity: deposit USDC, receive LP tokens, earn swap fees

---

## Stack

| Layer | Technology |
|---|---|
| Blockchain | Algorand (testnet / mainnet) |
| Smart Contracts | AVM / ARC-4 (PyTEAL / Algorand Python) |
| AMM | Tinyman V2 |
| Backend | NestJS microservices |
| Frontend | Next.js 15 (App Router) |
| Database | PostgreSQL (per-service schemas via Prisma) |
| Monorepo | Turborepo + npm workspaces |

---

## Services

| Service | Port | Responsibility |
|---|---|---|
| `api-gateway` | 8080 | Reverse proxy, JWT auth, rate limiting |
| `identity` | 3001 | Registration, login, KYC/KYB, wallets |
| `asset` | 3002 | Asset lifecycle, Algorand on-chain ops, AMM |
| `compliance` | 3004 | Whitelist, freeze/unfreeze, AML |
| `settlement` | 3005 | Trade settlement (legacy, kept for future) |
| `notification` | 3006 | Event fan-out, push notifications |
| `analytics` | 3007 | Event aggregation |
| `web` | 3000 | Next.js investor + issuer frontend |

---

## Smart Contracts

| Contract | Role |
|---|---|
| `IssuanceLiquidityEscrow` | Holds issuer USDC during the verification period |
| `TokenVault` | Custodian for RWA tokens, USDC, and LP tokens per asset |
| `ComplianceRegistry` / `WhitelistRegistry` | On-chain whitelist enforcement for `defaultFrozen` ASAs |
| `TransferRestriction` | Enforces compliance rules before any token transfer |
| Tinyman V2 Pool | AMM pool per asset (price discovery, swap, liquidity) |

---

## Repository Layout

```
apps/
  api-gateway/       NestJS reverse proxy
  web/               Next.js 15 — markets, trade, liquidity, issuer, profile
  issuer/            (legacy standalone issuer UI)
  admin/             Admin operations panel

services/
  identity/          Auth, KYC, wallet registration
  asset/             Asset CRUD, ASA deploy, activate market, price feed
  compliance/        Whitelist, AML, freeze enforcement
  settlement/        Atomic trade settlement
  notification/      Push and email notifications
  analytics/         Event aggregation and reporting

packages/
  algorand/          Algorand SDK wrapper (ASA, ARC-3, transactions)
  events/            Kafka topic registry
  types/             Shared TypeScript types
  config/            Shared NestJS config helpers
  database/          Shared Prisma utilities
  logger/            Structured logger

contracts/
  issuance-escrow/   Holds issuer USDC until verification completes
  token-vault/       Per-asset custody vault
  whitelist-registry/On-chain compliance registry
  transfer-restriction/ Transfer compliance enforcement
  settlement-contract/  Atomic swap settlement
  smart-asa-factory/ ASA creation helpers
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL (one instance, per-service schemas)
- An Algorand testnet wallet funded with ALGO and testnet USDC (`ASA 10458941`)
- WalletConnect project ID from [cloud.walletconnect.com](https://cloud.walletconnect.com)

### Setup

```bash
# 1. Clone and install
git clone <repo>
cd csv2
npm install

# 2. Configure environment
cp .env.example .env
# Fill in:
#   ALGORAND_ADMIN_MNEMONIC  — funded testnet wallet (platform key)
#   JWT_SECRET               — openssl rand -hex 32
#   NEXT_PUBLIC_WC_PROJECT_ID
#   *_DATABASE_URL           — PostgreSQL connection strings

# 3. Run database migrations
npm run db:init

# 4. Start all services
npm run dev
```

The frontend is at `http://localhost:3000`. The API gateway is at `http://localhost:8080/api/v1`.

### Testnet E2E Flow

```bash
# Run the full automated test suite (requires services running + funded wallet)
npm run e2e

# Or step by step:
npm run e2e:health       # 00 — all services reachable
npm run e2e:issuer       # 01 — register issuer, submit asset
npm run e2e:admin        # 02 — admin approval, ASA deploy
npm run e2e:distribute   # 03 — distribute tokens, verify issuer wallet
npm run e2e:activate     # 04 — activate market, seed Tinyman pool
npm run e2e:buy          # 05 — verify pool + investor readiness
npm run e2e:settle       # 06 — price history check
npm run e2e:frontend     # 07 — verify all frontend API endpoints
```

---

## Key Flows

### Asset Activation (Admin)

`PATCH /api/v1/assets/:id/activate` triggers a sequence of 8 on-chain steps:

1. Release USDC from `IssuanceLiquidityEscrow` → `TokenVault`
2. Vault withdraws RWA tokens + USDC to admin wallet
3. Bootstrap Tinyman V2 pool at the listing price
4. Unfreeze pool address for the RWA ASA
5. Admin deposits both assets → receives LP tokens
6. LP tokens transferred: admin → vault (90-day lockup)
7. Asset status → `ACTIVE`, `listedAt` set
8. Push notification to issuer

### Swap (Investor, browser-only)

Swaps are executed entirely on-chain via Tinyman SDK — no backend involvement:

```
Investor wallet  →  Tinyman V2 pool  →  RWA tokens delivered
     USDC                                  0.3% fee to LP holders
```

The `SwapPanel` component on `/trade/:assetId` handles quoting, slippage, and signing via Pera/Defly wallet.

### Liquidity Provision (Investor, browser-only)

Single-asset (USDC-only) liquidity via `AddLiquidity.v2.withSingleAsset`:

```
/liquidity/:assetId  →  LiquidityPanel  →  Tinyman SDK  →  LP tokens returned
```

---

## Environment Variables

See `.env.example` for the full reference. Key required variables:

```bash
# Algorand
ALGORAND_NETWORK=testnet
ALGORAND_ALGOD_SERVER=https://testnet-api.algonode.cloud
ALGORAND_ADMIN_MNEMONIC="..."          # Platform signing key

# Auth
JWT_SECRET=...                          # 64-char hex

# Database (PostgreSQL, one instance)
IDENTITY_DATABASE_URL=postgresql://...?schema=identity
ASSET_DATABASE_URL=postgresql://...?schema=asset
COMPLIANCE_DATABASE_URL=postgresql://...?schema=compliance
SETTLEMENT_DATABASE_URL=postgresql://...?schema=settlement

# Deployed contracts (testnet)
ISSUANCE_ESCROW_APP_ID=762550539
WHITELIST_REGISTRY_APP_ID=762550520

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WC_PROJECT_ID=...
NEXT_PUBLIC_USDC_ASA_ID=10458941
```

---

## API Routes

All routes are proxied through the API gateway at `http://localhost:8080/api/v1`.

| Prefix | Service | Key endpoints |
|---|---|---|
| `/auth` | identity | register, login, verify-email |
| `/kyc` | identity | submit KYC, webhook |
| `/users` | identity | profile, role management |
| `/wallets` | identity | connect wallet, sign challenge |
| `/assets` | asset | CRUD, deploy-asa, activate, price, price-history |
| `/compliance` | compliance | whitelist, freeze, AML alerts |
| `/settlements` | settlement | trade settle, status |

---

## License

Proprietary — All rights reserved.
