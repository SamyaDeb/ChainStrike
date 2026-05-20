<img width="1458" height="797" alt="ChainStrike — Institutional RWA Tokenization on Algorand" src="https://github.com/user-attachments/assets/29691772-9917-4e2b-849c-d0ea84b5521c" />

<div align="center">

# ChainStrike

### Institutional RWA Tokenization & AMM Trading on Algorand

**Tokenize real-world assets. List on AMM. Trade on-chain.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-chainstrike.vercel.app-0a0a0a?style=for-the-badge)](https://chainstrike.vercel.app)
[![Algorand](https://img.shields.io/badge/Algorand-Testnet-00D4AA?style=for-the-badge)](https://testnet.algoexplorer.io)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge)](#license)

</div>

---

Social Link : https://x.com/ChainStrikeALGO

Live Link : https://chainstrike.vercel.app

Demo Video Link : https://youtu.be/A1dudk5LXZg?si=ThZbcD6EuVBJFigV

---

## Overview

ChainStrike is a production grade platform for tokenizing real-world assets gold, real estate, corporate bonds, private credit as Algorand Standard Assets (ASAs) and listing them on Tinyman V2 AMM pools with institutional grade compliance built in.

Every asset goes through a multi-step KYB verification and admin approval workflow before an ASA is deployed on-chain. Compliance is enforced at the smart contract level via a whitelist registry not just in the application layer. Investors trade directly from their wallets with no custodian and no order book.

**Core properties:**
- Non-custodial — investors swap directly on-chain via Tinyman SDK
- Compliant by design — `defaultFrozen` ASAs enforced by on-chain whitelist registry
- Transparent — all asset custody, liquidity, and LP lockups in auditable smart contracts
- Modular — microservice architecture, each service independently deployable

---

## How It Works

### Issuers — Tokenize an Asset

```
Register & KYB → Submit Asset + USDC Deposit → Admin Review (5 stages)
→ ASA Deployed On-Chain → Tinyman Pool Seeded → Live on ChainStrike Markets
→ LP Tokens Locked in Vault (90 days) → Claimable by Issuer
```

1. Register and complete KYB verification (business entity)
2. Submit an asset application with legal documents and a USDC liquidity deposit held in escrow
3. Admin reviews the asset through 5 compliance stages and deploys the ASA
4. The Tinyman V2 AMM pool is bootstrapped at the listing price
5. LP tokens from the initial liquidity are locked in a per-asset vault for 90 days

### Investors — Trade RWA Tokens

```
Register & KYC → Connect Pera/Defly Wallet → Get Whitelisted
→ Browse Markets → Swap USDC ↔ RWA → Provide Liquidity → Earn Fees
```

1. Register, complete KYC, and connect an Algorand wallet (Pera or Defly)
2. Admin whitelists the wallet via the on chain compliance registry
3. Swap USDC ↔ RWA tokens directly on-chain, no ChainStrike servers involved in the swap
4. Add single-asset USDC liquidity, receive LP tokens, earn 0.3% on every swap

---

## Architecture

ChainStrike is a **Turborepo monorepo** with npm workspaces — a Next.js 15 frontend, six NestJS microservices, and shared packages.

```
┌─────────────────────────────────────────────────────┐
│                    Next.js Frontend                  │
│         markets · trade · liquidity · issuer         │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────┐
│                    API Gateway                       │
│          JWT auth · rate limiting · routing          │
└──┬──────────┬──────────┬──────────┬─────────────────┘
   │          │          │          │
┌──▼──┐  ┌───▼──┐  ┌────▼──┐  ┌───▼──────────┐
│ ID  │  │Asset │  │Comply │  │  Settlement  │
│ svc │  │ svc  │  │  svc  │  │     svc      │
└──┬──┘  └──┬───┘  └───┬───┘  └──────────────┘
   │         │          │
   └─────────▼──────────┘
        PostgreSQL
   (per-service schemas)
```

### Services

| Service | Port | Responsibility |
|---|---|---|
| `api-gateway` | 8080 | Entry point — JWT validation, rate limiting, reverse proxy |
| `identity` | 3001 | Auth (JWT + refresh), KYC/KYB, email verification, wallet management |
| `asset` | 3002 | Asset lifecycle, ASA deployment, AMM activation, price feed snapshots |
| `compliance` | 3004 | On-chain whitelist, freeze/unfreeze, AML screening |
| `settlement` | 3005 | Atomic trade settlement records |
| `notification` | 3006 | Email and in-app notification fan-out |
| `analytics` | 3007 | Event aggregation and reporting |

### Smart Contracts

All contracts are deployed on **Algorand testnet** and verifiable on Pera Explorer.

| Contract | App ID | Role |
|---|---|---|
| [`IssuanceLiquidityEscrow`](https://testnet.explorer.perawallet.app/application/762550539/) | `762550539` | Holds issuer USDC during verification; released atomically on asset approval |
| [`TokenVault`](https://testnet.explorer.perawallet.app/application/762585096/) | `762585096` | Per-asset custody vault — holds RWA tokens, USDC, and LP tokens with 90-day lockup |
| [`WhitelistRegistry`](https://testnet.explorer.perawallet.app/application/762550520/) | `762550520` | On-chain compliance registry — controls which wallets can hold each `defaultFrozen` ASA |
| [`TransferRestriction`](https://testnet.explorer.perawallet.app/application/762550538/) | `762550538` | Enforces compliance rules before every token transfer at the AVM level |
| Tinyman V2 Pool | per asset | Price discovery, swap execution, and liquidity provision — one pool per listed asset |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Algorand (AVM, ARC-4, ARC-3) — testnet & mainnet |
| AMM | Tinyman V2 |
| Backend | NestJS 10, TypeScript, Prisma ORM |
| Frontend | Next.js 15 (App Router), React Query, Recharts |
| Database | PostgreSQL — single instance, per-service schemas |
| Monorepo | Turborepo + npm workspaces |
| Auth | JWT (access + refresh), Argon2id password hashing |
| Wallets | Pera Wallet, Defly — WalletConnect v2 |
| Hosting | Vercel (frontend) · Render (backend + DB) |

---

## Repository Layout

```
apps/
  api-gateway/          NestJS reverse proxy — JWT, rate limiting, routing
  web/                  Next.js 15 — markets, trade, liquidity, issuer dashboard

services/
  identity/             Auth, KYC/KYB, email verification, Algorand wallet registration
  asset/                Asset CRUD, ASA deploy, Tinyman pool activation, price snapshots
  compliance/           On-chain whitelist, AML screening, freeze/unfreeze
  settlement/           Atomic trade settlement
  notification/         Email (SendGrid) and in-app notifications
  analytics/            Event aggregation and reporting

packages/
  algorand/             Algorand SDK wrapper (ASA ops, ARC-3 metadata, transactions)
  events/               Kafka topic registry — single source of truth for all event names
  types/                Shared TypeScript types across services
  config/               Shared NestJS ConfigModule helpers
  database/             Shared Prisma client utilities
  logger/               Structured logger (Pino)

contracts/
  issuance-escrow/      USDC escrow during asset verification
  token-vault/          Per-asset custody vault with LP lockup
  whitelist-registry/   On-chain compliance whitelist
  transfer-restriction/ Transfer-level compliance enforcement
  settlement-contract/  Atomic swap settlement
```

---

## Local Development

### Prerequisites

- **Node.js 20+**
- **PostgreSQL** (single instance; services use separate schemas)
- **Algorand testnet wallet** — funded with ALGO and testnet USDC (`ASA 10458941`)
  - Get ALGO: [bank.testnet.algorand.network](https://bank.testnet.algorand.network)
- **WalletConnect Project ID** — [cloud.walletconnect.com](https://cloud.walletconnect.com)

### Setup

```bash
# 1. Clone and install dependencies
git clone https://github.com/SamyaDeb/ChainStrike
cd ChainStrike
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — minimum required:
#   ALGORAND_ADMIN_MNEMONIC   funded testnet wallet (platform signing key)
#   JWT_SECRET                openssl rand -hex 32
#   INTERNAL_SECRET           openssl rand -hex 32
#   *_DATABASE_URL            PostgreSQL connection per service
#   NEXT_PUBLIC_WC_PROJECT_ID WalletConnect project ID

# 3. Push database schemas (no migration files — uses prisma db push)
npx turbo run db:generate
npx prisma db push   # run once per service schema

# 4. Start all services in parallel
npm run dev
```

| URL | Service |
|---|---|
| `http://localhost:3000` | Next.js frontend |
| `http://localhost:8080/api/v1` | API Gateway |
| `http://localhost:3001` | Identity service |
| `http://localhost:3002` | Asset service |
| `http://localhost:3004` | Compliance service |

---

## Environment Variables

Full reference is in `.env.example`. Critical variables:

```bash
# ── Algorand ───────────────────────────────────────────────────
ALGORAND_NETWORK=testnet
ALGORAND_ALGOD_SERVER=https://testnet-api.algonode.cloud
ALGORAND_ALGOD_PORT=443
ALGORAND_ADMIN_MNEMONIC="word word word ..."   # platform signing key

# ── Auth ───────────────────────────────────────────────────────
JWT_SECRET=<64-char hex>
INTERNAL_SECRET=<64-char hex>                  # service-to-service auth
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ── Database — one Postgres, per-service schemas ───────────────
IDENTITY_DATABASE_URL=postgresql://user:pass@host:5432/db?schema=identity
ASSET_DATABASE_URL=postgresql://user:pass@host:5432/db?schema=asset
COMPLIANCE_DATABASE_URL=postgresql://user:pass@host:5432/db?schema=compliance
SETTLEMENT_DATABASE_URL=postgresql://user:pass@host:5432/db?schema=settlement

# ── Deployed Contracts (Algorand testnet) ──────────────────────
WHITELIST_REGISTRY_APP_ID=762550520
ESCROW_CONTRACT_APP_ID=762585096
USDC_ASSET_ID=10458941

# ── Frontend ───────────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WC_PROJECT_ID=<walletconnect id>
NEXT_PUBLIC_ALGORAND_NETWORK=testnet
NEXT_PUBLIC_USDC_ASA_ID=10458941
```

---

## API Reference

All API routes are exposed through the gateway at `/api/v1`. The gateway validates JWT on every request and forwards to the appropriate service.

| Prefix | Service | Key Endpoints |
|---|---|---|
| `/auth` | identity | `POST /register` `POST /login` `POST /refresh` `POST /verify-email` |
| `/kyc` | identity | `POST /submit` `POST /webhook` `GET /status` |
| `/users` | identity | `GET /me` `PATCH /me` `GET /:id` |
| `/wallets` | identity | `POST /connect` `POST /sign-challenge` `POST /verify` |
| `/assets` | asset | `GET /` `POST /` `GET /:id` `PATCH /:id/activate` `GET /:id/price` `GET /:id/price-history` |
| `/compliance` | compliance | `POST /whitelist` `DELETE /whitelist/:id` `POST /freeze` `POST /unfreeze` |
| `/settlements` | settlement | `POST /` `GET /:id` |

---

## Deployment

ChainStrike is deployed on **Vercel** (frontend) and **Render** (6 backend services + PostgreSQL).

```
Frontend    → Vercel       (chainstrike.vercel.app)
Gateway     → Render       (chainstrike-gateway.onrender.com)
Services    → Render × 5   (identity, asset, compliance, settlement, notification)
Database    → Render Postgres (single instance, schema-per-service)
```

Deployment is defined in `render.yaml` (Blueprint) and triggered automatically on push to `main`. The build script (`scripts/render/build-service.sh`) handles devDependency installation and Prisma client generation before Turborepo builds each service.

---

## License

Proprietary — All rights reserved. © 2026 ChainStrike.
