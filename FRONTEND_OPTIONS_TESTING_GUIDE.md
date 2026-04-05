# ChainStrike Frontend Options Testing Guide

This guide covers end-to-end frontend testing for 5-minute options on TestNet using the current ChainStrike deployment.

## Scope

- Verify frontend option purchase flow works with on-chain contracts
- Verify oracle is using live ALGO/USD price (not a fixed test value)
- Verify post-trade behavior (expiry and settlement)
- Capture expected results and troubleshooting steps

## TestNet Setup

- Network: Algorand TestNet
- Oracle App ID: `758189767`
- Options Pool App ID: `758189781`
- Options Market App ID: `758189793`
- Staking App ID: `758189780`

## Accounts Used

- LP account (already funded pool): `HMPG7YLTESN4FQXIGCAHQOXDEIDUIFBOINJDGQ7WUFBTYMOIKDIN6CITPM`
- Trader account: `RTRRQIM2WQCAOVVTMQRFJXXE3G5WJZDWIYZCMTJGF3SFXBAHZDPAMGJDSY`

## 1) Update Oracle to Live Price

Run from project root:

```bash
cd contracts/scripts
python3 -c "from initialize_contracts import update_oracle_price; update_oracle_price()"
```

Expected behavior:

- Fetches live ALGO/USD from CoinGecko (fallback Binance)
- Writes `current_price` on-chain via `emergency_set_price`

Quick verification:

```bash
python3 -c "import ssl,base64; ssl._create_default_https_context=ssl._create_unverified_context; from algosdk.v2client import algod; c=algod.AlgodClient('', 'https://testnet-api.algonode.cloud'); app=c.application_info(758189767); s=app['params']['global-state']; p=0; \
for kv in s:\
 k=base64.b64decode(kv['key']).decode('utf-8','ignore');\
 p=kv['value']['uint'] if k=='current_price' else p;\
print('current_price=', p, 'usd=', p/1_000_000)"
```

## 2) Run Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

Open `http://localhost:3000/trade/options`.

## 3) Frontend Test Case: 5-Minute OTM Call

1. Connect trader wallet (`RTRR...JDSY`) on TestNet.
2. Select option type: `Call`.
3. Set strike to `+2%` above current price.
4. Set expiry to `5 Minutes`.
5. Set quantity to `1` ALGO.
6. Click `Buy Call Option` and approve wallet prompt.

Expected success:

- Success message appears with tx id
- No opt-in transaction is required for OptionsMarket
- Group contains:
  - Txn 0: payment to OptionsMarket
  - Txn 1: app call `create_option(bool,uint64,uint64,uint64)`

## 4) Frontend Fixes Implemented

The following issues in frontend transaction construction were fixed:

1. Removed unnecessary app opt-in for options flow (BoxMap storage does not require local-state opt-in).
2. Corrected ABI app args encoding to ARC4-compatible format (selector + encoded args as separate app args).
3. Added dynamic option box reference using on-chain `next_option_id`.
4. Payment amount now uses contract-compatible premium model + trading fee + box MBR.
5. Expiry selection now uses exact seconds (300 for 5 minutes) plus small buffer, instead of fractional-day drift.

## 5) Backend Validation Run (Live Oracle)

A full backend end-to-end run was executed with live oracle price and succeeded:

- Buy tx: `AIJGAPLUX7JZ723KYN3MAF6B54POJIVN7JNFONM4HFNHTVEYQQ6Q`
- Settle tx: `EPO4LTOBSVRJXMDBISVC3HSL772A5IGQ663S4BBUDPBK2JWTSBGA`
- Oracle observed during run: `$0.120510`

Additional frontend-style transaction simulation also succeeded:

- Buy tx: `NMKHPBAHWBYYWZ47M4NJTX7D3ECRF7ZW4PUFTTR64NCCGNMMM4SQ`

## 6) Settlement Testing

After purchase:

1. Wait until expiry (5 minutes).
2. Settle via backend helper or keeper.

Manual settle helper:

```bash
cd contracts/scripts
python3 -c "from test_options_trading import get_algod_client, settle_option; from algosdk import mnemonic, account; \
mn='immune whisper fish shop quote hole control ship pigeon dash duck parrot bleak chalk hand squeeze round toddler space trim wild polar end above quit'; \
pk=mnemonic.to_private_key(mn); addr=account.address_from_private_key(pk); \
ok,tx,payoff=settle_option(get_algod_client(), pk, addr, 3); print(ok,tx,payoff)"
```

Note: settling before expiry correctly fails with `assert failed` in contract.

## 7) Regression Checklist

- [ ] Oracle `current_price` reflects live market value
- [ ] 5-minute option purchase succeeds from frontend
- [ ] No `ApplicationOptIn` requirement in options purchase flow
- [ ] Correct box reference is included (`opt_<next_option_id>`)
- [ ] Expiry validation enforces protocol min/max
- [ ] Settlement succeeds after expiry and fails before expiry

## 8) Troubleshooting

### Error: `logic eval error` when buying from frontend

Check:

- Payment is transaction index 0
- Method call is transaction index 1
- Foreign apps include oracle, options pool, staking
- Box name uses current `next_option_id`
- Expiry is at least 300 seconds ahead

### Error: oracle looks stale or incorrect

Run live update command again (Section 1), then retry.

### Error: settles fail immediately after buy

Option has not expired yet. Wait full 5 minutes plus a short block-time buffer.

## Files Updated for This Work

- `contracts/scripts/initialize_contracts.py`
- `contracts/scripts/keeper_oracle.py`
- `contracts/scripts/test_options_trading.py`
- `frontend/src/hooks/useTrading.ts`
- `frontend/src/components/trading/option-order-form.tsx`
