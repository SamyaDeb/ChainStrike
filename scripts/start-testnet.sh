#!/usr/bin/env bash
set -euo pipefail

# ChainStrike Testnet Startup Script
# Usage: ./scripts/start-testnet.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   ChainStrike — Testnet Startup${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# ─── Check .env ───────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo -e "${YELLOW}⚠  .env not found. Copying from .env.testnet…${NC}"
  cp .env.testnet .env
  echo -e "${RED}ACTION REQUIRED: Edit .env and fill in REQUIRED values:${NC}"
  echo "  - ALGORAND_ADMIN_MNEMONIC"
  echo "  - JWT_SECRET (run: openssl rand -hex 32)"
  echo "  - SUMSUB_APP_TOKEN + SUMSUB_SECRET_KEY (optional for testnet)"
  echo ""
  echo "  Fund your admin account at: https://bank.testnet.algorand.network"
  echo ""
  read -rp "Press ENTER after editing .env to continue, or Ctrl+C to abort... "
fi

# Validate critical env vars
source .env
if [[ "${ALGORAND_ADMIN_MNEMONIC:-}" == "your twenty"* ]]; then
  echo -e "${RED}ERROR: ALGORAND_ADMIN_MNEMONIC not set in .env${NC}"
  exit 1
fi
if [[ "${JWT_SECRET:-}" == "REPLACE_WITH"* ]]; then
  echo -e "${RED}ERROR: JWT_SECRET not set in .env. Run: openssl rand -hex 32${NC}"
  exit 1
fi

# ─── Step 1: Install dependencies ─────────────────────────────────────────────
echo -e "\n${BLUE}[1/5] Installing dependencies…${NC}"
npm install --workspaces --if-present 2>/dev/null || npm install
echo -e "${GREEN}  ✓ Dependencies installed${NC}"

# ─── Step 2: Run Prisma migrations ────────────────────────────────────────────
echo -e "\n${BLUE}[2/5] Running database migrations…${NC}"
for service in identity asset compliance orderbook settlement; do
  echo -n "  Migrating $service schema… "
  (cd "services/$service" && npx prisma migrate deploy --schema prisma/schema.prisma 2>/dev/null && echo -e "${GREEN}✓${NC}") || echo -e "${YELLOW}(skipped — no migrations found)${NC}"
done
echo -e "${GREEN}  ✓ Migrations done${NC}"

# ─── Step 3: Deploy contracts (optional) ──────────────────────────────────────
echo -e "\n${BLUE}[3/5] Deploying smart contracts to Algorand testnet…${NC}"
npx ts-node --esm scripts/deploy-contracts.ts || echo -e "${YELLOW}  (contract deployment skipped — will use off-chain mode)${NC}"

# ─── Step 4: Seed test data ───────────────────────────────────────────────────
echo -e "\n${BLUE}[4/5] Seeding test data…${NC}"
npx ts-node --esm scripts/seed-testnet.ts || echo -e "${YELLOW}  (seed skipped)${NC}"

# ─── Step 5: Start services ───────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}   ✅  Infrastructure ready! Starting services…${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "   Investor Platform:   http://localhost:3000"
echo "   Issuer Dashboard:    http://localhost:3101"
echo "   Admin Panel:         http://localhost:3100"
echo "   API Gateway Docs:    http://localhost:8080/docs"
echo ""
echo -e "${BLUE}Starting all services with Turborepo (Ctrl+C to stop all)…${NC}"
echo ""

npm run dev
