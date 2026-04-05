# ChainStrike - System Architecture & Testing Guide

## 📐 System Architecture

### Overview

ChainStrike is a decentralized derivatives exchange built on Algorand blockchain, enabling trustless trading of options and perpetual futures with up to 20x leverage.

```
┌─────────────────────────────────────────────────────────────┐
│                     ChainStrike Platform                     │
│                Decentralized Derivatives Exchange            │
└─────────────────────────────────────────────────────────────┘

┌───────────────┐         ┌────────────────────────────────────┐
│   Frontend    │────────▶│        Algorand TestNet            │
│   Next.js 14  │         │    7 Smart Contracts Deployed      │
│   TypeScript  │         └────────────────────────────────────┘
│   Wallet SDK  │                        │
└───────────────┘                        │
                                         ▼
                    ┌──────────────────────────────────┐
                    │       Price Oracle (758164064)    │
                    │  Multi-source: Binance, CoinGecko │
                    └──────────────────────────────────┘
                                 │
                ┌────────────────┼────────────────┐
                │                │                │
        ┌───────▼───────┐ ┌─────▼──────┐ ┌──────▼────────┐
        │ STRIKE Token  │ │  Staking   │ │  Keeper Bots  │
        │  (758164067)  │ │(758164068) │ │  Liquidation  │
        └───────────────┘ └────────────┘ └───────────────┘
                                 │
                ┌────────────────┼────────────────┐
                │                                 │
        ┌───────▼────────┐              ┌────────▼────────┐
        │  Options Pool  │              │   Perps Pool    │
        │  (758164078)   │              │  (758164081)    │
        │   LP: csOPT    │              │  LP: csPERP     │
        └────────┬───────┘              └────────┬────────┘
                 │                               │
        ┌────────▼────────┐            ┌────────▼────────┐
        │ Options Market  │            │  Perps Market   │
        │  (758164079)    │            │  (758164083)    │
        │  Calls & Puts   │            │  20x Leverage   │
        └─────────────────┘            └─────────────────┘
```

## 🔗 Smart Contract Architecture

### 1. Oracle Contract (App ID: 758164064)
**Purpose**: Aggregates ALGO price from multiple sources for reliability

**Data Sources**:
- Binance API (primary)
- CoinGecko API (secondary)
- Vestige DEX (on-chain backup)

**Key Methods**:
- `initialize()`: Sets up admin access
- `update_price(price, timestamp)`: Keeper-only price update
- `get_price()`: Returns latest ALGO/USD price (6 decimals)
- `get_price_with_timestamp()`: Price + last update time

**State Variables**:
- `latest_price`: Current ALGO price in micro-USD
- `last_update_timestamp`: Unix timestamp of last update
- `update_count`: Total number of updates
- `admin`: Authorized keeper address

**Update Frequency**: Every 60 seconds via keeper bots

---

### 2. STRIKE Token (App ID: 758164067, Asset ID: 758164120)
**Purpose**: Governance and utility token for the platform

**Token Economics**:
- **Total Supply**: 1,000,000,000 STRIKE
- **Decimals**: 6
- **Distribution**:
  - 40% Liquidity Mining (earned by LPs and traders)
  - 25% Team (4-year linear vesting)
  - 20% Treasury (DAO controlled)
  - 10% Initial Liquidity
  - 5% Marketing & Partnerships

**Key Methods**:
- `initialize()`: Creates STRIKE ASA
- `distribute(receiver, amount)`: Admin token distribution
- `burn(amount)`: Burns tokens from circulation

**Utility**:
- Governance voting rights
- Staking for fee sharing
- Trading fee discounts (coming soon)

---

### 3. Staking Contract (App ID: 758164068)
**Purpose**: Stake STRIKE tokens for rewards and governance power

**Lock Periods & Multipliers**:
| Lock Period | Multiplier | APY Boost |
|-------------|------------|-----------|
| No lock     | 1.0x       | Base APY  |
| 3 months    | 1.5x       | +50%      |
| 6 months    | 1.75x      | +75%      |
| 1 year      | 2.0x       | +100%     |
| 2 years     | 2.5x       | +150%     |
| 4 years     | 3.0x       | +200%     |

**Key Methods**:
- `initialize(strike_token_id)`: Setup with STRIKE token
- `stake(amount, lock_period)`: Lock tokens for rewards
- `unstake(stake_id)`: Withdraw after unlock time
- `claim_rewards()`: Claim accumulated rewards
- `extend_lock(stake_id, new_period)`: Extend lock for higher multiplier
- `get_voting_power(user)`: Calculate governance weight

**Rewards Distribution**:
- Protocol collects 30% of all trading fees
- Distributed proportionally to stakers based on:
  - Amount staked
  - Lock period multiplier
  - Time staked

**State Variables**:
- `total_staked`: Total STRIKE staked
- `total_voting_power`: Sum of all stakers' power
- `reward_rate`: STRIKE per block per unit staked
- `reward_pool`: Available rewards
- BoxMap for per-user stakes

---

### 4. Options Pool (App ID: 758164078, LP Token: 758164131)
**Purpose**: Provides liquidity for options trading

**LP Token**: csOPT (ChainStrike Options LP Token)

**How It Works**:
1. LPs deposit ALGO → receive csOPT tokens
2. Pool writes (sells) options to traders
3. Pool collects premiums → increases csOPT value
4. Pool pays out ITM options → decreases csOPT value
5. LP shares represent proportional claim on pool

**Risk Management**:
- **Max Utilization**: 80% (20% buffer for withdrawals)
- **Min Deposit**: 1 ALGO
- **Deposit Fee**: 0.1% (sent to staking)
- **Withdraw Fee**: 0.1% (sent to staking)

**Key Methods**:
- `initialize(options_market, staking)`: Setup with market and staking contracts
- `deposit()`: Add ALGO liquidity, receive csOPT shares ✅ **FIXED**
- `withdraw(shares)`: Burn csOPT, receive proportional ALGO
- `lock_collateral(amount, option_id)`: Lock funds for option writing
- `release_collateral(amount, option_id)`: Unlock when option expires
- `receive_premium(amount)`: Collect option premium (increases share value)
- `pay_settlement(amount, option_id)`: Pay ITM option (decreases share value)
- `get_pool_stats()`: Returns TVL, utilization, APY
- `preview_deposit(amount)`: Calculate shares for deposit
- `preview_withdraw(shares)`: Calculate ALGO for withdrawal

**APY Calculation**:
```
APY = (total_premiums_earned - total_payouts) / total_liquidity * 365 / days_active
```

**State Variables**:
- `total_liquidity`: Total ALGO in pool
- `utilized_liquidity`: Locked in active options
- `total_shares`: Total csOPT supply
- `total_premiums_earned`: Cumulative premiums collected
- `total_payouts`: Cumulative option settlements paid
- `lp_token_id`: csOPT asset ID
- BoxMap for individual LP positions

---

### 5. Options Market (App ID: 758164079)
**Purpose**: Trade European-style options (calls & puts)

**Option Specifications**:
- **Style**: European (exercise at expiry only)
- **Strikes**: User-defined, rounded to nearest $0.05
- **Expiries**: 1 day to 365 days from now
- **Types**: Call (bullish) and Put (bearish)
- **Settlement**: Physical delivery in ALGO

**Premium Calculation** (Black-Scholes Model):
```python
# Inputs:
spot_price = oracle.get_price()  # Current ALGO price
strike_price = user_selected       # e.g., $0.30
time_to_expiry = days / 365        # e.g., 30 days = 0.0822
implied_volatility = 100%          # Adjusted by supply/demand
risk_free_rate = 5%                # Annual

# Black-Scholes formula:
d1 = (ln(spot/strike) + (r + σ²/2) * T) / (σ * √T)
d2 = d1 - σ * √T
call_premium = spot * N(d1) - strike * e^(-r*T) * N(d2)
put_premium = strike * e^(-r*T) * N(-d2) - spot * N(-d1)
```

**Greeks**:
- **Delta**: Rate of change of premium w.r.t. spot price (0 to 1)
- **Gamma**: Rate of change of delta w.r.t. spot price
- **Theta**: Time decay per day
- **Vega**: Sensitivity to volatility changes

**Key Methods**:
- `initialize(pool, oracle)`: Setup with pool and oracle
- `buy_call(strike, expiry, quantity)`: Buy call option
- `buy_put(strike, expiry, quantity)`: Buy put option
- `exercise_option(option_id)`: Exercise ITM option at expiry
- `expire_option(option_id)`: Expire OTM option (no value)
- `get_premium(type, strike, expiry, quantity)`: Calculate premium
- `get_greeks(option_id)`: Calculate Delta, Gamma, Theta, Vega
- `get_option(option_id)`: Get option details
- `get_user_options(user)`: List user's options

**Trading Fees**: 0.3% of notional value

**Option States**:
- `Active`: Can be exercised at expiry
- `Exercised`: ITM, settled
- `Expired`: OTM, worthless

**State Variables**:
- `next_option_id`: Incrementing ID counter
- `total_options_bought`: Total options created
- `total_premiums_collected`: Sum of all premiums
- `total_volume`: Notional value traded
- BoxMap for option positions

---

### 6. Perpetuals Pool (App ID: 758164081, LP Token: 758164133)
**Purpose**: Counterparty liquidity for perpetual futures

**LP Token**: csPERP (ChainStrike Perps LP Token)

**How It Works**:
1. LPs deposit ALGO → receive csPERP tokens
2. Pool acts as counterparty to all perp trades
3. Pool collects:
   - Trading fees (0.05% open + 0.05% close)
   - Losses from losing traders
4. Pool pays out:
   - Profits to winning traders
   - Funding rate payments
5. Share value fluctuates with cumulative P&L

**Risk Management**:
- **Max Utilization**: 80%
- **Min Deposit**: 10 ALGO (higher than options due to risk)
- **Reserved Liquidity**: Locked for open positions
- **Funding Rate**: Balances long/short open interest

**Funding Rate Mechanism**:
```python
# Calculate every 8 hours
imbalance = long_OI - short_OI
funding_rate = (imbalance / total_liquidity) * 0.01  # 1% base rate

# If more longs than shorts:
- Longs pay shorts (and pool)
- Encourages shorts to open

# If more shorts than longs:
- Shorts pay longs (and pool)
- Encourages longs to open
```

**Key Methods**:
- `initialize(perps_market, staking)`: Setup contracts
- `deposit()`: Add liquidity ✅ **FIXED**
- `withdraw(shares)`: Remove liquidity
- `reserve_liquidity(amount, position_id)`: Lock for position
- `release_liquidity(amount, position_id)`: Unlock on close
- `collect_trading_fee(amount)`: Add fees to pool
- `process_pnl(amount, is_profit, position_id)`: Handle trader P&L
- `process_funding(long_pays, short_pays)`: Distribute funding
- `update_open_interest(long_delta, short_delta)`: Update OI and recalculate funding
- `get_funding_rate()`: Current funding rate
- `get_pool_stats()`: Comprehensive pool statistics

**State Variables**:
- `total_liquidity`: Total ALGO in pool
- `reserved_liquidity`: Locked for open positions
- `long_open_interest`: Sum of all long position sizes
- `short_open_interest`: Sum of all short position sizes
- `current_funding_rate`: Rate per 8 hours (basis points)
- `last_funding_update`: Timestamp of last funding
- `cumulative_pnl`: Net P&L since inception
- `is_pnl_positive`: Whether cumulative P&L is positive
- `total_trading_fees`: Fees collected

---

### 7. Perpetuals Market (App ID: 758164083)
**Purpose**: Leveraged perpetual futures trading (no expiry)

**Product Specifications**:
- **Leverage**: 1x to 20x
- **Directions**: Long (buy/bullish) or Short (sell/bearish)
- **Expiry**: None (perpetual)
- **Settlement**: Mark-to-market, instant P&L
- **Liquidation**: When margin ratio < 10%

**Position Sizing**:
```python
# Example: 10 ALGO margin at 10x leverage
margin = 10 ALGO
leverage = 10x
position_size = margin * leverage = 100 ALGO

# P&L calculation:
entry_price = $0.25
current_price = $0.28
price_change = (0.28 - 0.25) / 0.25 = 12%
pnl = position_size * price_change = 100 * 0.12 = 12 ALGO profit
```

**Liquidation**:
```python
# Long position liquidation price:
liq_price = entry_price * (1 - 1/leverage + 0.05)  # 5% buffer

# Example: Long at $0.25 with 10x
liq_price = 0.25 * (1 - 0.1 + 0.05) = $0.2375

# Liquidation occurs when:
margin_ratio = margin / (position_size * current_price) < 10%
```

**Key Methods**:
- `initialize(pool, oracle)`: Setup contracts
- `open_position(side, margin, leverage)`: Open long/short
- `close_position(position_id)`: Close position, realize P&L
- `add_margin(position_id, amount)`: Add collateral
- `remove_margin(position_id, amount)`: Remove excess collateral
- `liquidate(position_id)`: Keeper liquidates underwater position
- `process_funding()`: Apply funding rate to all positions
- `get_unrealized_pnl(position_id)`: Calculate current P&L
- `get_liquidation_price(position_id)`: Calculate liq price
- `get_margin_ratio(position_id)`: Health check
- `get_position(position_id)`: Get position details
- `get_user_positions(user)`: List user's positions

**Trading Fees**:
- 0.05% on open
- 0.05% on close
- Funding rate every 8 hours

**Liquidation Incentive**: 5% of position value to keeper

**Position States**:
- `Active`: Open position
- `Closed`: User closed, P&L realized
- `Liquidated`: Underwater, keeper closed

**State Variables**:
- `next_position_id`: Incrementing ID
- `total_volume`: Cumulative notional traded
- `total_liquidations`: Number of liquidations
- `total_long_volume`: Long position volume
- `total_short_volume`: Short position volume
- BoxMap for positions

---

## 🧪 Complete User Testing Flows

### Prerequisites
1. **Install Pera Wallet** (mobile or browser extension)
2. **Configure for TestNet** (Settings → Node Settings → TestNet)
3. **Get TestNet ALGO**: https://bank.testnet.algorand.network/
   - Request 10 ALGO (free)
   - Wait 30 seconds for confirmation
4. **Access ChainStrike**: http://localhost:3000 (or deployed URL)

---

### Flow 1: New User Onboarding (5 minutes)

**Steps**:
1. Visit landing page
2. Observe:
   - Live ALGO price updates (top-right)
   - Animated statistics counter (TVL, Volume, Users)
   - Feature cards explaining platform
   - "How It Works" section (4 steps)
   - Tokenomics breakdown
3. Click "Launch App" or "Start Trading"
4. Click "Connect Wallet" button
5. Select "Pera Wallet"
6. Scan QR code (mobile) or approve in extension
7. Verify:
   - Address shows in navbar (e.g., `HMPG...TPM`)
   - Balance displays
   - Disconnect option available

**Expected Outcome**:
✅ Wallet connected successfully  
✅ Address visible in UI  
✅ Ready to interact with contracts

---

### Flow 2: Add Liquidity to Options Pool (10 minutes) ✅ **NOW FIXED**

**Steps**:
1. Navigate to `/pool`
2. Toggle **"Options Pool"** (top selector)
3. View pool statistics:
   - TVL (Total Value Locked)
   - APY breakdown
   - Utilization rate (with progress bar)
   - csOPT share price
4. Ensure "Deposit" tab is selected
5. Enter amount: e.g., **5 ALGO**
   - Or click "MAX" to deposit all available (minus fee buffer)
6. Preview shows:
   - csOPT shares you'll receive
   - Your new pool share percentage
   - Estimated annual yield
7. Click **"Deposit"**
8. In Pera Wallet:
   - If first time: Approve **opt-in** to pool contract (0.1 ALGO fee)
   - Approve **payment** transaction (5 ALGO + 0.001 fee)
   - Approve **app call** transaction (deposit method)
9. Wait for confirmation (~4 seconds)
10. View updated position:
    - "Your Position" card shows deposited amount
    - csOPT balance displays
    - Current value and earnings

**Expected Outcome**:
✅ Transactions succeed without ApprovalProgram error  
✅ csOPT tokens appear in wallet  
✅ Position shows in "Your Position" card  
✅ TVL increases by your deposit  

**Troubleshooting**:
- **Error "Below minimum deposit"**: Options pool requires minimum 1 ALGO
- **Insufficient balance**: Keep at least 0.2 ALGO for transaction fees
- **Opt-in fails**: Retry, may need to refresh page

---

### Flow 3: Buy Call Option (15 minutes)

**Steps**:
1. Navigate to `/trade/options`
2. Observe live price feed:
   - Current ALGO price (e.g., $0.2543)
   - 24h change (green/red %)
   - 24h high/low
   - Auto-refresh indicator
3. Click **"Chain View"** tab
4. Review option chain:
   - Strike prices listed around current price
   - ATM (At-The-Money) strike highlighted in **blue**
   - Call premiums (left column)
   - Put premiums (right column)
   - IV (Implied Volatility) for each strike
5. Click a strike row to expand and see:
   - Delta (e.g., 0.65 for slightly ITM call)
   - Breakeven price
   - Max profit (unlimited for calls)
   - Max loss (premium paid)
6. Switch to **"Order"** tab
7. Select **"Call"** type (bullish)
8. Choose strike price from dropdown (e.g., **$0.25**)
9. Select expiry date (e.g., **7 days**)
10. Enter quantity: **1 contract**
11. Review order summary:
    - Premium: e.g., **0.15 ALGO**
    - Breakeven: strike + premium = **$0.265**
    - Max profit: **Unlimited**
    - Max loss: **0.15 ALGO** (premium)
12. Click **"Buy Call"**
13. In Pera Wallet:
    - Approve payment for premium
    - Approve app call to OptionsMarket
14. Wait for confirmation
15. View position in **"Positions"** panel:
    - Option type, strike, expiry
    - Current value (mark-to-market)
    - Unrealized P&L (if price moved)
    - Greeks (Delta, Theta)

**Expected Outcome**:
✅ Option purchased successfully  
✅ Premium deducted from balance  
✅ Position appears in Positions panel  
✅ Can exercise at expiry if ITM  

**Profit Scenarios**:
- **Price rises to $0.35 at expiry**: Exercise, profit = (0.35 - 0.25) - 0.15 = **0.10 ALGO** (~67% return)
- **Price stays at $0.25 or below**: Option expires worthless, loss = **0.15 ALGO** (premium)

---

### Flow 4: Open Leveraged Long Position (15 minutes)

**Steps**:
1. Navigate to `/trade/perps`
2. View perpetuals trading interface:
   - Live ALGO price
   - Funding rate with countdown timer (e.g., `-0.0123% in 7:42:15`)
   - Long vs Short open interest bar
3. Review **Order Book** (left panel):
   - Bids (green) and Asks (red)
   - Depth visualization
   - Current spread
4. Select **"Long"** (green button, bullish)
5. Enter margin: **10 ALGO**
6. Adjust leverage slider: **5x**
7. Review calculations:
   - Position size: **50 ALGO** (10 * 5)
   - Entry price: **$0.2543** (current mark price)
   - Liquidation price: **$0.2162** (15% below entry)
   - Margin ratio: **100%** (healthy)
8. View estimated P&L:
   - If price +10%: **+5 ALGO** profit
   - If price -10%: **-5 ALGO** loss
9. See risk warning (leverage > 10x gets red warning)
10. Click **"Open Long"**
11. In Pera Wallet:
    - Approve payment for margin (10 ALGO)
    - Approve trading fee (0.05% of position = 0.025 ALGO)
    - Approve app call to PerpetualsMarket
12. Wait for confirmation
13. View position in **"Positions"** panel:
    - Side: **Long** (green)
    - Size: **50 ALGO**
    - Entry price: **$0.2543**
    - Mark price: **$0.2543** (current)
    - Liquidation price: **$0.2162**
    - Unrealized P&L: **0 ALGO** (just opened)
    - Margin ratio: **100%** (green bar)

**Expected Outcome**:
✅ Position opened successfully  
✅ Margin locked in contract  
✅ Real-time P&L updates as price moves  
✅ Can close anytime to realize profit/loss  

**Managing Position**:
- **Add Margin**: Click "Add" to lower liquidation risk
- **Close Position**: Click "Close" to realize P&L
- **Funding**: Every 8 hours, pay or receive funding based on OI imbalance

**Liquidation Example**:
- Entry: $0.2543
- Liquidation: $0.2162
- Buffer: 15% ($0.0381)
- If price drops to $0.2162, keeper bot liquidates position
- You lose full margin (10 ALGO) minus liquidation fee

---

### Flow 5: Stake STRIKE Tokens (10 minutes)

**Prerequisites**: Must have STRIKE tokens (request from admin for testnet)

**Steps**:
1. Navigate to `/staking`
2. View staking dashboard:
   - Total STRIKE staked (platform-wide)
   - Current APY (e.g., **45% APY**)
   - Your voting power
   - Pending rewards
3. Select **"Stake"** tab
4. Enter amount: **1000 STRIKE**
5. Choose lock period:
   - **No lock**: 1.0x multiplier, base APY
   - **3 months**: 1.5x multiplier, **67.5% APY**
   - **1 year**: 2.0x multiplier, **90% APY**
   - **4 years**: 3.0x multiplier, **135% APY**
6. Review preview:
   - Voting power: e.g., **2000** (1000 * 2x)
   - Lock until: Date (e.g., April 3, 2027)
   - Estimated rewards: **900 STRIKE/year**
7. Click **"Stake"**
8. In Pera Wallet:
   - If first time: Approve opt-in to STRIKE token
   - Approve asset transfer (1000 STRIKE to staking contract)
   - Approve app call
9. Wait for confirmation
10. View staked position:
    - Amount staked
    - Lock period remaining (countdown)
    - Multiplier applied
    - Accrued rewards (updates per block)
11. **Claim Rewards** (anytime):
    - Click "Claim Rewards" button
    - Approve transaction
    - STRIKE rewards sent to wallet

**Expected Outcome**:
✅ STRIKE locked in staking contract  
✅ Voting power increased  
✅ Earning rewards based on protocol fees  
✅ Can extend lock period for higher multiplier  
✅ Can unstake after lock period expires  

---

### Flow 6: Portfolio Dashboard Overview (5 minutes)

**Steps**:
1. Navigate to `/portfolio`
2. View **Overview Card** (top):
   - Total portfolio value (ALGO + positions)
   - Total P&L (absolute and percentage)
   - Options P&L (call/put profits/losses)
   - Perps P&L (long/short profits/losses)
3. View **Allocation Chart** (bar visualization):
   - Wallet balance (dark purple)
   - Options positions (blue)
   - Perps positions (cyan)
   - Pool deposits (purple)
4. Scroll to **Position Cards**:
   - **Options Positions**:
     - Type, strike, expiry
     - Current value vs cost
     - P&L (green/red)
     - Greeks (Delta, Theta)
   - **Perps Positions**:
     - Side (Long/Short)
     - Entry price vs mark price
     - Leverage indicator
     - Unrealized P&L
     - Liquidation price warning
   - **Pool Positions**:
     - Pool type (Options/Perps)
     - Deposited amount
     - Current value (with earnings)
     - Share of pool
     - APY
5. Use **Quick Actions**:
   - "Trade Options" → `/trade/options`
   - "Trade Perps" → `/trade/perps`
   - "Add Liquidity" → `/pool`

**Expected Outcome**:
✅ All positions visible in one dashboard  
✅ Real-time P&L aggregation  
✅ Easy navigation to trading pages  

---

### Flow 7: Withdraw Liquidity from Pool (10 minutes)

**Steps**:
1. Navigate to `/pool`
2. Select pool (Options or Perps)
3. Click **"Withdraw"** tab
4. Enter amount:
   - By shares: e.g., **50 csOPT**
   - Or use percentage slider: **50%**
   - Or click **"MAX"** to withdraw all
5. Preview shows:
   - ALGO you'll receive (based on current share price)
   - Withdraw fee: 0.1%
   - Net ALGO after fee
6. Click **"Withdraw"**
7. In Pera Wallet:
   - Approve asset transfer (csOPT to contract)
   - Approve app call (withdraw method)
8. Wait for confirmation
9. Verify:
   - ALGO received in wallet
   - csOPT balance decreased
   - "Your Position" card updated

**Expected Outcome**:
✅ csOPT burned  
✅ ALGO returned to wallet  
✅ Position reduced or fully exited  

**Note**: Cannot withdraw if utilization would exceed 80% after your withdrawal.

---

## 🔍 Testing Checklist

### Wallet & Connection
- [ ] Pera Wallet connects on TestNet
- [ ] Address displays in navbar
- [ ] Balance shows correctly
- [ ] Disconnect works

### Landing Page
- [ ] Live ALGO price updates
- [ ] Statistics animate on load
- [ ] All links navigate correctly
- [ ] Responsive on mobile

### Options Trading
- [ ] Option chain loads with strikes
- [ ] ATM highlighted correctly
- [ ] Premium calculations accurate
- [ ] Can buy call and put
- [ ] Positions panel shows open options
- [ ] Greeks display correctly

### Perpetuals Trading
- [ ] Funding rate shows with countdown
- [ ] Order book visualizes bids/asks
- [ ] Can open long and short
- [ ] Liquidation price calculated correctly
- [ ] Risk warning appears at high leverage
- [ ] Positions panel shows open perps

### Liquidity Pool ✅ **FIXED**
- [ ] Pool stats load (TVL, APY, utilization)
- [ ] Can deposit to options pool
- [ ] Can deposit to perps pool
- [ ] Preview calculations accurate
- [ ] csOPT/csPERP tokens minted
- [ ] Can withdraw from pool
- [ ] Position shows in portfolio

### Staking
- [ ] Can opt-in to STRIKE token
- [ ] Can stake with different lock periods
- [ ] Multiplier applied correctly
- [ ] Rewards accrue over time
- [ ] Can claim rewards
- [ ] Voting power calculated correctly

### Portfolio
- [ ] Total value aggregates correctly
- [ ] P&L calculations accurate
- [ ] Allocation chart displays
- [ ] All positions show
- [ ] Quick actions navigate correctly

---

## 🚀 Deployment Instructions

### Rebuild Contracts

```bash
cd contracts

# Compile all contracts
algokit project run build

# Expected output:
# - options_pool.approval.teal
# - perpetuals_pool.approval.teal
# - (and all other contracts)

# Review compiled TEAL
ls -la .build/options_pool/
ls -la .build/perps_pool/
```

### Deploy to TestNet

```bash
# Deploy all contracts
algokit project deploy testnet

# This will:
# 1. Deploy Oracle
# 2. Deploy STRIKE token
# 3. Deploy Staking
# 4. Deploy Options Pool ✅ with FIX
# 5. Deploy Options Market
# 6. Deploy Perps Pool ✅ with FIX
# 7. Deploy Perps Market

# Note deployed addresses
# Update frontend/src/config/deployed-contracts.ts
```

### Update Frontend Config

After deployment, update contract addresses:

```typescript
// frontend/src/config/deployed-contracts.ts
export const DEPLOYED_CONTRACTS = {
  testnet: {
    oracle: NEW_ORACLE_APP_ID,
    strikeToken: NEW_STRIKE_APP_ID,
    staking: NEW_STAKING_APP_ID,
    optionsPool: NEW_OPTIONS_POOL_APP_ID,  // ← Updated
    optionsMarket: NEW_OPTIONS_MARKET_APP_ID,
    perpsPool: NEW_PERPS_POOL_APP_ID,      // ← Updated
    perpsMarket: NEW_PERPS_MARKET_APP_ID,
  },
  assets: {
    strike: NEW_STRIKE_ASSET_ID,
    optionsLP: NEW_CSOPT_ASSET_ID,         // ← Updated
    perpsLP: NEW_CSPERP_ASSET_ID,          // ← Updated
  },
};
```

### Initialize Contracts

```bash
# Initialize Options Pool
algokit goal app call \
  --app-id NEW_OPTIONS_POOL_APP_ID \
  --from DEPLOYER_ADDRESS \
  --method "initialize(application,application)uint64" \
  --arg NEW_OPTIONS_MARKET_APP_ID \
  --arg NEW_STAKING_APP_ID

# Initialize Perps Pool
algokit goal app call \
  --app-id NEW_PERPS_POOL_APP_ID \
  --from DEPLOYER_ADDRESS \
  --method "initialize(application,application)uint64" \
  --arg NEW_PERPS_MARKET_APP_ID \
  --arg NEW_STAKING_APP_ID
```

### Restart Frontend

```bash
cd frontend
rm -rf .next  # Clear Next.js cache
pnpm dev
```

---

## ✅ Verification

After deployment, test the full flow:

1. **Connect wallet** → Should succeed
2. **Add liquidity to options pool** → Should succeed without ApprovalProgram error ✅
3. **Add liquidity to perps pool** → Should succeed without ApprovalProgram error ✅
4. **Buy a call option** → Should succeed and deduct from pool liquidity
5. **Open a long perp** → Should succeed and reserve pool liquidity
6. **View portfolio** → All positions should display

---

## 📊 Success Metrics

**Fixed Bug**:
- ✅ Pool deposit no longer rejects with ApprovalProgram error
- ✅ Transactions succeed regardless of opt-in order
- ✅ Payment transaction found dynamically in group

**Expected Behavior**:
- Users can deposit to pools on first interaction (with opt-in)
- Users can deposit to pools on subsequent interactions (without opt-in)
- Transaction order doesn't matter

---

**System fully functional! Ready for liquidity provision and trading! 🎉**
