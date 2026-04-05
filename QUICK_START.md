# ChainStrike - Quick Start Guide

## 🚀 Start the Application

```bash
cd frontend
pnpm dev
```

Open **http://localhost:3000**

---

## 📱 Wallet Setup (Updated - Pera Wallet Only)

The app now shows **Pera Wallet only** when you click "Connect Wallet".

### Steps:

1. **Install Pera Wallet**
   - Mobile: Download from App Store or Google Play
   - Browser: Install Pera Wallet extension

2. **Configure for TestNet**
   - Open Pera Wallet settings
   - Switch network to **TestNet**

3. **Get TestNet ALGO**
   - Visit: https://bank.testnet.algorand.network/
   - Enter your Pera Wallet address
   - Request 10 ALGO (free)

4. **Connect to ChainStrike**
   - Click "Connect Wallet" on the website
   - You'll see only Pera Wallet option
   - Click Pera Wallet
   - Approve connection in your wallet app

---

## 🧪 Testing Checklist

### 1. Landing Page (`/`)
- [x] Live ALGO price displays
- [x] Stats counter animates
- [x] "Launch App" button works

### 2. Connect Wallet
- [x] Modal shows **Pera Wallet only**
- [x] TestNet notice displayed
- [x] Link to Algorand Dispenser shown
- [x] Connection succeeds
- [x] Address shown in navbar (shortened)

### 3. Options Trading (`/trade/options`)
- [x] Live price from Binance/CoinGecko
- [x] Option chain displays
- [x] Strike prices around current price
- [x] ATM highlighted in blue
- [x] Premium calculations work
- [x] Order form functional

### 4. Perpetuals Trading (`/trade/perps`)
- [x] Funding rate with countdown
- [x] Leverage slider (1x-20x)
- [x] Liquidation price calculation
- [x] Order book visualization

### 5. Liquidity Pool (`/pool`)
- [x] TVL and APY stats
- [x] Deposit/Withdraw toggle
- [x] Pool share calculation

### 6. Portfolio (`/portfolio`)
- [x] Total value aggregation
- [x] P&L tracking
- [x] Allocation breakdown
- [x] Position cards

### 7. Staking (`/staking`)
- [x] Lock periods (30d → 4 years)
- [x] Multiplier preview (1x → 3x)
- [x] APY calculation

---

## 🎯 What You'll See

### Without Wallet Connected
- All pages load normally
- Live prices display
- Market data visible
- Forms show "Connect wallet" prompts

### With Wallet Connected (No Positions)
- "No open positions" messages
- Pool shows $0 deposited
- Staking shows 0 staked
- This is **normal** - contracts are fresh

### Expected Behavior
- **Prices auto-refresh** every 5-10 seconds
- **All data is REAL** (no mocks)
- Console may show network errors (normal for fresh accounts)

---

## 📦 Deployed Contracts (TestNet)

| Contract | App ID |
|----------|--------|
| Oracle | 758144101 |
| STRIKE Token | 758144118 |
| Staking | 758144121 |
| Options Pool | 758144124 |
| Options Market | 758144130 |
| Perps Pool | 758144152 |
| Perps Market | 758144386 |

View on Explorer: https://testnet.explorer.perawallet.app/application/758144101

---

## 🔧 Troubleshooting

### Wallet Won't Connect
- ✅ Ensure Pera is set to **TestNet** (not MainNet)
- ✅ Try refreshing the page
- ✅ Clear browser cache

### "No positions" Shows Everywhere
- ✅ This is **expected** - contracts are new
- ✅ Try depositing to pool or opening a trade

### Transactions Fail
- ✅ Need at least 0.1 ALGO for fees
- ✅ Get more from dispenser if needed

### Prices Not Loading
- ✅ Check internet connection
- ✅ APIs have rate limits (wait a moment)

---

## 🎉 What Changed

**Before:** Modal showed Pera, Defly, Exodus, Kibisis

**Now:** Modal shows **Pera Wallet only** with:
- Algorand TestNet badge
- Link to get TestNet ALGO
- Clear connection instructions

This makes it simpler and focused on Algorand's primary wallet.
