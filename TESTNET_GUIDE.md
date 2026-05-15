# ChainStrike Testnet Testing Guide

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| Docker Desktop | latest | [docker.com](https://docker.com) |
| Pera Wallet | latest | App Store / Google Play |

---

## Setup (One Time)

### 1. Configure Environment

```bash
cp .env.testnet .env
```

Edit `.env` and fill in the required values:

| Variable | How to get it |
|----------|--------------|
| `ALGORAND_ADMIN_MNEMONIC` | Generate in Pera Wallet → Settings → Show Passphrase. Use a **testnet account** |
| `JWT_SECRET` | Run `openssl rand -hex 32` |
| `SUMSUB_APP_TOKEN` | Sign up at [app.sumsub.com](https://app.sumsub.com) → Use **sandbox** credentials |
| `SUMSUB_SECRET_KEY` | Same Sumsub dashboard |
| `NEXT_PUBLIC_WC_PROJECT_ID` | Free at [cloud.walletconnect.com](https://cloud.walletconnect.com) |

### 2. Fund Admin Account

Get testnet ALGO: **https://bank.testnet.algorand.network**

Paste your admin address and request 10 ALGO.

### 3. Start Everything

```bash
./scripts/start-testnet.sh
```

This will:
- Start Postgres, Redis, Kafka in Docker
- Run database migrations
- Deploy smart contracts to Algorand testnet
- Seed test users
- Start all 6 services + 3 Next.js apps

---

## Service URLs

| Service | URL |
|---------|-----|
| **Investor Platform** | http://localhost:3000 |
| **Issuer Dashboard** | http://localhost:3001 |
| **Admin Panel** | http://localhost:3100 |
| **API Gateway (Swagger)** | http://localhost:8080/docs |
| **Kafka UI** | http://localhost:8081 |
| **pgAdmin** | http://localhost:5050 |

---

## Test Scenarios

### Scenario 1: Full Asset Tokenization Flow

**Step 1 — Issuer creates asset application**
1. Open http://localhost:3001
2. Login: `issuer@testnet.io / Issuer@Test2024!`
3. Click **Tokenize Asset**
4. Fill in: Name=`Gold Bullion Fund`, Ticker=`GLDX`, Category=`Precious Metals`
5. Set supply=`1000000`, price=`10.00` USDC, Min KYC Tier=`1`
6. Submit

**Step 2 — Admin approves and deploys ASA**
1. Open http://localhost:3100
2. Find `GLDX` in Asset Pipeline → click **Approve**
3. After approval, click **Deploy ASA** → this creates the ASA on Algorand testnet
4. Check the returned ASA ID
5. Click **Activate** once ready for trading

**Step 3 — Verify on Algorand testnet**
- Check: https://testnet.algoexplorer.io/asset/{ASA_ID}
- Confirm: `default-frozen: true`, correct supply and decimals

---

### Scenario 2: Investor KYC + Trading Flow

**Step 1 — Investor registration and KYC**
1. Open http://localhost:3000
2. Click **KYC** in nav
3. Login as `investor@testnet.io / Investor@Test2024!`
4. Click **Start Verification** → completes via Sumsub sandbox
5. In Sumsub sandbox: use test documents (driver's license type, any test data)
6. Wait for webhook → KYC status updates to Tier 1

**Step 2 — Connect Pera Wallet**
1. Open Pera Wallet → switch to **Testnet** mode (Settings → Developer → Connect to Testnet)
2. Get testnet USDC: Use testnet USDC ASA ID `10458941`
3. On KYC page → click **Verify Ownership** → sign challenge in Pera

**Step 3 — Place a trade**
1. Click **Markets** → select `GLDX`
2. Order form: BUY, LIMIT, price=`9.90`, qty=`100`, GTC
3. Click **BUY GLDX**
4. To create a match: add a SELL order at same or lower price from another account

**Step 4 — Verify settlement on-chain**
After an order match:
- Check Algorand testnet explorer for the 4-transaction atomic group
- Verify: ASA transfer + USDC transfer + fee + app call all in one group

---

### Scenario 3: AML Alert Flow

1. In Admin Panel → AML Alerts tab
2. Use Chainalysis test wallet `KNOWN_BAD_WALLET` (see their sandbox docs)
3. Connect that wallet → should trigger SEVERE risk → auto-frozen + alert

---

### Scenario 4: Circuit Breaker

1. Place rapid trades that move price >10% in 5 minutes
2. Orderbook service should trigger circuit breaker
3. New orders return 400: "Circuit breaker active"
4. Auto-clears after 15 minutes

---

## Testnet USDC

Official testnet USDC on Algorand: **Asset ID 10458941**

To get testnet USDC:
- Opt in to asset 10458941 in Pera Wallet
- Use the Algorand foundation test dispenser or deploy a mock USDC minter

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `kafka: leader not available` | Wait 30s for Kafka to fully start, retry |
| `prisma: schema not found` | Run `npm run db:generate` in the service directory |
| `algod: connection refused` | Check `ALGORAND_ALGOD_SERVER` in .env — should be `https://testnet-api.algonode.cloud` |
| KYC webhook not received | Use ngrok to expose localhost: `ngrok http 3001`, set webhook URL in Sumsub dashboard |
| Pera wallet sign fails | Make sure Pera is in **Testnet** mode |
| `insufficient funds` | Fund admin account at https://bank.testnet.algorand.network |

---

## Stopping / Resetting

```bash
# Stop all services
Ctrl+C

# Stop infrastructure containers
docker compose -f docker-compose.testnet.yml down

# Full reset (wipes database!)
docker compose -f docker-compose.testnet.yml down -v
```

---

## Architecture Diagram (Testnet)

```
Browser (localhost:3000/3001/3100)
         │
    [API Gateway :8080]  ─── JWT validation, rate limiting
         │
    ┌────┴─────────────────────────────────────────┐
    │    │              │           │              │
[Identity] [Asset :3002] [Orderbook :3003] [Compliance :3004]
 :3001                        │                │
    │                   [Matching Engine]     │
    │                   (Kafka consumer)      │
    └──────────────────────────────────┐     │
                                 [Settlement :3005]
                                       │
                              Algorand Testnet
                          (AlgoNode public API)
                    - 4-txn atomic settlement group
                    - WhitelistRegistry contract
                    - ASA with default-frozen=true
```

## Ready for Production?

After all testnet scenarios pass → proceed to **Phase 14** (Production):
- Multi-sig admin/compliance wallets (3-of-5 and 2-of-3)
- Production Sumsub + Chainalysis credentials  
- Real USDC ASA ID: `31566704` (Algorand mainnet)
- DNS + TLS configuration
- Kubernetes deployment or managed cloud
