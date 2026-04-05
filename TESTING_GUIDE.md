# ChainStrike Frontend Testing Guide

## Quick Start

```bash
cd frontend
pnpm install
pnpm dev
```

Open **http://localhost:3000** in your browser.

---

## Prerequisites

1. **Pera Wallet** or **Defly Wallet** (mobile or browser extension)
2. **TestNet ALGO** - Get free TestNet ALGO from: https://bank.testnet.algorand.network/
3. Wallet configured for **Algorand TestNet**

---

## Testing Flow

### 1. Landing Page (`/`)

**What to Test:**
- [ ] Hero section loads with live ALGO price
- [ ] Animated statistics counter (TVL, Volume, etc.)
- [ ] Feature cards display correctly
- [ ] "How it Works" section with 4 steps
- [ ] Tokenomics section with distribution bar
- [ ] Footer links work
- [ ] "Launch App" and "Start Trading" buttons navigate correctly

**Expected:**
- Live price updates every 5 seconds
- Smooth animations and transitions
- Responsive layout on mobile/tablet

---

### 2. Connect Wallet

**Steps:**
1. Click "Connect Wallet" button in top-right
2. Select Pera Wallet or Defly
3. Approve connection in your wallet app
4. Verify your address appears in the navbar

**Expected:**
- Wallet modal appears with provider options
- After connecting, address shows as truncated format (e.g., `HMPG...TPM`)
- Disconnect option available

---

### 3. Options Trading (`/trade/options`)

**What to Test:**

**A. Price Display**
- [ ] Current ALGO price shows (from Binance/CoinGecko)
- [ ] 24h change percentage (green/red)
- [ ] 24h high/low prices
- [ ] Auto-refresh indicator

**B. Option Chain View**
- [ ] Click "Chain View" tab
- [ ] Strike prices listed around current price
- [ ] ATM (At-The-Money) strike highlighted in blue
- [ ] Call premiums on left, Put premiums on right
- [ ] IV (Implied Volatility) shown for each strike
- [ ] OI (Open Interest) columns show `-` when no positions exist
- [ ] Click any row to expand and see Greeks (Delta, Breakeven, Max Loss)

**C. Simple Order Form**
- [ ] Toggle between Call/Put
- [ ] Select strike price from grid
- [ ] Choose expiry date
- [ ] Enter quantity
- [ ] Premium calculates automatically
- [ ] Order summary shows breakeven and max profit/loss
- [ ] "Connect wallet" warning if not connected
- [ ] "Buy Call/Put" button enabled when form is valid

**D. Positions Panel**
- [ ] Shows "No open positions" when wallet has none
- [ ] If positions exist, shows P&L in real-time

---

### 4. Perpetuals Trading (`/trade/perps`)

**What to Test:**

**A. Price & Funding Rate**
- [ ] Live ALGO price display
- [ ] Funding rate with countdown timer
- [ ] Long vs Short open interest bar

**B. Order Book**
- [ ] Bid/Ask visualization (green bids, red asks)
- [ ] Spread shown in middle
- [ ] Depth bars on each side

**C. Perp Order Form**
- [ ] Toggle Long (green) / Short (red)
- [ ] Enter margin amount
- [ ] Adjust leverage with slider (1x-20x)
- [ ] Position size calculates automatically
- [ ] Liquidation price shows
- [ ] Estimated P&L for ±10% moves
- [ ] Risk warning appears at high leverage (>10x)

**D. Positions Panel**
- [ ] Shows open perp positions with:
  - Entry price vs Mark price
  - Leverage indicator
  - Unrealized P&L
  - Margin ratio bar (green/yellow/red)
  - Liquidation price warning if close

---

### 5. Liquidity Pool (`/pool`)

**What to Test:**

**A. Pool Stats**
- [ ] Total Value Locked displays
- [ ] APY breakdown (Options + Perps)
- [ ] Utilization rate with progress bar
- [ ] csALGO share price

**B. Deposit/Withdraw Form**
- [ ] Toggle between Deposit and Withdraw
- [ ] Enter amount with MAX button
- [ ] Preview shows shares to receive (deposit) or ALGO to receive (withdraw)
- [ ] Pool share percentage shown

**C. Your Position (when connected)**
- [ ] Shows deposited amount
- [ ] csALGO balance
- [ ] Total value and earnings

---

### 6. Portfolio Dashboard (`/portfolio`)

**What to Test:**

**A. Overview**
- [ ] Total portfolio value
- [ ] Total P&L with percentage
- [ ] Options P&L and Perps P&L breakdown

**B. Allocation Chart**
- [ ] Visual bar showing distribution:
  - Wallet balance
  - Options positions
  - Perps positions  
  - Pool deposits

**C. Position Cards**
- [ ] Option positions with strike, expiry, P&L
- [ ] Perp positions with leverage, entry, P&L
- [ ] Pool position with value, shares, earnings

**D. Quick Actions**
- [ ] Buttons to navigate to Options, Perps, Pool

---

### 7. Staking (`/staking`)

**What to Test:**

**A. Staking Stats**
- [ ] Total STRIKE staked (shows 0 if none on testnet)
- [ ] Current APY
- [ ] Your voting power
- [ ] Pending rewards

**B. Stake Form**
- [ ] Toggle Stake/Unstake
- [ ] Enter amount
- [ ] Lock period selector (No lock → 4 years)
- [ ] Shows multiplier for each period (1x → 3x)
- [ ] APY increases with longer lock
- [ ] Preview shows voting power and estimated rewards

**C. Lock Period Benefits Table**
- [ ] Comparison of all lock periods
- [ ] Multipliers and APYs displayed

---

## Expected Behaviors

### Real-Time Data
- Prices update automatically every 5-10 seconds
- No mock/fake data - all from real APIs and contracts
- Loading states shown while fetching

### Wallet Not Connected
- Warning messages appear on forms
- "Connect wallet" prompts shown
- Can still view prices and market data

### Empty States
- "No open positions" when user has none
- Pool shows $0 if no deposits
- Staking shows 0 if no stakes

### Error Handling
- Network errors show graceful fallbacks
- API failures don't crash the app
- Console may show errors for failed contract reads (expected on fresh accounts)

---

## Contract Addresses (TestNet)

| Contract | App ID |
|----------|--------|
| Oracle | 758144101 |
| STRIKE Token | 758144118 |
| Staking | 758144121 |
| Options Pool | 758144124 |
| Options Market | 758144130 |
| Perps Pool | 758144152 |
| Perps Market | 758144386 |

View on Algorand Explorer:
- https://testnet.explorer.perawallet.app/application/758144101

---

## Troubleshooting

### Wallet Won't Connect
- Ensure wallet is set to TestNet
- Try refreshing the page
- Clear browser cache

### Prices Not Loading
- Check browser console for CORS errors
- Verify internet connection
- APIs may have rate limits

### Transactions Fail
- Ensure sufficient ALGO balance (need ~0.1 ALGO for fees)
- Wallet must be opted-in to contracts (happens automatically on first interaction)

### "No positions" Always Shows
- This is expected if you haven't opened any trades
- The contracts are new with no trading activity yet

---

## Testing Checklist Summary

- [ ] Landing page fully functional
- [ ] Wallet connects successfully
- [ ] Options page shows live prices and option chain
- [ ] Perps page shows prices, funding rate, order book
- [ ] Pool page shows stats and deposit form
- [ ] Portfolio aggregates all positions
- [ ] Staking shows lock period options
- [ ] All pages responsive on mobile
- [ ] No console errors (except expected network issues)
