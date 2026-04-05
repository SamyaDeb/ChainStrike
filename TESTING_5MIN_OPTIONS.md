# ChainStrike Options Trading Test Guide

## 5-Minute OTM Call Option - Complete End-to-End Testing

**Test Date:** April 3, 2026  
**Network:** Algorand TestNet  
**Test Duration:** ~10 minutes

---

## 🎯 Test Objective

Test the complete lifecycle of a 5-minute Out-of-The-Money (OTM) call option:
1. Buy option from trader account
2. Wait for expiry
3. Settle option
4. Verify LP earnings/losses

---

## 📋 Pre-Requisites

### Contract State ✅ Verified
| Contract | Status | Value |
|----------|--------|-------|
| Oracle Price | ✅ Set | $0.20 per ALGO |
| Min Expiry | ✅ Updated | 300 seconds (5 min) |
| OptionsMarket | ✅ Initialized | All references set |
| Pool Liquidity | ✅ Funded | 59.94 ALGO |

### Accounts Needed
| Account | Address | Purpose |
|---------|---------|---------|
| LP Account | `HMPG7Y...6CITPM` | Deposited 49.95 csOPT |
| Trader Account | (Your second account) | Will buy options |

### Trader Account Requirements
- [ ] At least **5 ALGO** balance
- [ ] Connected to **TestNet**
- [ ] Wallet app ready (Pera/Defly)

---

## 🔧 Testing Methods

### Method A: Backend Script (Automated)
### Method B: Frontend UI (Manual)

---

# Method A: Backend Script Testing

## Step 1: Set Environment Variable

```bash
# Set your trader account mnemonic
export TRADER_MNEMONIC="your 25 word mnemonic phrase here"
```

## Step 2: Run Test Script

```bash
cd /Users/samya/Downloads/ChainStrike/contracts/scripts
python3 test_options_trading.py
```

## Step 3: What the Script Does

```
PHASE 1: PRE-TRADE VERIFICATION
├─ Check trader balance
├─ Check oracle price
├─ Check pool liquidity
├─ Verify opt-in status
└─ Auto opt-in if needed

PHASE 2: BUY 5-MINUTE OTM CALL OPTION
├─ Calculate OTM strike (current price + 2%)
├─ Calculate expiry (5 min from now)
├─ Estimate premium
├─ Execute buy transaction
└─ Verify transaction success

PHASE 3: WAIT FOR EXPIRY
├─ Display countdown timer
└─ Wait 5 minutes

PHASE 4: SETTLE OPTION
├─ Check settlement price
├─ Determine ITM/OTM status
├─ Execute settlement
└─ Receive payoff (if ITM)

PHASE 5: FINAL VERIFICATION
├─ Calculate trader P&L
├─ Calculate pool P&L
├─ Display market stats
└─ Confirm all balances
```

## Expected Output (OTM Scenario - Trader Loses)

```
📊 TRADER P&L:
   Premium Paid: 0.010000 ALGO
   Payoff Received: 0.000000 ALGO
   Net P&L: -0.010000 ALGO
   Result: LOSS 💀 (-100.0%)

📊 POOL P&L:
   Premium Received: 0.009970 ALGO
   Payoff Paid: 0.000000 ALGO
   Net P&L: +0.009970 ALGO
```

## Expected Output (ITM Scenario - Trader Wins)

```
📊 TRADER P&L:
   Premium Paid: 0.010000 ALGO
   Payoff Received: 0.050000 ALGO
   Net P&L: +0.040000 ALGO
   Result: PROFIT 🎉 (+400.0%)

📊 POOL P&L:
   Premium Received: 0.009970 ALGO
   Payoff Paid: 0.050000 ALGO
   Net P&L: -0.040030 ALGO
```

---

# Method B: Frontend UI Testing

## Step 1: Start Frontend Dev Server

```bash
cd /Users/samya/Downloads/ChainStrike/frontend
pnpm dev
```

Open browser: http://localhost:3000

## Step 2: Connect Trader Wallet

1. Click **"Connect Wallet"** in top-right
2. Select **Pera Wallet** or **Defly**
3. Connect your **TRADER account** (not LP account!)
4. Verify account shows in header

## Step 3: Navigate to Options Trading

1. Click **"Trade"** in navigation
2. Click **"Options"**
3. URL: http://localhost:3000/trade/options

## Step 4: Configure Option Trade

### 4.1 Select Option Type
- Click **"Call"** button (green, betting price goes UP)

### 4.2 Enter Strike Price
- Current price: $0.20
- For **OTM test**: Enter `0.204` (2% above current)
- Use the **"+2%"** quick button

### 4.3 Select Expiry
- Click dropdown
- Select **"5 Minutes"** (first option)
- Verify expiry timestamp shown below

### 4.4 Verify Premium
- Auto-calculated based on strike and expiry
- Should be approximately 0.005-0.02 ALGO
- You can adjust if needed

### 4.5 Enter Quantity
- Enter `1` (1 ALGO contract)

## Step 5: Review Order Summary

```
Order Summary:
├─ Total Cost: ~0.015 ALGO
├─ Breakeven Price: $0.219
├─ Max Loss: 0.015 ALGO
└─ Max Profit: Unlimited
```

## Step 6: Execute Trade

1. Click **"Buy Call Option"** button
2. Wallet popup appears
3. Review transaction details:
   - Payment to OptionsMarket: ~0.015 ALGO
   - App call: create_option
4. Click **"Approve"** in wallet
5. Wait for confirmation

## Step 7: Verify Success

After successful transaction:
```
✅ Option purchased successfully!
   Tx: ABCD1234...
```

Check:
- [ ] Transaction ID displayed
- [ ] Wallet balance decreased
- [ ] No error messages

## Step 8: Wait for Expiry

- Set a **5-minute timer**
- Option cannot be settled before expiry
- Monitor the option in Portfolio (if implemented)

## Step 9: Settle Option

### Option A: Automatic (Keeper Bot)
If keeper bot is running, settlement happens automatically

### Option B: Manual Settlement
Run settlement script:
```bash
cd /Users/samya/Downloads/ChainStrike/contracts/scripts
python3 -c "
from test_options_trading import *
import os
client = get_algod_client()
mnemonic_str = os.getenv('TRADER_MNEMONIC')
from algosdk import mnemonic, account
pk = mnemonic.to_private_key(mnemonic_str)
addr = account.address_from_private_key(pk)
settle_option(client, pk, addr, 1)  # option_id = 1
"
```

## Step 10: Verify Final State

### Check Pool State
```bash
cd /Users/samya/Downloads/ChainStrike/contracts/scripts
python3 check_contract_state.py
```

Look for:
- `total_options_created: 1` (increased)
- `total_active_options: 0` (settled)
- `total_premium_volume: X` (increased by premium)
- Pool `total_liquidity`: Should increase if OTM, decrease if ITM

### Calculate LP Earnings

**If OTM (Trader Lost):**
```
LP Share Value Increase:
= Premium Received / Total Shares
= 0.01 ALGO / 59.94 shares
= +0.00017 ALGO per share

Your Position (49.95 shares):
= 49.95 × 0.00017 = +0.0085 ALGO profit!
```

**If ITM (Trader Won):**
```
LP Share Value Change:
= (Premium - Payoff) / Total Shares
= (0.01 - 0.05) ALGO / 59.94 shares
= -0.00067 ALGO per share

Your Position (49.95 shares):
= 49.95 × (-0.00067) = -0.033 ALGO loss
```

---

## 📊 Test Verification Checklist

### Transaction Success
- [ ] Option purchase transaction confirmed
- [ ] Transaction ID received
- [ ] No ApprovalProgram rejection

### Contract State Changes
- [ ] `next_option_id` increased by 1
- [ ] `total_options_created` increased by 1
- [ ] `total_active_options` = 1 (before settlement)
- [ ] `total_premium_volume` increased

### Pool Changes
- [ ] Pool received premium
- [ ] Pool liquidity increased by premium
- [ ] LP share value increased

### After Settlement
- [ ] `total_active_options` = 0
- [ ] Option marked as `is_settled: true`
- [ ] Payoff transferred (if ITM)
- [ ] Pool liquidity adjusted

---

## 🐛 Troubleshooting

### Error: "Not initialized"
**Solution:** Run `python3 initialize_contracts.py`

### Error: "Oracle price is zero"
**Solution:** Oracle needs price update. Run initialization script.

### Error: "Expiry too soon"
**Solution:** min_expiry might still be 3600. Run initialization script.

### Error: "Insufficient payment"
**Solution:** Premium too low. Increase premium amount.

### Error: "Exceeds max utilization"
**Solution:** Pool doesn't have enough available liquidity.

### Error: "Not opted in"
**Solution:** Opt into OptionsMarket app first.

### Error: "Transaction rejected"
**Solution:** Check all parameters are correct:
- Strike in microUSD (multiply by 1,000,000)
- Size in microALGO (multiply by 1,000,000)
- Expiry > current time + 300 seconds

---

## 🔄 Quick Re-Test Commands

### Reset Oracle Price (if needed)
```bash
cd /Users/samya/Downloads/ChainStrike/contracts/scripts
python3 -c "
from initialize_contracts import update_oracle_price
update_oracle_price()
"
```

### Check Contract State
```bash
cd /Users/samya/Downloads/ChainStrike/contracts/scripts
python3 check_contract_state.py
```

### Run Full Test
```bash
export TRADER_MNEMONIC="your mnemonic here"
cd /Users/samya/Downloads/ChainStrike/contracts/scripts
python3 test_options_trading.py
```

---

## 📈 Expected Test Results

### Successful Test Output

```
======================================================================
🧪 CHAINSTRIKE OPTIONS TRADING TEST
======================================================================

Trader Address: WXYZ...1234
Test Time: 2026-04-03 10:30:00

======================================================================
PHASE 1: PRE-TRADE VERIFICATION
======================================================================

📊 Trader Balance: 10.500000 ALGO
📊 Oracle Price: $0.200000 per ALGO
📊 Pool Liquidity: 59.940000 ALGO
📊 Pool Shares: 59.940000 csOPT
📊 Min Expiry: 300 seconds (5.0 minutes)
📊 Next Option ID: 1
📊 Opted into OptionsMarket: Yes ✅

======================================================================
PHASE 2: BUY 5-MINUTE OTM CALL OPTION
======================================================================

📈 Current Price: $0.200000
📈 OTM Strike (+2%): $0.204000
📅 Current Time: 2026-04-03 10:30:15
📅 Expiry Time: 2026-04-03 10:35:25

  Creating option transaction...
    Type: CALL
    Strike: $0.204000
    Expiry: 2026-04-03 10:35:25
    Size: 1.000000 ALGO
    Premium: 0.010000 ALGO
    Fee (0.3%): 0.000030 ALGO
    Total Cost: 0.010030 ALGO

  ✅ Option purchased successfully!
    Transaction ID: ABCD1234EFGH5678...
    Option ID: 1

📊 ALGO Spent: 0.010030
📊 Pool Liquidity Gain: 0.010000 ALGO

======================================================================
PHASE 3: WAITING FOR OPTION EXPIRY
======================================================================

⏳ Waiting 310 seconds until expiry...
   Expiry at: 2026-04-03 10:35:25
   Time remaining: 05:00 ... 04:59 ... ... 00:01 

✅ Option has expired!

======================================================================
PHASE 4: SETTLE OPTION
======================================================================

📊 Settlement Price: $0.200000
📊 Strike Price: $0.204000
📊 Option Status: OUT OF THE MONEY (OTM) 💀

  Settling option #1...

  ✅ Option settled!
    Transaction ID: WXYZ9876MNOP5432...
    Payoff: 0.000000 ALGO

======================================================================
PHASE 5: FINAL VERIFICATION
======================================================================

📊 TRADER P&L:
   Premium Paid: 0.010030 ALGO
   Payoff Received: 0.000000 ALGO
   Net P&L: -0.010030 ALGO
   Result: LOSS 💀 (-100.0%)

📊 POOL P&L:
   Premium Received: 0.010000 ALGO
   Payoff Paid: 0.000000 ALGO
   Net P&L: +0.010000 ALGO

📊 MARKET STATS:
   Total Options Created: 1
   Total Active Options: 0
   Total Premium Volume: 0.010000 ALGO
   Total Settled Volume: 1.000000 ALGO

======================================================================
🎉 TEST COMPLETE!
======================================================================

✅ All phases completed successfully!

Option #1 has been:
  1. Created ✅
  2. Purchased ✅
  3. Expired ✅
  4. Settled ✅
  5. Verified ✅
```

---

## ✅ Test Complete!

After successful testing:
1. LP account earned premium (if OTM) or paid payout (if ITM)
2. Trader account lost premium (if OTM) or profited (if ITM)
3. All contract state updated correctly
4. System working end-to-end!

**Next Steps:**
- Test PUT options
- Test 1-hour options
- Test multiple concurrent options
- Test LP withdrawal with profits
