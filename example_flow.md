Full Frontend Test Flow (Screen by Screen)

 FLOW A — New Asset Issuance with XSLV

 Screen 1 — Issuer Login
 - URL: http://localhost:3101/login
 - Enter: issuer@testnet.io / Issuer@Test2024!
 - Expected: redirect to /dashboard, sidebar shows "My Assets" active

 Screen 2 — Issuer Dashboard
 - URL: http://localhost:3101/dashboard
 - Expected: table lists XSLV (SUBMITTED), XGLD (ACTIVE)
 - Click XSLV row link → navigate to asset detail

 Screen 3 — XSLV Asset Detail
 - Expected: header shows name/ticker/category
 - Asset details grid: supply, price, lockup, KYC tier, ASA=Not deployed, Verification=PENDING
 - Verification pipeline: 5 stages all grey/empty circles
 - "Upload Documents" link top-right

 Screen 4 — Document Upload Page
 - URL: .../assets/85723ce6-.../documents
 - Expected: checklist shows VAULT_RECEIPT, ASSAY_CERTIFICATE, INSURANCE_CERTIFICATE, + all-category docs (grey)
 - Select "Vault Receipt" from dropdown → click upload zone → pick any PDF
 - Expected: upload completes → checklist item turns green → doc appears in list below
 - Repeat for at least 1 more doc type

 Screen 5 — Admin Login
 - URL: http://localhost:3100/login
 - Enter: admin@testnet.io / Admin@Test2024!
 - Expected: redirect to admin dashboard

 Screen 6 — Admin Asset Pipeline
 - Expected: XSLV row shows Verification=PENDING, "Review" button
 - Stats header: "Pending Review = 1" (or more)

 Screen 7 — 5-Stage Review Modal
 - Click "Review" on XSLV
 - Expected: modal opens with 5 stage cards
 - Each stage: select APPROVED, add a note → Submit Review
 - Expected: modal closes → XSLV row shows Verification=APPROVED, "5/5 stages", "Deploy ASA" button appears

 Screen 8 — Deploy ASA (On-Chain)
 - Click "Deploy ASA"
 - Expected: button shows "Deploying…" for ~5-8 seconds
 - Expected: ASA ID column shows a real Algorand asset number (e.g. 763XXXXXX)
 - Expected: status changes to PRE_MARKET, "Distribute" + "Activate" buttons appear
 - Verify on https://testnet.algoexplorer.io — search ASA ID, see metadataHash

 Screen 9 — Issuer Opt-in (PRE_MARKET)
 - Back to issuer app → XSLV asset detail
 - Expected: Step 1 section visible: "Opt-in to Your ASA on Algorand" with the new ASA ID
 - Expected: opt-in instructions (Pera Wallet → search ASA → confirm)
 - Sidebar: "Connect Pera Wallet" button visible

 Screen 10 — Admin Distribute Tokens
 - Admin dashboard → "Distribute" button on XSLV
 - Modal: enter issuer's Pera wallet address + amount (e.g. 100000 tokens)
 - Click "Transfer Tokens →"
 - Expected: on-chain transfer → TxID shown → "View on AlgoExplorer" link
 - Issuer's Pera wallet now shows token balance

 Screen 11 — Issuer Place Sell Orders
 - XSLV asset detail (issuer app)
 - "Step 2: List Your Token" section
 - Enter: wallet={issuer Pera address}, qty=50000, price=25
 - Click "Place Sell Order →"
 - Expected: success message "Sell order placed: 50000 XSLV @ $25.00 USDC"
 - Connect Pera Wallet in sidebar → green dot shows "Settlement active"

 Screen 12 — Admin Activate Market
 - Admin dashboard → "Activate" button on XSLV
 - Expected: status changes to ACTIVE, asset now visible to investors

 Screen 13 — Investor Buy
 - URL: http://localhost:3000
 - Login as investor@testnet.io / Investor@Test2024!
 - Find XSLV in marketplace
 - Opt-in to ASA (Pera wallet) → place BUY order: 10 XSLV @ 25 USDC
 - Expected: matched → settlement sign request → Pera signing modal appears on issuer's device
 - Issuer signs → atomic group (3 txns) broadcast → investor holds XSLV tokens

     - Opt-in to ASA (Pera wallet) → place BUY order: 10 XSLV @ 25 USDC
     - Expected: matched → settlement sign request → Pera signing modal appears on issuer's device
     - Issuer signs → atomic group (3 txns) broadcast → investor holds XSLV tokens

     FLOW B — Quick Trade Test with XGLD (already ACTIVE)

     - Investor app → find XGLD → place BUY/SELL orders
     - Verify orderbook depth shows real orders

     ---
     On-Chain Verification Checkpoints

     ┌───────────────────┬─────────────────────────────────────────────────────────────────────┐
     │       Step        │                              Check at                               │
     ├───────────────────┼─────────────────────────────────────────────────────────────────────┤
     │ Deploy ASA        │ testnet.algoexplorer.io → search ASA ID → verify metadataHash field │
     ├───────────────────┼─────────────────────────────────────────────────────────────────────┤
     │ Distribute tokens │ Issuer wallet → Assets tab → XSLV balance = distributed amount      │
     ├───────────────────┼─────────────────────────────────────────────────────────────────────┤
     │ Settlement        │ AlgoExplorer tx → 3 inner txns in 1 atomic group                    │
     └───────────────────┴─────────────────────────────────────────────────────────────────────┘

     ---
     Files to Change

     ┌─────────────┬──────────────────────────────────────────────────┬────────────────────────────────────────┐
     │     Bug     │                       File                       │                 Change                 │
     ├─────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────┤
     │ Admin login │ apps/admin/src/lib/auth.ts lines 10-16           │ JWT decode instead of data.user?.role  │
     ├─────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────┤
     │ Doc upload  │ services/asset/src/document/document.service.ts  │ Dev bypass when AWS_ACCESS_KEY_ID=test │
     ├─────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────┤
     │ Depth 401   │ services/orderbook/src/order/order.controller.ts │ Confirm no class-level guard, rebuild  │
     └─────────────┴──────────────────────────────────────────────────┴────────────────────────────────────────┘

