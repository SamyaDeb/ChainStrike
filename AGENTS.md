# ChainStrike - Agent Development Guide

This guide is for AI coding agents working on the ChainStrike decentralized derivatives exchange.

## 🚀 Build & Run Commands

### Frontend Development
```bash
cd frontend
pnpm install                    # Install dependencies
pnpm dev                        # Start dev server (http://localhost:3000)
pnpm build                      # Production build
pnpm lint                       # Run ESLint
pnpm lint --fix                 # Auto-fix linting issues
```

### Contract Development
```bash
cd contracts
algokit project bootstrap all   # Install Python dependencies
algokit project run build       # Compile all contracts
algokit project deploy testnet  # Deploy to TestNet
```

### Testing
```bash
# Frontend (if tests exist)
cd frontend
pnpm test                       # Run all tests
pnpm test -- path/to/test.ts   # Run single test file

# Manual testing checklist in TESTING_GUIDE.md
```

## 📋 Code Style Guidelines

### Import Order
Always organize imports in this order:
```typescript
// 1. External libraries (React, Next.js, third-party)
import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import algosdk from 'algosdk';

// 2. Internal aliases (@/...)
import { Button } from '@/components/ui/button';
import { CONTRACTS } from '@/config/contracts';
import { useSafeWallet } from '@/hooks/useSafeWallet';

// 3. Relative imports
import { calculatePremium } from '../lib/calculations';

// 4. Types (always last)
import type { OptionChainData, OptionType } from '@/types/option';
```

### TypeScript Standards

**Strict Typing:**
```typescript
// ✅ Good - explicit types
function calculateShares(deposit: number, totalLiquidity: number): bigint {
  return BigInt(Math.floor(deposit * 1_000_000));
}

// ❌ Avoid - implicit any
function calculate(x, y) {
  return x * y;
}
```

**Use `type` for objects, `interface` for extensible:**
```typescript
// For simple objects
type PoolStats = {
  tvl: number;
  apy: number;
  utilization: number;
};

// For component props (can be extended)
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  loading?: boolean;
}
```

**Avoid `any` unless absolutely necessary:**
```typescript
// ✅ Good
const data: unknown = await response.json();
if (typeof data === 'object' && data !== null && 'price' in data) {
  return data.price;
}

// ❌ Avoid
const data: any = await response.json();
return data.price; // No type safety
```

### Naming Conventions

**Variables & Functions:**
- `camelCase` for variables, functions, methods
- Descriptive names over abbreviations
```typescript
// ✅ Good
const totalLiquidity = 1000000;
function calculateLiquidationPrice(entry: number, leverage: number) {}

// ❌ Avoid
const tl = 1000000;
function calcLiqPrice(e: number, l: number) {}
```

**Components:**
- `PascalCase` for React components
- Match filename: `OptionChain.tsx` exports `OptionChain`
```typescript
// ✅ Good - OptionChain.tsx
export function OptionChain() {
  return <div>...</div>;
}

// ❌ Avoid
export function optionChain() {} // Wrong case
export default function Component() {} // Unclear name
```

**Constants:**
- `SCREAMING_SNAKE_CASE` for true constants
- `camelCase` for config objects
```typescript
// ✅ Good
const MAX_LEVERAGE = 20;
const MIN_DEPOSIT_ALGO = 1;

const contracts = {
  optionsPool: { appId: 758164078 }
};

// ❌ Avoid
const maxLeverage = 20; // Not clear it's constant
```

### Error Handling

**Always handle errors gracefully:**
```typescript
// ✅ Good - comprehensive error handling
async function depositToPool(amount: number): Promise<TradeResult> {
  try {
    if (!activeAccount) {
      return { success: false, error: 'Wallet not connected' };
    }
    
    const txn = await makePaymentTxn(sender, poolAddress, amount);
    const result = await sendTransaction(txn);
    
    return { success: true, txId: result.txId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
    console.error('Deposit failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

// ❌ Avoid - unhandled errors
async function deposit(amount: number) {
  const txn = await makePaymentTxn(sender, poolAddress, amount);
  return await sendTransaction(txn); // Throws on error
}
```

**User-facing error messages:**
```typescript
// ✅ Good - clear, actionable
error: 'Insufficient ALGO balance. You need at least 1 ALGO for this transaction.'

// ❌ Avoid - technical jargon
error: 'TransactionPool.Remember: txn rejected - below min balance'
```

### React Patterns

**Use hooks properly:**
```typescript
// ✅ Good - proper dependencies
const handleDeposit = useCallback(async (amount: number) => {
  await depositToPool(amount);
}, [depositToPool]);

useEffect(() => {
  if (activeAccount) {
    fetchPoolStats(activeAccount.address);
  }
}, [activeAccount]);

// ❌ Avoid - missing dependencies
useEffect(() => {
  fetchData(); // Where does this come from?
}, []); // Missing dependency
```

**Component structure:**
```typescript
// 1. Imports
import { useState } from 'react';

// 2. Types
type Props = { poolType: 'options' | 'perps' };

// 3. Component
export function PoolStats({ poolType }: Props) {
  // 4. Hooks (always at top)
  const [stats, setStats] = useState(null);
  const { activeAccount } = useSafeWallet();
  
  // 5. Handlers
  const handleRefresh = useCallback(() => {
    // ...
  }, []);
  
  // 6. Effects
  useEffect(() => {
    // ...
  }, []);
  
  // 7. Early returns
  if (!stats) return <Loading />;
  
  // 8. Render
  return <div>...</div>;
}
```

### Algorand Transaction Best Practices

**Transaction Construction:**
```typescript
// ✅ Good - proper grouping and error handling
const txns: algosdk.Transaction[] = [];

// Payment transaction
const paymentTxn = await makePaymentTxn(
  sender,
  poolAddress,
  amountMicroAlgos,
  new TextEncoder().encode('pool_deposit') // Always add descriptive notes
);
txns.push(paymentTxn);

// App call transaction
const appCallTxn = await makeAppCallTxn(sender, poolAppId, methodArgs);
txns.push(appCallTxn);

// Group transactions atomically
const groupedTxns = algosdk.assignGroupID(txns);

// ❌ Avoid - ungrouped transactions (non-atomic)
await sendTransaction(paymentTxn);
await sendTransaction(appCallTxn); // Can fail after payment succeeds!
```

**BigInt for micro-ALGO:**
```typescript
// ✅ Good - proper conversion
const amountAlgo = 10.5;
const amountMicroAlgos = BigInt(Math.floor(amountAlgo * 1_000_000));

// ❌ Avoid - floating point errors
const microAlgos = amount * 1000000; // Precision issues
```

### State Management (Zustand)

**Store patterns:**
```typescript
// ✅ Good - typed store with actions
import { create } from 'zustand';

interface PriceStore {
  algoPrice: number | null;
  lastUpdate: number;
  setPrice: (price: number) => void;
  refresh: () => Promise<void>;
}

export const usePriceStore = create<PriceStore>((set) => ({
  algoPrice: null,
  lastUpdate: 0,
  setPrice: (price) => set({ algoPrice: price, lastUpdate: Date.now() }),
  refresh: async () => {
    const price = await fetchPrice();
    set({ algoPrice: price, lastUpdate: Date.now() });
  },
}));

// Usage
const { algoPrice, refresh } = usePriceStore();
```

## 🔧 Common Patterns

### Dynamic Imports for Wallet Components
```typescript
// ✅ Good - avoid SSR issues
const WalletButton = dynamic(
  () => import('@/components/shared/wallet-button').then(mod => mod.WalletButton),
  { ssr: false, loading: () => <Loading /> }
);
```

### Safe Wallet Hook Usage
```typescript
// ✅ Good - always check wallet availability
const { activeAccount, signTransactions } = useSafeWallet();

if (!activeAccount || !signTransactions) {
  return <ConnectWalletPrompt />;
}
```

### Loading States
```typescript
// ✅ Good - proper loading UX
const [isLoading, setIsLoading] = useState(false);

async function handleSubmit() {
  setIsLoading(true);
  try {
    await performAction();
  } finally {
    setIsLoading(false); // Always reset in finally
  }
}

return (
  <Button disabled={isLoading} loading={isLoading}>
    {isLoading ? 'Processing...' : 'Submit'}
  </Button>
);
```

## 📁 File Organization

```
frontend/src/
├── app/                    # Next.js pages (App Router)
│   ├── page.tsx           # Landing page
│   ├── layout.tsx         # Root layout
│   ├── providers.tsx      # Global providers
│   ├── trade/
│   │   ├── options/       # Options trading page
│   │   └── perps/         # Perpetuals trading page
│   ├── pool/              # Liquidity pool
│   ├── staking/           # STRIKE staking
│   └── portfolio/         # Portfolio dashboard
│
├── components/
│   ├── ui/                # shadcn/ui components
│   ├── shared/            # Shared components (wallet, layout)
│   ├── trading/           # Trading-specific components
│   └── landing/           # Landing page sections
│
├── config/                # Configuration
│   ├── contracts.ts       # Contract addresses & ABIs
│   ├── networks.ts        # Network configs
│   └── deployed-contracts.ts
│
├── hooks/                 # Custom React hooks
│   ├── useSafeWallet.ts  # Wallet hook with fallbacks
│   ├── useTrading.ts     # Trading operations
│   └── usePortfolio.ts   # Portfolio data
│
├── lib/                   # Utilities
│   ├── algorand/         # Algorand SDK utilities
│   │   ├── client.ts     # Algod/Indexer clients
│   │   └── transactions.ts
│   ├── calculations.ts   # Math utilities
│   └── utils.ts          # General utilities
│
├── services/              # API services
│   ├── contracts.ts      # Contract interaction
│   └── price.ts          # Price feeds
│
├── stores/                # Zustand stores
│   ├── price-store.ts    # Price data
│   └── ui-store.ts       # UI state
│
└── types/                 # TypeScript types
    ├── option.ts
    ├── perp.ts
    ├── pool.ts
    └── common.ts
```

## 🐛 Common Issues & Solutions

### Issue: Wallet not connecting
**Solution:** Ensure dynamic import with `ssr: false` and proper client-side checks

### Issue: Transaction rejected by ApprovalProgram
**Solution:** Check transaction group order - payment must be at expected index

### Issue: "Cannot read properties of undefined"
**Solution:** Use optional chaining and null checks:
```typescript
const price = data?.price ?? 0;
if (activeAccount?.address) { ... }
```

### Issue: State not updating in useEffect
**Solution:** Include all dependencies or use useCallback:
```typescript
const fetchData = useCallback(async () => {
  // ...
}, [dependency]);

useEffect(() => {
  fetchData();
}, [fetchData]);
```

## 🧪 Testing Checklist

Before committing changes:
- [ ] Code compiles without errors (`pnpm build`)
- [ ] No linting errors (`pnpm lint`)
- [ ] Tested in browser manually
- [ ] Checked wallet connection flow
- [ ] Verified transaction construction
- [ ] Tested error states (wallet disconnected, insufficient balance)
- [ ] Responsive design tested (mobile, tablet, desktop)

---

**Built for AI agents working on ChainStrike - A decentralized derivatives exchange on Algorand**
