<img width="1458" height="797" alt="ChainStrike" src="https://github.com/user-attachments/assets/29691772-9917-4e2b-849c-d0ea84b5521c" />

# ChainStrike

**Tokenize real-world assets. Trade them on-chain. Built on Algorand.**

ChainStrike is a full-stack platform where issuers can tokenize real-world assets — gold, real estate, bonds, private credit — and list them on a live Tinyman V2 AMM. Investors buy, sell, and provide liquidity directly from their browser using Pera or Defly wallet. No order books. No intermediaries.

**Live demo:** [chainstrike.vercel.app](https://chainstrike.vercel.app)

---

## What it does

**For issuers**
- Register, complete KYB verification
- Submit an asset with legal docs and a USDC liquidity deposit
- Admin reviews and deploys the ASA + seeds the Tinyman pool
- LP tokens are locked in a vault for 90 days, then claimable

**For investors**
- Register, complete KYC, connect your Algorand wallet
- Browse live assets on the markets page
- Swap USDC ↔ RWA tokens on-chain via Tinyman
- Add USDC liquidity to any pool and earn swap fees

---

## Tech stack

| | |
|---|---|
| Blockchain | Algorand (testnet / mainnet) |
| Smart contracts | AVM / ARC-4 |
| AMM | Tinyman V2 |
| Backend | NestJS microservices |
| Frontend | Next.js 15 (App Router) |
| Database | PostgreSQL — per-service schemas via Prisma |
| Monorepo | Turborepo + npm workspaces |
| Deployed on | Vercel (frontend) · Render (backend) |

---

## Services

| Service | What it does |
|---|---|
| `api-gateway` | Entry point — JWT auth, rate limiting, reverse proxy |
| `identity` | Registration, login, KYC/KYB, wallet management |
| `asset` | Asset lifecycle, ASA deployment, AMM, price feed |
| `compliance` | Whitelist, freeze/unfreeze, AML screening |
| `settlement` | Trade settlement |
| `notification` | Email and in-app notifications |
| `analytics` | Event aggregation |
| `web` | Next.js app — markets, trade, liquidity, issuer dashboard |

---

## Project layout

```
apps/
  api-gateway/     Entry point — JWT, rate limiting, routing
  web/             Next.js 15 — markets, trade, liquidity, issuer

services/
  identity/        Auth, KYC/KYB, wallets
  asset/           Asset CRUD, ASA deploy, AMM, price snapshots
  compliance/      Whitelist, AML, freeze
  settlement/      Atomic trade settlement
  notification/    Push and email
  analytics/       Event reporting

packages/
  algorand/        Algorand SDK wrapper
  events/          Kafka topic registry
  types/           Shared TypeScript types
  config/          Shared NestJS config
  database/        Shared Prisma helpers
  logger/          Structured logger

contracts/
  issuance-escrow/       Holds issuer USDC during verification
  token-vault/           Per-asset custody vault
  whitelist-registry/    On-chain compliance registry
  transfer-restriction/  Enforces compliance before transfers
```

---

## Running locally

**Prerequisites:** Node.js 20+, PostgreSQL, a funded Algorand testnet wallet

```bash
# 1. Clone and install
git clone https://github.com/SamyaDeb/ChainStrike
cd ChainStrike
npm install

# 2. Configure environment
cp .env.example .env
# Required: ALGORAND_ADMIN_MNEMONIC, JWT_SECRET, *_DATABASE_URL,
#           NEXT_PUBLIC_WC_PROJECT_ID

# 3. Push DB schema
npx prisma db push

# 4. Start everything
npm run dev
```

- Frontend → `http://localhost:3000`
- API gateway → `http://localhost:8080/api/v1`

---

## E2E test flow

```bash
npm run e2e              # full automated suite

# or step by step:
npm run e2e:health       # all services reachable
npm run e2e:issuer       # register issuer, submit asset
npm run e2e:admin        # admin approval + ASA deploy
npm run e2e:distribute   # distribute tokens to issuer wallet
npm run e2e:activate     # activate market, seed Tinyman pool
npm run e2e:buy          # verify pool + investor readiness
npm run e2e:settle       # price history check
npm run e2e:frontend     # verify all frontend API endpoints
```

---

## Key env variables

```bash
# Algorand
ALGORAND_NETWORK=testnet
ALGORAND_ALGOD_SERVER=https://testnet-api.algonode.cloud
ALGORAND_ADMIN_MNEMONIC="word word word ..."

# Auth
JWT_SECRET=<64-char hex>

# Database (single Postgres, per-service schemas)
IDENTITY_DATABASE_URL=postgresql://...?schema=identity
ASSET_DATABASE_URL=postgresql://...?schema=asset
COMPLIANCE_DATABASE_URL=postgresql://...?schema=compliance
SETTLEMENT_DATABASE_URL=postgresql://...?schema=settlement

# Deployed contracts (testnet)
WHITELIST_REGISTRY_APP_ID=762550520
ESCROW_CONTRACT_APP_ID=762585096

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WC_PROJECT_ID=<walletconnect id>
NEXT_PUBLIC_USDC_ASA_ID=10458941
```

Full reference in `.env.example`.

---

## API overview

All routes go through the gateway at `/api/v1`.

| Prefix | Service | Notable endpoints |
|---|---|---|
| `/auth` | identity | register, login, verify-email |
| `/kyc` | identity | submit KYC, webhook |
| `/wallets` | identity | connect wallet, sign challenge |
| `/assets` | asset | CRUD, deploy-asa, activate, price, price-history |
| `/compliance` | compliance | whitelist, freeze, AML alerts |

---

## License

Proprietary — All rights reserved.
