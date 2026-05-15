# ChainStrike — Phase-Wise Implementation Guide

> Compliant, Orderbook-Based RWA Exchange on Algorand
> Architecture-first implementation blueprint covering every layer: identity, compliance, tokenization, orderbook, settlement, and security.

---

## Table of Contents

- [Phase 0 — Architecture Decisions & System Design](#phase-0)
- [Phase 1 — Core Infrastructure & DevOps Foundation](#phase-1)
- [Phase 2 — Identity Infrastructure: KYC & KYB Systems](#phase-2)
- [Phase 3 — Algorand Smart Contract Layer](#phase-3)
- [Phase 4 — Real Asset Definition, Verification & Tokenization Framework](#phase-4)
- [Phase 5 — Compliance Engine](#phase-5)
- [Phase 6 — Orderbook Engine & Matching System](#phase-6)
- [Phase 7 — Settlement Layer](#phase-7)
- [Phase 8 — Oracle & Market Data Infrastructure](#phase-8)
- [Phase 9 — Issuer Dashboard & Onboarding Portal](#phase-9)
- [Phase 10 — Investor Platform & Trading Interface](#phase-10)
- [Phase 11 — Security Architecture](#phase-11)
- [Phase 12 — Testing, Audit & Quality Assurance](#phase-12)
- [Phase 13 — Regulatory & Legal Framework](#phase-13)
- [Phase 14 — Production Launch & Operations](#phase-14)

---

## Phase 0 — Architecture Decisions & System Design {#phase-0}

This phase locks in the architectural philosophy before any code or infrastructure is built. Every decision here has multi-year consequences on compliance, scalability, and legal enforceability.

### Step 0.1 — Define the Core Architectural Philosophy

**Decision: Hybrid Architecture**

ChainStrike adopts a hybrid architecture: off-chain performance-sensitive operations (orderbook state, matching engine, KYC workflows) combined with on-chain finality (asset settlement, ownership records, compliance enforcement). This is the only viable model for an institution-grade RWA exchange that must be both fast and legally enforceable.

The principle: anything that requires speed, privacy, or complex computation lives off-chain. Anything that requires finality, auditability, or trustless execution lives on-chain.

**Decision: Permissioned Trading Layer**

Unlike open DeFi, every interaction on ChainStrike passes through a compliance gate. No wallet address can interact with any RWA token unless explicitly whitelisted by the compliance engine. This is enforced at the smart contract level, not just the application level.

**Decision: Non-Custodial User Wallets, Custodial Asset Reserves**

Investors connect their own Algorand wallets (Pera Wallet, Defly) and hold tokens in self-custody. However, underlying real-world assets are held by licensed third-party custodians with institutional-grade multi-signature governance. This separates user sovereignty from asset security.

### Step 0.2 — Map Every System Actor and Their Permissions

Define five distinct system actors and their access boundaries before building anything:

**1. Platform Admin (ChainStrike team)**
- Can approve/reject KYB applications
- Can emergency-freeze any asset
- Can override compliance rules under regulatory direction
- Holds multi-sig keys for platform treasury and governance contracts
- Cannot unilaterally clawback user assets without governance vote

**2. Compliance Officer**
- Can update whitelist status for individual investors
- Can file SAR (Suspicious Activity Reports)
- Can trigger manual KYC review escalation
- Can set jurisdiction-level restrictions
- Cannot see investor private financial data beyond what compliance requires

**3. Issuer (Asset Owner/Company)**
- Can create and manage their own RWA tokens
- Can configure compliance rules for their specific asset
- Can place initial liquidity orders for their market
- Can issue dividends or corporate actions to token holders
- Cannot see other issuers' data or modify other issuers' tokens

**4. Investor (Verified Individual)**
- Can trade only assets permitted by their KYC tier and jurisdiction
- Can place, cancel, and view their own orders
- Cannot see other investors' order intent before execution (only visible depth)
- Cannot transfer RWA tokens to non-whitelisted addresses

**5. Market Maker (Privileged Investor)**
- Higher order volume limits
- API access for programmatic trading
- Reduced fees in exchange for maintaining minimum spread requirements

### Step 0.3 — Define the Data Architecture (On-Chain vs Off-Chain)

**Lives On-Chain (Algorand):**
- ASA token definitions (supply, decimals, metadata CID)
- Token balances (held in user wallets via opt-in)
- Whitelist registry (approved addresses per asset)
- Trade settlement records (atomic transaction groups)
- Asset freeze/clawback events
- Compliance rule configurations per asset
- Corporate action distributions (dividend transactions)

**Lives Off-Chain (Platform Database):**
- KYC/KYB identity data and documents (PII must not be on-chain)
- Order book state (bids, asks, order IDs, timestamps)
- User account profiles, tier levels, trading limits
- Document repositories (asset legal documents, verification reports)
- AML monitoring logs and SAR drafts
- Market OHLCV data and analytics
- Email, notifications, session management

**Exists as Hashes On-Chain (Tamper-Evident Off-Chain Data):**
- Sha256 hashes of asset legal documents committed to ASA metadata
- Hash of KYC approval event (not the PII itself) for audit trail
- Hash of issuer's offering document at time of token creation

### Step 0.4 — Define the Microservices Architecture

Eight independent backend services, each with a single responsibility:

1. **Identity Service** — KYC/KYB workflows, tier management, whitelist triggers
2. **Asset Service** — ASA creation, token management, asset lifecycle
3. **Compliance Service** — Transfer rule enforcement, AML monitoring, reporting
4. **Orderbook Service** — Order CRUD, book state management, market data streaming
5. **Matching Engine** — Order matching, settlement instruction generation
6. **Settlement Service** — Atomic transaction construction and submission to Algorand
7. **Notification Service** — Email, in-app, webhook notifications
8. **Analytics Service** — Market data, portfolio calculations, reporting

Each service owns its database schema. Services communicate via an internal message queue (events) and direct API calls only where synchronous response is required.

### Step 0.5 — Define Integration Points

Map all external systems before building:

- **KYC Provider:** Sumsub (primary) for full identity + KYB workflows
- **Blockchain Analytics:** Chainalysis or Elliptic for ongoing AML wallet screening
- **Algorand Node:** Self-hosted Algorand node + Algod/Indexer API (AlgoNode for fallback)
- **Document Storage:** AWS S3 with server-side encryption (AES-256) for KYC/KYB documents
- **Price Oracles:** Chainlink (where available on Algorand) + custom oracle contracts for asset valuations
- **Email Provider:** SendGrid or AWS SES for transactional emails
- **Secret Management:** AWS KMS or HashiCorp Vault for API keys and signing keys

---

## Phase 1 — Core Infrastructure & DevOps Foundation {#phase-1}

### Step 1.1 — Cloud Infrastructure Setup

**Choose deployment region** based on regulatory compliance:
- Primary region must be in a MiCA-compliant or VASP-registered jurisdiction
- Consider Singapore (MAS-friendly), UAE (ADGM sandbox), or EU (MiCA)
- Multi-region active-passive setup: primary processes orders, secondary is disaster recovery

**Infrastructure components to provision:**
- Kubernetes cluster for containerized microservices
- Managed PostgreSQL (primary relational store for all services)
- Redis cluster (orderbook state cache, session management, rate limiting)
- Message queue system: Apache Kafka or AWS SQS (for event-driven communication between services)
- Object storage (S3 or equivalent) for document storage with SSE-S3 encryption
- CDN for frontend static assets
- Load balancer with DDoS protection (CloudFlare or AWS Shield)
- VPN gateway for internal service communication

### Step 1.2 — Database Schema Design Principles

Before writing any schema, establish these invariants across all databases:

- Every table has `created_at`, `updated_at`, and `deleted_at` (soft delete only — never hard delete compliance records)
- Every compliance-relevant change is appended to an immutable audit log table, not updated in place
- PII fields (name, date of birth, government ID number) are encrypted at the column level using AES-256 before storage
- No PII leaves the Identity Service's database boundary in plain text — other services receive only user IDs and tier levels
- All foreign keys reference UUIDs, not sequential integers (prevents enumeration attacks)

**Core data entities to design schemas for:**

- `users` — account registration, status, email
- `kyc_profiles` — KYC tier, verification status, expiry date (no raw PII here, only status)
- `kyc_documents` — encrypted document references, types, verification status
- `kyb_entities` — business profiles, incorporation details
- `ubo_records` — Ultimate Beneficial Owner declarations
- `assets` — tokenized RWA definitions, ASA ID, custodian info
- `asset_documents` — legal document hashes and storage references
- `orders` — order ID, asset, side, price, quantity, status, user ID
- `trades` — matched trade records, settlement TX ID
- `whitelist_entries` — approved (address, asset) pairs with tier and expiry
- `compliance_events` — immutable log of all compliance-relevant events
- `audit_log` — system-wide append-only audit trail

### Step 1.3 — Message Queue Topology Design

Define event topics before building any service. Services publish events, never call each other for state mutations:

- `kyc.verified` — fired when user completes KYC; consumed by Compliance Service to whitelist address
- `kyb.approved` — fired when issuer KYB is approved; consumed by Asset Service to unlock token creation
- `asset.created` — fired when new ASA is deployed; consumed by Orderbook Service to open a market
- `order.placed` — fired when order enters book; consumed by Matching Engine
- `order.matched` — fired when match found; consumed by Settlement Service
- `trade.settled` — fired when on-chain TX confirmed; consumed by Notification and Analytics services
- `compliance.flagged` — fired when AML detects suspicious activity; consumed by Compliance Service for SAR workflow
- `whitelist.updated` — fired when whitelist changes; consumed by Settlement Service to re-validate pending orders

### Step 1.4 — Algorand Node Infrastructure

**Self-hosted node vs. third-party:**
For production, run a self-hosted Algorand participation node on dedicated infrastructure. Third-party nodes (AlgoNode, Nodely) are acceptable for development and as fallback but introduce availability risk for a trading platform.

**Node configuration requirements:**
- Algod API: Main node interaction (submit transactions, query state)
- Indexer API: Historical queries (transaction history, account state at block height)
- Node must run in non-participation mode (relay node) for performance
- Configure with fast catchup for rapid synchronization after downtime
- Archive node for full historical indexer queries

**Algorand network environments to maintain:**
- LocalNet: Local development (AlgoKit sandbox)
- TestNet: Integration testing and staging
- MainNet: Production only

### Step 1.5 — Key Management Infrastructure

This is critical. Define key management before any smart contracts are deployed.

**Key categories and custody requirements:**

- **Platform Admin Multi-Sig Keys:** 3-of-5 threshold; keys distributed across 5 hardware security modules (HSMs) held by senior officers in geographically separate locations
- **Compliance Master Keys:** 2-of-3 multi-sig; held by Chief Compliance Officer, Legal Counsel, and platform escrow service; used only for regulatory freeze/clawback actions
- **Settlement Service Signing Keys:** Rotatable hot keys stored in AWS KMS; used only by Settlement Service to sign transaction groups; never held in application memory longer than the transaction lifetime
- **API Signing Keys:** Short-lived JWTs signed with asymmetric keys; keys rotated every 90 days via KMS
- **Document Encryption Keys:** Master key in KMS with envelope encryption for each document

Never store any private key in:
- Application source code
- Environment variables in plaintext
- Docker image layers
- Logging output

### Step 1.6 — Monitoring & Observability Setup

Before the first service is deployed, establish observability:

- Distributed tracing across all services (OpenTelemetry protocol)
- Centralized log aggregation with 90-day retention for application logs, 7-year retention for compliance logs
- Metrics dashboards: service latency, orderbook depth, trade volume, KYC pass rate, failed transaction rate
- Alerting: immediate page for failed settlements, compliance flags, node connectivity loss, abnormal trading volumes
- Audit log query interface for compliance team to investigate events

---

## Phase 2 — Identity Infrastructure: KYC & KYB Systems {#phase-2}

This is the most legally critical phase. The identity layer is the gate between the public internet and the regulated RWA exchange. Every investor and every issuer must pass through it.

### Step 2.1 — KYC Architecture Design

**Adopt a Tiered Risk-Based KYC Model**

The regulatory standard is risk-based KYC — higher-value activities require deeper verification. Design three tiers:

**Tier 1 — Basic Retail Investor**
- Verification required: Government-issued photo ID (passport, national ID, driver's license), selfie liveness check, email and phone verification
- Sanctions screening: Automated OFAC SDN + EU consolidated sanctions list check
- PEP screening: Basic Politically Exposed Person check
- Trading limits enabled: Up to INR 10 lakh / USD 12,000 equivalent per rolling 12-month period
- Jurisdictions permitted: Tier 1 jurisdictions only (exclude FATF grey/black list countries)
- Re-verification cycle: Every 2 years

**Tier 2 — Accredited / High-Net-Worth Investor**
- Everything in Tier 1 PLUS:
- Source of funds documentation: Bank statement (3 months), investment account statement
- Net worth declaration: Self-certified with supporting documents
- Video KYC session or in-person agent verification (jurisdiction-dependent)
- Enhanced PEP screening and adverse media check
- Trading limits enabled: Up to INR 5 crore / USD 600,000 per rolling 12-month period
- Re-verification cycle: Every 1 year

**Tier 3 — Institutional / Qualified Institutional Buyer (QIB)**
- Full KYB (entity verification as below) PLUS named individual trader authorizations
- Investment mandate review (if fund/trust)
- Board resolution authorizing trading activity
- Compliance officer interview
- Unlimited trading subject to per-asset restrictions
- Continuous enhanced due diligence

**KYC Data Flow Architecture**

The flow must be designed so PII never touches application servers unnecessarily:

1. User accesses KYC widget embedded in the platform frontend (served directly by Sumsub SDK)
2. User submits documents and biometrics directly to Sumsub's servers — PII never hits ChainStrike application servers
3. Sumsub performs automated verification (OCR, biometrics, sanctions screening)
4. Sumsub posts webhook callback to ChainStrike Identity Service with: verification status, tier determination, risk score, expiry date — no PII in the callback
5. Identity Service updates user's KYC tier record and triggers `kyc.verified` event
6. Compliance Service receives event and adds user's Algorand wallet address to the on-chain whitelist for permitted assets

**What ChainStrike stores about KYC:**
- User ID, KYC tier (1/2/3), status (pending/approved/rejected/expired), expiry date, Sumsub applicant ID (for audit retrieval), jurisdiction code, risk score band (low/medium/high)
- NOT stored on ChainStrike servers: government ID numbers, document images, biometric data — these live in Sumsub's encrypted vaults

### Step 2.2 — KYC Continuous Monitoring

KYC is not a one-time event. Build the following continuous monitoring loops:

**Sanctions Re-screening (Daily Automated)**
- Every active user's identity is re-screened against updated OFAC, UN, EU sanctions lists every 24 hours
- If a match is detected: immediately freeze user's whitelist status, halt open orders, notify Compliance Officer
- Compliance Officer has 4 hours to review and confirm or clear the match
- If confirmed: trigger asset freeze via clawback address authority, file regulatory report

**Tier Expiry Management**
- 60 days before KYC tier expires: send re-verification reminder to user
- 30 days before expiry: warn that trading limits will be reduced
- On expiry date: automatically downgrade user to Tier 0 (read-only) until re-verification completes
- New Tier 0 users cannot place orders but can still withdraw assets to their wallet

**Behavioral Anomaly Detection**
- If user's trade patterns deviate significantly from historical behavior (sudden 10x volume increase, trades at unusual hours, geographic location change inferred from login IP), flag for enhanced review
- Configurable thresholds per tier

### Step 2.3 — KYB Architecture Design

KYB is for issuers — businesses that want to tokenize and list RWAs on ChainStrike.

**KYB Verification Stages**

Stage 1 — Business Registration Verification
- Collect: Certificate of Incorporation, Memorandum and Articles of Association, Proof of Business Address (utility bill or bank statement under 3 months), Business registration number
- Verification: Cross-check registration number against official government business registries (via Sumsub's KYB module or direct registry API)
- Goal: Confirm the business legally exists in its claimed jurisdiction

Stage 2 — Legal Standing and Business Activity
- Collect: Most recent 2 years of audited financial statements, Business bank account statement (6 months), Proof of primary business activity relevant to the asset being tokenized (e.g., gold dealer license for gold-backed tokens, real estate ownership documents for property tokens)
- Verification: Manual review by ChainStrike compliance team + Sumsub's automated business document checks
- Goal: Confirm business is legitimately operating in the asset category it claims

Stage 3 — Ultimate Beneficial Owner (UBO) Discovery and Verification
This is the most complex and critical stage.

- Define UBO threshold: Any individual owning or controlling ≥ 25% of the business (FATF standard; some jurisdictions use 10%)
- Document collection per UBO: Personal government ID, proof of address, source of wealth declaration
- Collect: Shareholder register showing all owners above threshold, Group structure diagram showing ownership chain, For each UBO identified: personal KYC documents (same as Tier 2 investor KYC)
- Multi-layer analysis: If a shareholder is itself a company (not a natural person), go one layer deeper — recursively until all ultimate natural persons are identified
- Special cases requiring enhanced scrutiny: Any UBO who is a PEP (politician, senior public official, or their family member), Any UBO in a FATF-listed high-risk jurisdiction, Any business operating through nominee directors (directors legally owning shares on behalf of the true beneficial owner)
- Technology: Use Sumsub's KYB module for automated document processing + graph analytics to detect hidden ownership structures

Stage 4 — Director and Authorized Signatory Verification
- All directors must pass Tier 1 individual KYC
- Authorized signatories (individuals authorized to sign on behalf of the business) must pass Tier 2 KYC
- Board resolution authorizing ChainStrike account must be signed and notarized

Stage 5 — Risk Assessment and Approval
- Internal risk committee reviews complete KYB package
- Risk scoring: jurisdiction risk + business type risk + UBO profile risk + financial health indicators
- Risk categories: Low (auto-approve), Medium (compliance officer approval), High (committee vote required)
- Rejection reasons must be documented for regulatory audit

Stage 6 — Ongoing KYB Monitoring
- Annual re-verification of all issuer KYB documentation
- Trigger re-KYB on: change of directors, change of ownership above UBO threshold, change of business address or jurisdiction, material change in financial position
- Daily sanctions screening of all KYB entities and their UBOs

### Step 2.4 — Asset Onboarding KYB (Issuer's Asset Verification)

Beyond the business KYB, each asset the issuer wants to tokenize requires a separate asset verification process (detailed in Phase 4). The architecture for this is:

- Issuer submits asset application through the Issuer Dashboard
- Asset application links to the issuer's approved KYB profile
- Asset verification workflow is separate from business KYB and can be run in parallel for subsequent assets
- Each asset gets its own approval status, compliance rules, and smart contract configuration

### Step 2.5 — Identity Service Internal Architecture

The Identity Service is a standalone microservice with its own database. It:

- Owns all relationships between platform user IDs and KYC/KYB provider IDs
- Owns the Algorand wallet address → user ID mapping
- Emits whitelist events to the Compliance Service
- Never exposes raw PII via API — only tier status, approval status, and expiry dates
- Provides an admin interface for Compliance Officers to view KYC status and trigger manual actions
- Maintains an immutable event log of every status change with timestamp, actor, and reason

---

## Phase 3 — Algorand Smart Contract Layer {#phase-3}

### Step 3.1 — Smart Contract Architecture Overview

Five smart contracts form the on-chain compliance and settlement infrastructure. Each is designed with a single responsibility. They communicate through Algorand's contract-to-contract call mechanism.

**Contract 1: Whitelist Registry Contract**
- Maintains the canonical mapping of (investor address, asset ID) → (approved: bool, tier: uint, expiry: uint64)
- Only callable by platform's Compliance Oracle (a dedicated hot wallet controlled by Compliance Service)
- Read-only queries available to all other contracts
- Emits on-chain events (via note field or ARC-28 logging) for every whitelist add/remove

**Contract 2: Smart ASA Factory Contract**
- Manages the creation and initial configuration of new ASA tokens for each RWA
- Enforces that all newly created tokens have: freeze address set (Compliance Master), clawback address set (Compliance Master), default frozen = true
- Records the mapping of (asset ID) → (issuer address, asset type, compliance contract ID)
- Only callable by platform Admin after KYB approval

**Contract 3: Transfer Restriction Contract (Per-Asset)**
- One deployed instance per RWA token
- Enforces all transfer rules specific to that asset: jurisdiction restrictions, lock-up periods, maximum holding limits, minimum trade size
- Called by Settlement Contract before executing any transfer
- Configured at deployment time by Issuer (within platform-defined bounds) and can be updated by Issuer with Admin approval

**Contract 4: Orderbook Settlement Contract**
- Executes atomic swap transactions for matched trades
- Receives settlement instructions from Settlement Service
- Before executing: calls Transfer Restriction Contract to validate both parties
- Calls Whitelist Registry to confirm both buyer and seller are currently approved
- Executes atomic group: seller sends asset tokens to buyer, buyer sends USDC/ALGO to seller, platform fee sent to treasury
- Emits trade settlement event on-chain for permanent audit trail

**Contract 5: Escrow and Locking Contract**
- Holds buyer's USDC in escrow when a limit order is placed
- Funds released to seller on trade settlement, or returned to buyer on order cancellation
- Prevents double-spending: once funds are in escrow, they cannot be used for other orders
- Settlement Contract can only draw from escrow for verified matched orders

### Step 3.2 — ASA Configuration for RWA Tokens

Every RWA token created on ChainStrike must follow this exact configuration:

**Immutable at creation (cannot change after deployment):**
- `total`: Maximum supply defined by issuer (e.g., 1,000,000 tokens for 1M grams of gold)
- `decimals`: Defined by asset type (8 for gold to allow fractional grams, 0 for whole property shares)
- `unit-name`: Short ticker (e.g., "XGLD", "MUMB1")
- `asset-name`: Full name (e.g., "ChainStrike Gold Token Series A")

**Mutable (controlled by Manager address = Platform Admin Multi-Sig):**
- `manager`: Platform Admin multi-sig address (3-of-5 threshold)
- `reserve`: Issuer's custodian wallet address (holds uncirculated supply)
- `freeze`: Compliance Master multi-sig address (2-of-3 threshold)
- `clawback`: Compliance Master multi-sig address (same as freeze for RWA)
- `default-frozen`: MUST be set to `true` — no account can hold or transfer tokens without explicit whitelist approval

**The `default-frozen: true` pattern is critical for compliance:**
When default-frozen is true, every account that opts into the asset starts in a frozen state. The Compliance Service must explicitly unfreeze (whitelist) the account before they can receive or send tokens. This means: even if a user somehow bypasses the platform's compliance check, the blockchain itself will reject the transfer.

**Metadata standard (ARC-3 + ARC-19):**
- `url`: Points to JSON metadata file on IPFS containing asset details, custodian info, legal document hashes
- `metadata-hash`: SHA-256 hash of the metadata JSON (tamper-evident)
- Metadata JSON contains: asset description, custodian name, legal document IPFS CIDs, offering terms summary, platform URL
- For mutable metadata (changing valuations): use ARC-19 pattern where metadata URL contains the IPFS template, allowing metadata to be updated by changing the reserve address content

### Step 3.3 — Multi-Signature Governance Architecture

**Platform Admin Multi-Sig (3-of-5):**
Required signers for: deploying new smart contracts, changing Manager address on ASA, emergency global pause, treasury withdrawals above threshold
Keyholder distribution: CEO, CTO, CFO, Legal Counsel, independent Trustee
Geographic distribution: Keys must be in minimum 3 different physical locations
Hardware requirement: All keys on hardware wallets (Ledger, Trezor) — never hot wallets for admin multi-sig

**Compliance Master Multi-Sig (2-of-3):**
Required signers for: individual asset freeze actions, clawback execution, jurisdiction-level suspensions
Keyholder distribution: Chief Compliance Officer, Legal Counsel, Regulatory Liaison
Time lock: All clawback actions have a 24-hour time lock with notification to affected user (except in cases of law enforcement order)

**Issuer Operations Multi-Sig (1-of-2 for routine, 2-of-2 for critical):**
Routine: Placing initial liquidity orders, updating asset metadata
Critical: Modifying compliance rules, increasing total supply (if applicable), initiating redemption

### Step 3.4 — Smart Contract Deployment Pipeline

Never deploy smart contracts directly from a developer's machine. Establish a deployment pipeline:

1. Smart contract code is reviewed by minimum 2 senior engineers
2. External security audit is completed (Phase 12)
3. Contract deployed to TestNet by CI/CD pipeline
4. Automated test suite runs against TestNet deployment
5. Manual QA sign-off on TestNet
6. Contract deployed to MainNet requires 2-of-3 sign-off from admin multi-sig holders
7. Deployment transaction is stored with its deployment parameters in the audit log
8. Post-deployment: immediately verify contract state matches expected initial state

### Step 3.5 — Contract Upgrade Strategy

Algorand smart contracts are immutable once deployed. Plan for upgrades from day one:

**Strategy: Proxy Pattern**
Deploy a lightweight proxy contract that routes calls to the current implementation contract. When an upgrade is needed:
- Deploy new implementation contract on TestNet → audit → MainNet
- Admin multi-sig calls proxy to update the implementation pointer
- Old implementation remains on-chain for historical reference
- Users interacting with proxy contract automatically use new logic

**What cannot be upgraded:** ASA configuration addresses (manager, freeze, clawback) — these can only be changed by the current manager address. Design the manager address to always be the Admin multi-sig, never a specific smart contract.

---

## Phase 4 — Real Asset Definition, Verification & Tokenization Framework {#phase-4}

### Step 4.1 — Supported Asset Categories

ChainStrike MVP supports these asset categories, each with distinct verification requirements:

**Category 1: Precious Metals (Gold, Silver)**

Legal Structure:
- Physical metal held in a licensed, insured vault (custodian)
- Vault issues a warehouse receipt (legally binding custody document) to the SPV
- SPV is incorporated and legally owned by the Issuer
- Tokens represent fractional ownership of the SPV's rights to the warehouse receipt

Documentation Required from Issuer:
- Vault storage agreement with the custodian (licensed vault operator)
- Warehouse receipt or vault receipt specifying: metal type, purity (fineness), weight, vault location, insurance amount
- Certificate of Assay from a certified testing laboratory confirming metal quality
- Insurance certificate covering metal value plus 10% buffer
- SPV incorporation documents (if using SPV structure)
- Auditor's confirmation letter verifying physical existence of metal in vault
- Tokenization ratio: how many tokens correspond to how much physical metal (e.g., 1 token = 1 gram of 99.9% pure gold)

Ongoing Verification:
- Quarterly independent auditor confirmation that metal remains in vault and matches token supply
- Annual professional revaluation of metal against LME (London Metal Exchange) spot price
- Any warehouse transfer requires new receipt and platform notification

Price Oracle: LME gold fix price updated twice daily via oracle contract

**Category 2: Real Estate (Fractional Property)**

Legal Structure:
- Property is transferred to a specially incorporated SPV
- SPV holds legal title to the property
- Tokens represent fractional economic interest in the SPV (not direct property ownership, which triggers complex property transfer tax)
- SPV constitution defines: voting rights, redemption conditions, profit distribution

Documentation Required:
- Property title deed (must be free of encumbrances, liens, or mortgages exceeding specified threshold)
- Professional independent valuation report from RICS (Royal Institution of Chartered Surveyors) certified valuer
- SPV incorporation documents, shareholder agreement, articles of association
- Property tax payment receipts (no outstanding tax liabilities)
- Building inspection report and any regulatory certifications
- No-objection certificates from local authorities if required
- If tenanted: rental agreements, tenant details, occupancy rate history
- Title insurance policy

Ongoing Verification:
- Semi-annual valuation updates
- Annual audit of SPV financial statements
- Any material property event (sale, mortgage, damage) requires immediate platform notification and potential trading halt

Price Oracle: Periodic NAV (Net Asset Value) updates by appointed administrator, not real-time market feed

**Category 3: Private Debt / Corporate Bonds**

Legal Structure:
- Issuer creates a bond instrument via SPV or directly
- Bond has defined: principal amount, interest rate (fixed or floating), maturity date, payment schedule
- Tokens represent fractional ownership of the bond principal
- Coupon payments distributed proportionally to token holders

Documentation Required:
- Bond indenture or term sheet (signed by issuer and trustee)
- Credit assessment report from recognized credit rating agency or independent credit analyst
- Legal opinion from qualified attorney confirming the bond's legal validity
- SPV or issuer's audited financial statements for last 3 years
- Trustee appointment letter

Ongoing Verification:
- Coupon payment tracking and on-chain distribution verification
- Issuer financial health monitoring (annual financial statements)
- Any default or credit event triggers immediate trading halt and compliance review

**Category 4: Commodities (Agricultural, Energy, Industrial)**

Legal Structure:
- Physical commodity stored at a licensed, inspected warehouse
- Warehouse receipt issued to SPV
- Quality certificate from independent inspector at deposit time

Documentation Required:
- Warehouse receipt from licensed warehouse operator
- Quality/grade certificate from independent commodity inspector
- Insurance covering storage and transit
- Quantitative specification: commodity type, grade, quantity, measurement unit
- Warehouse operator's regulatory license

Ongoing Verification:
- Semi-annual physical inventory audits
- Quality re-testing if applicable (for commodities that can degrade)

### Step 4.2 — Asset Verification Workflow

The verification process has five stages with defined timelines and responsibilities:

**Stage 1 — Issuer Submission (Day 1)**
Issuer completes the asset creation wizard in the Issuer Dashboard:
- Selects asset category
- Uploads all required documents to encrypted document vault
- Provides metadata: asset name, description, tokenization ratio, total supply requested, minimum investment, jurisdiction restrictions
- Declares custodian details and custody arrangement type
- Pays listing fee (non-refundable, covers verification cost)
- Asset enters "Submitted" status

**Stage 2 — Initial Screening (Days 1-3)**
ChainStrike compliance team performs initial document completeness check:
- All required documents present and legible
- Documents are recent (not expired)
- Issuer's KYB profile is in good standing
- No obvious red flags (documents from sanctioned entities, jurisdiction issues)
- If incomplete: return to issuer with specific gap list
- If complete: move to Stage 3

**Stage 3 — Third-Party Verification (Days 3-14)**
The most critical stage. External parties verify the claims:

For Physical Assets (metals, real estate, commodities):
- Independent auditor physically inspects and confirms asset existence and condition
- Custodian provides direct confirmation letter to ChainStrike (not via issuer) confirming custody arrangement
- Legal counsel reviews ownership documentation and confirms clean title

For Financial Instruments (bonds, private debt):
- Legal counsel reviews bond indenture and confirms legal validity
- Trustee confirms appointment and instrument structure
- Credit analyst reviews issuer's financial health

All third-party verification reports are stored in encrypted document vault with SHA-256 hash committed to asset metadata.

**Stage 4 — Risk Committee Review (Days 14-21)**
Internal risk committee reviews the complete package:
- Compliance team presents findings
- Legal team presents legal opinion
- Risk team presents risk assessment
- Committee votes: Approve / Approve with Conditions / Reject
- All committee decisions are documented with rationale

**Stage 5 — Token Parameter Finalization and ASA Creation (Days 21-25)**
If approved:
- Total supply, decimals, tokenization ratio finalized
- Compliance rules configured for this specific asset
- ASA created on Algorand TestNet for final validation
- Issuer reviews token parameters and signs off
- ASA deployed to Algorand MainNet via Smart ASA Factory Contract
- Token listed in ChainStrike marketplace with "Pre-Market" status
- Issuer can now place initial liquidity orders (Phase 9)

### Step 4.3 — Asset Metadata Standard

Every RWA token on ChainStrike follows this metadata schema (stored on IPFS, hash committed on-chain):

- `platform`: "ChainStrike"
- `asset_id`: Algorand ASA ID
- `asset_category`: One of the defined categories
- `issuer`: Issuer entity name and KYB-verified legal identifier
- `custodian`: Custodian name, license number, jurisdiction
- `tokenization_ratio`: Human-readable description (e.g., "1 XGLD = 1 gram of 999.9 fine gold")
- `legal_documents`: Array of IPFS CIDs for legal documents (visible to verified investors)
- `auditor_reports`: Array of IPFS CIDs for auditor verification reports
- `platform_listing_date`: ISO 8601 timestamp of MainNet listing
- `compliance_contract_id`: Algorand application ID of this asset's Transfer Restriction Contract
- `jurisdiction_restrictions`: List of ISO 3166 country codes where trading is blocked
- `investor_requirements`: Minimum KYC tier required, accreditation requirements

### Step 4.4 — Asset Lifecycle Management

Assets do not simply exist statically — they have a lifecycle:

**Active** → Normal trading enabled
**Pre-Market** → ASA created, initial orders being placed by issuer, no investor trading yet
**Suspended** → Trading halted due to compliance event, under investigation
**Redemption-Open** → Asset entering redemption phase, new buys blocked, sells to redemption queue only
**Redeemed/Closed** → All tokens redeemed, asset delisted, ASA frozen permanently

Lifecycle transitions require:
- Active → Suspended: Compliance Officer action (automatic on AML flag, or manual)
- Suspended → Active: Compliance Officer + Admin approval after investigation closure
- Active → Redemption-Open: Issuer request + Admin approval
- Redemption-Open → Redeemed: After all tokens redeemed, Admin closure

---

## Phase 5 — Compliance Engine {#phase-5}

### Step 5.1 — Compliance Engine Architecture

The Compliance Engine is the central authority that enforces all trading rules. It operates at two levels:

**Pre-Trade Compliance (Synchronous)**
Every order submission passes through pre-trade checks before entering the order book. If any check fails, the order is rejected immediately with a specific error code.

**Post-Trade Compliance (Asynchronous)**
After trade settlement, every transaction is re-analyzed against AML patterns. Suspicious patterns trigger alerts and SAR workflow even for already-completed trades.

### Step 5.2 — Pre-Trade Compliance Checks

For every order submitted, the Compliance Engine runs these checks in sequence (fail-fast, ordered by processing cost):

**Check 1 — Session and Authentication Validity**
Confirm user is authenticated, session is valid, and no active account suspension.

**Check 2 — KYC Tier Status**
- Confirm user's KYC tier is active and not expired
- Confirm user meets minimum tier requirement for this specific asset
- If tier expired: reject with "KYC verification expired, please re-verify"

**Check 3 — Whitelist Status (On-Chain)**
- Query Whitelist Registry Contract to confirm user's Algorand address is approved for this specific asset
- This is the most authoritative check — even if all off-chain checks pass, the on-chain contract is the final gate
- If not whitelisted: reject with "Trading not permitted for this asset"

**Check 4 — Jurisdiction Check**
- Determine user's trading jurisdiction (from KYC data, not IP address — IP is too easily spoofed)
- Cross-check against asset's jurisdiction restriction list
- If jurisdiction is blocked: reject with "Asset not available in your jurisdiction"

**Check 5 — Sanctions and AML Status**
- Check user's current AML risk status (cached from daily screening, refreshed if stale)
- If user is flagged or under review: reject with generic "Order cannot be processed at this time"
- Never reveal to user that they are flagged (to avoid tipping off bad actors)

**Check 6 — Trading Limit Verification**
- Calculate user's rolling 30-day trading volume in USD equivalent
- Confirm this order would not exceed their tier's maximum
- If limit would be exceeded: reject with "Trading limit reached for current verification tier"

**Check 7 — Order Parameter Validation**
- Order price within allowed price bands (±20% of last traded price, configurable per asset)
- Order quantity above minimum order size
- Order quantity below maximum single-order size
- Sufficient escrowed balance (for buy orders) or sufficient token balance (for sell orders)

### Step 5.3 — Transfer Restriction Rule Engine

The Transfer Restriction Contract on Algorand enforces these rules at the blockchain level, making them uncircumventable even if the application layer is bypassed:

**Rule Category 1: Identity-Based Rules**
- Both sender and receiver must be in the Whitelist Registry for the specific asset
- Sender must not be in a frozen state (ASA freeze mechanism)
- Receiver must have opted into the ASA (Algorand's native opt-in requirement)

**Rule Category 2: Quantity-Based Rules**
- Minimum transfer amount: Prevents dust trades and manipulation
- Maximum single transfer amount: Prevents large block moves that could signal wash trading
- Maximum total holdings per address: Limits concentration risk (e.g., no single investor can hold more than 5% of total supply)

**Rule Category 3: Temporal Rules**
- Lock-up period: No transfers within X days of initial purchase (common for private placements; typically 6-12 months)
- Transfer cool-down: Minimum Y hours between transfers from same address (prevents rapid arbitrage or wash trading)
- Trading hours: Some assets may only trade during defined windows (e.g., only during underlying market hours)

**Rule Category 4: Issuer-Defined Custom Rules**
Issuers can configure additional rules within bounds set by ChainStrike:
- Whitelist-only transfers (no P2P secondary trading outside the platform)
- Jurisdiction-specific restrictions beyond platform defaults
- Accredited investor requirement (only Tier 2+ can hold the asset)
- Minimum holding period before secondary sale

### Step 5.4 — AML Transaction Monitoring

**Real-Time Monitoring (Every Trade)**

Every settled trade is immediately analyzed by the AML monitoring system:

- Trade amount in USD equivalent logged against user's daily/weekly/monthly totals
- Structuring detection: series of trades just below reporting thresholds (e.g., 9 trades of $9,900 in one day)
- Rapid round-trip detection: Buy then sell (or vice versa) the same asset within a short window at same or similar price suggests wash trading
- Cross-asset correlation: If user simultaneously trades multiple assets in a pattern consistent with market manipulation, flag for review
- Counterparty risk: If user's frequent counterparty has a high AML risk score, elevate user's monitoring level

**Blockchain Analytics Integration (Wallet-Level AML)**

Integrate Chainalysis or Elliptic API for wallet-level risk assessment:
- Before first trade from any wallet: query wallet risk score
- Categories assessed: direct exposure to sanctioned entities, indirect exposure through mixed/tumbled funds, exposure to darknet markets, prior association with hacks or theft
- Risk score bands: Clean / Low / Medium / High / Severe
- Medium risk: Enhanced monitoring, lower trading limits
- High/Severe risk: Automatic freeze pending compliance review

**SAR (Suspicious Activity Report) Workflow**

When AML monitoring flags a suspicious pattern:
1. Automated flag creates a draft SAR in the Compliance Dashboard
2. System auto-populates: user identity (from KYC records), transaction details, flagged pattern description
3. Compliance Officer reviews within 24 hours
4. Decision: Clear flag / Escalate / File SAR with Financial Intelligence Unit (FIU)
5. If escalated: account trading suspended pending further review
6. If SAR filed: submitted to relevant national FIU (FinCEN for USD, FINTRAC for CAD, FIU-IND for INR)
7. Tipping-off prohibition: User is NOT notified that a SAR has been filed (regulatory requirement)

### Step 5.5 — Compliance Audit Trail

Every compliance action creates an immutable log entry containing:
- Timestamp (microsecond precision)
- Action type (whitelist add/remove, order approved/rejected, SAR filed, asset frozen, etc.)
- Actor (who took the action: system, compliance officer ID, admin ID)
- Subject (which user ID, wallet address, asset ID, order ID was affected)
- Reason code and human-readable description
- Previous state and new state

Audit logs are:
- Write-once (no updates or deletes ever)
- Replicated to a separate, isolated audit log database
- Exported to cold storage (S3 Glacier) daily
- Retained for 7 years (regulatory requirement in most jurisdictions)
- Queryable by Compliance Officers via a dedicated query interface

---

## Phase 6 — Orderbook Engine & Matching System {#phase-6}

### Step 6.1 — Orderbook Architecture Philosophy

ChainStrike uses a **Central Limit Order Book (CLOB)** with a hybrid execution model:

- Order state is maintained off-chain (in Redis and PostgreSQL) for performance
- Matching logic runs off-chain for speed (sub-millisecond matching)
- Settlement is always on-chain (Algorand atomic groups) for finality and auditability

This gives institution-grade performance without sacrificing trustless settlement.

### Step 6.2 — Order Types Supported (MVP)

**Limit Order (Core)**
- User specifies exact price and quantity
- Order sits in book until matched or cancelled
- Filled at limit price or better

**Market Order**
- User specifies quantity only
- Matched immediately against best available limit orders
- Execution at market price
- Risk: slippage if book is thin — add maximum slippage protection setting

**Good-Till-Cancelled (GTC)**
Default time-in-force for limit orders. Order remains active until explicitly cancelled or filled.

**Immediate-or-Cancel (IOC)**
Order fills as much as possible immediately and cancels unfilled remainder. Used for aggressive institutional orders.

**Fill-or-Kill (FOK)**
Order must fill entirely in one execution or be cancelled completely. No partial fills.

**Post-Only**
Order is rejected if it would immediately match (prevents taking liquidity, useful for market makers seeking to always pay maker fees).

### Step 6.3 — Matching Engine Design

**Matching Algorithm: Price-Time Priority (Pro-Rata variant for large books)**

Standard price-time priority:
1. Best price gets priority (lowest ask for buys, highest bid for sells)
2. Among orders at the same price, earliest submission time gets priority

**Order Book Data Structure in Memory (Redis)**

For each market (asset pair, e.g., XGLD/USDC):
- `bids`: Sorted set ordered by price descending, then by timestamp ascending within each price level
- `asks`: Sorted set ordered by price ascending, then by timestamp ascending within each price level
- Each order entry contains: order ID, price, quantity remaining, user ID reference

**Matching Loop (Event-Driven)**

When a new order arrives:
1. Compliance pre-check (synchronous, described in Phase 5)
2. Order stored in PostgreSQL with status "pending"
3. Order emitted to Matching Engine via message queue
4. Matching Engine loads relevant price levels from Redis
5. Attempt to match against opposite side:
   - For buy: check if any ask ≤ buy price exists
   - For sell: check if any bid ≥ sell price exists
6. If match found: generate settlement instruction (buy order ID, sell order ID, matched quantity, execution price)
7. Update order quantities in Redis (partial fill or full fill)
8. If order fully filled: mark as complete in PostgreSQL
9. If order partially filled: leave remainder in book
10. Emit `order.matched` event with settlement instruction

**Performance Targets:**
- Order submission to matching decision: < 10ms
- Settlement instruction to on-chain TX submission: < 500ms
- End-to-end order-to-settlement: < 5 seconds (bounded by Algorand block time ~4 seconds)

### Step 6.4 — Order State Machine

Every order moves through a defined state machine:

`NEW` → `COMPLIANCE_CHECK` → `ACCEPTED` → `PARTIALLY_FILLED` → `FILLED`
                                    ↓                                    ↓
                               `REJECTED`                         `CANCELLED`
                                                                        ↓
                                                               `EXPIRED` (if time-in-force)

State transitions:
- NEW → COMPLIANCE_CHECK: Instant on submission
- COMPLIANCE_CHECK → ACCEPTED: All pre-trade checks pass, funds escrowed, order in book
- COMPLIANCE_CHECK → REJECTED: Any pre-trade check fails, funds not escrowed, order not in book
- ACCEPTED → PARTIALLY_FILLED: Some quantity matched, remainder still in book
- ACCEPTED/PARTIALLY_FILLED → FILLED: Full quantity matched, settlement triggered
- ACCEPTED/PARTIALLY_FILLED → CANCELLED: User explicitly cancels, escrowed funds returned
- ACCEPTED → EXPIRED: Time-in-force reached, escrowed funds returned

### Step 6.5 — Price Discovery and Market Data

For each active market, the system calculates and broadcasts:

**Real-Time:**
- Best bid price and total quantity at best bid
- Best ask price and total quantity at best ask
- Mid-market price (midpoint between best bid and ask)
- Last traded price and quantity
- Order book depth (top 10 bid/ask price levels with quantities)

**Historical (OHLCV bars):**
- Open, High, Low, Close, Volume for configurable time intervals (1m, 5m, 15m, 1h, 4h, 1d)
- Calculated from trade records and stored in time-series database

**Market Health Metrics:**
- Spread: Ask - Bid (absolute and percentage)
- Spread warning threshold: If spread exceeds 2% of mid-price, display warning to users
- Liquidity depth: Total USD value within 1% of mid-price (indicator of market quality)
- Circuit breakers: If price moves more than 10% within 5 minutes, automatically pause trading for 15 minutes and notify issuers

### Step 6.6 — Risk Management (Pre-Settlement Risk Engine)

Before the Settlement Service submits any atomic transaction to Algorand, a final risk check runs:

- Confirm both orders are still in FILLED state (not cancelled in the window between matching and settlement)
- Confirm buyer's escrowed USDC is still locked (race condition protection)
- Confirm seller's token balance is sufficient (recheck at settlement time, not just at order placement)
- Confirm both parties' whitelist status is still active (could have changed since order placement)
- If any check fails: abort settlement, reverse order states, return escrowed funds, notify both parties

---

## Phase 7 — Settlement Layer {#phase-7}

### Step 7.1 — Settlement Architecture Overview

Settlement is where off-chain matching becomes on-chain finality. The Settlement Service is the only service authorized to submit transactions to Algorand.

**Settlement Pipeline:**

1. Matching Engine emits `order.matched` event with settlement instruction
2. Settlement Service receives instruction from message queue
3. Settlement Service queries current on-chain state: buyer's ALGO/USDC balance in Escrow Contract, seller's token balance, whitelist status of both parties
4. Settlement Service constructs Algorand atomic transaction group
5. Settlement Service requests signing from KMS-managed settlement key
6. Signed transaction group broadcast to Algorand network
7. Settlement Service monitors for confirmation (waits up to 3 block times = ~12 seconds)
8. On confirmation: emit `trade.settled` event with on-chain TX ID
9. On failure: emit `settlement.failed` event and trigger retry/rollback logic

### Step 7.2 — Atomic Transaction Group Construction

Each settlement is a single Algorand atomic transaction group containing:

**Transaction 1 — Token Transfer (Seller to Buyer)**
- Type: Asset Transfer (axfer)
- Sender: Seller's Algorand address
- Receiver: Buyer's Algorand address
- Asset: The RWA ASA being traded
- Amount: Matched quantity
- Note: Encoded reference to ChainStrike trade ID

**Transaction 2 — Settlement Currency Transfer (Buyer's Escrow to Seller)**
- Type: Asset Transfer (axfer) for USDC, or Payment (pay) for ALGO
- Sender: Escrow Contract (authorizing via logic signature)
- Receiver: Seller's Algorand address
- Amount: Execution price × quantity

**Transaction 3 — Platform Fee (Escrow to Treasury)**
- Type: Asset Transfer or Payment
- Sender: Escrow Contract
- Receiver: ChainStrike treasury address
- Amount: Platform fee (e.g., 0.25% of trade value)

**Transaction 4 (Optional) — On-Chain Trade Record**
- Type: Application Call to Settlement Contract
- Records trade event on-chain: trade ID, asset ID, price, quantity, timestamp

All four transactions are grouped atomically. The entire group either succeeds completely or fails completely — no partial settlement.

### Step 7.3 — Seller's Token Transfer Authorization

The seller's private key signs the token transfer transaction. Since ChainStrike is non-custodial for investors, the seller must sign this transaction themselves.

**Architecture for User-Side Signing:**

1. Matching Engine generates the settlement instruction
2. Settlement Service constructs the unsigned transaction group
3. Settlement Service sends unsigned transaction group to seller's browser via WebSocket
4. Seller's wallet (Pera Wallet, Defly) prompts for approval with transaction details displayed
5. Seller signs Transaction 1 (token transfer to buyer)
6. Signed TX returned to Settlement Service
7. Settlement Service assembles all signatures and broadcasts

**Timeout Handling:**
If seller does not sign within 30 seconds: cancel the matched trade, return both orders to book, notify buyer that seller's order was cancelled. Seller's order status downgraded (multiple failures can trigger account review).

**Pre-Signed Order Architecture (Alternative for Institutional Traders):**
High-volume institutional traders can pre-sign blanket authorization logic signatures that delegate signing authority to the Settlement Contract for orders within defined parameters. This enables programmatic settlement without manual wallet approval per trade.

### Step 7.4 — Settlement Confirmation and Finality

Algorand achieves finality in approximately 4.5 seconds (one block). Unlike probabilistic finality chains (Bitcoin, pre-merge Ethereum), Algorand's finality is absolute — once a transaction is in a confirmed block, it cannot be reversed.

**Confirmation monitoring:**
- After broadcast, Settlement Service subscribes to Algorand Indexer for the transaction hash
- On confirmation: update trade status to SETTLED, update user portfolio balances, emit `trade.settled` event
- On rejection (invalid transaction): analyze rejection reason, update trade status to FAILED, trigger rollback

**Rollback on Settlement Failure:**
If the atomic group fails on-chain (which can happen if state changed between construction and broadcast):
1. Both orders return to ACCEPTED state
2. Escrowed funds remain locked
3. Matching Engine re-queues the orders for re-matching
4. If three consecutive failures for same order pair: escalate to manual review

### Step 7.5 — Corporate Actions (Post-MVP)

For income-generating RWA tokens (bonds with coupons, real estate with rental income), the Settlement Layer also handles distributions:

**Dividend/Coupon Distribution:**
1. Issuer initiates a distribution event via Issuer Dashboard
2. System calculates each token holder's entitlement (proportional to holdings at record date)
3. Admin multi-sig approves distribution
4. Settlement Service constructs batch of atomic payment transactions (up to 16 per batch)
5. Distributions processed in batches until all eligible holders have received payment
6. Distribution event recorded on-chain via Settlement Contract

---

## Phase 8 — Oracle & Market Data Infrastructure {#phase-8}

### Step 8.1 — The Oracle Problem for RWA

RWA tokens need real-world prices on-chain. The "oracle problem" is that blockchains cannot natively access external data — a trusted mechanism is needed to bring off-chain data on-chain in a tamper-resistant way.

**For ChainStrike, oracles serve three purposes:**
1. Reference pricing: LME gold prices, COMEX commodity prices for price band calculation
2. NAV calculation: Real estate or fund valuation updates
3. Custody verification: Proof that physical assets remain in custody (audit attestations)

### Step 8.2 — Oracle Architecture

**On-chain Oracle Contract:**
A dedicated Algorand smart contract serves as the official on-chain price feed registry. This contract:
- Stores the latest verified price for each supported asset
- Stores the timestamp of the last price update
- Stores the identity of the authorized price submitter
- Allows querying by asset ID
- Emits an on-chain event with every price update (for auditability)

**Off-Chain Oracle Service (ChainStrike-operated initially):**
In the MVP phase, ChainStrike operates a trusted oracle service:
1. Backend service fetches prices from licensed data providers (e.g., Reuters Eikon, Bloomberg API, LME feeds)
2. Prices are aggregated and validated (cross-reference minimum 2 sources, reject if sources diverge by more than 0.5%)
3. Validated price signed by Oracle Service's key (managed in KMS)
4. Signed price update submitted to Oracle Contract on Algorand
5. Update frequency: Every 4 hours for metals, daily for real estate NAVs

**Oracle Security:**
- Oracle Service key is stored in KMS, not accessible to other services
- Price update transactions require threshold validation (if price changes by more than 5% from previous update, require additional manual approval before submission)
- Oracle data staleness protection: Settlement Contract checks that oracle price is not older than configurable maximum age; if stale, trading is paused

**Post-MVP: Decentralized Oracle Integration**
Once the ecosystem matures, integrate with a decentralized oracle network to reduce centralization risk. Multiple oracle operators report prices independently, and the Oracle Contract implements a median or weighted average, slashing operators who deviate significantly.

### Step 8.3 — Price Band Enforcement

To prevent manipulation and fat-finger errors, the matching engine enforces price bands:

- Hard limit: ±20% from oracle reference price — orders outside this band are rejected outright
- Soft limit: ±10% from last traded price — orders outside this range require explicit user confirmation ("your order is significantly away from market price, confirm?")
- Circuit breaker: If last traded price moves ±10% within any 5-minute window, pause all new order submissions for 15 minutes, notify issuer and compliance team

Price bands are configurable per asset by the Compliance Engine, not fixed globally.

---

## Phase 9 — Issuer Dashboard & Onboarding Portal {#phase-9}

### Step 9.1 — Issuer Onboarding Flow

The issuer journey from registration to live market follows this sequence:

**Step 1 — Account Registration**
- Business email registration
- Email verification
- Company profile creation (name, jurisdiction, business type)
- Account enters "Pending KYB" state

**Step 2 — KYB Submission**
- Issuer accesses KYB wizard guiding them through document submission
- Documents uploaded securely to encrypted document vault
- KYB submitted to compliance team for review (timeline shown: 7-14 business days)
- Real-time status updates via dashboard and email

**Step 3 — KYB Review and Approval**
- Compliance team communicates via secure in-platform messaging (not email — prevents phishing)
- Any missing documents or clarifications requested through dashboard
- On approval: issuer receives "Verified Issuer" badge, can proceed to asset creation

**Step 4 — Wallet Connection**
- After KYB approval, issuer connects their Algorand wallet
- Platform records (issuer ID → Algorand address) mapping in Identity Service
- This address becomes the official reserve address for all assets issued by this entity
- Multi-sig wallet strongly recommended and enforced for institutional issuers

**Step 5 — Asset Application**
- Issuer starts asset creation wizard
- Guided through asset category selection, required documents, tokenization parameters
- System validates documents in real-time (OCR checks for document type, date validity)
- Asset application submitted for verification (Phase 4 workflow)

**Step 6 — Token Launch Preparation**
- After asset verification approval, token parameters are presented to issuer for confirmation
- Issuer reviews: total supply, decimals, tokenization ratio, compliance rules, minimum investment
- Issuer signs off digitally (cryptographic signature via connected wallet)
- Platform admin deploys ASA on TestNet for issuer review
- After issuer confirms TestNet parameters, admin deploys to MainNet

**Step 7 — Initial Liquidity Setup**
- Critical phase: issuer places initial orders to seed the orderbook
- Platform provides a minimum liquidity requirement guide (suggested spreads, minimum depth)
- Issuer places sell orders (the primary offering) and optionally buy orders (buyback program)
- Funds (USDC or equivalent) locked in Escrow Contract for buy orders
- Tokens moved to seller wallet position for sell orders
- Issuer can preview orderbook depth before going live

**Step 8 — Market Launch**
- After minimum liquidity is satisfied: admin enables trading
- Asset status changes to "Active"
- Investor-facing market page goes live
- Orderbook becomes visible to all verified investors matching jurisdictional requirements

### Step 9.2 — Issuer Dashboard Features

**Dashboard Overview:**
- Real-time market summary: last price, 24h volume, spread, market cap
- Token supply breakdown: circulating vs reserve
- Active orders summary: total open buy value, total open sell value
- Investor base: count of unique token holders (anonymized)

**Asset Management Panel:**
- Asset documents: view/replace documents (triggers re-verification for material changes)
- Compliance rules: view and request changes to transfer restrictions
- Custody attestation: upload latest auditor/custodian confirmation letters

**Order Management:**
- View all issuer's active orders
- Place new orders (buy/sell)
- Cancel existing orders
- Set up automatic order replenishment (repost at same parameters when filled)

**Corporate Actions Panel:**
- Initiate dividend/coupon distribution
- Announce material events (property sale, metal delivery, bond redemption)
- Communicate with token holders (broadcast messages to all verified holders)

**Analytics:**
- Historical price chart
- Volume breakdown by time period
- Holder distribution (anonymized tiers: <100 tokens, 100-1000 tokens, etc.)
- Revenue received from platform (trading fees attributed to this market)

---

## Phase 10 — Investor Platform & Trading Interface {#phase-10}

### Step 10.1 — Investor Onboarding Flow

**Step 1 — Registration and Email Verification**
- Standard email/password registration
- Email verification required before any further action
- Terms of service and risk disclosure acknowledgment (legally required)
- Privacy policy acceptance with data processing consent

**Step 2 — KYC Initiation**
- After registration, investor is prompted to complete KYC
- Clear tier description shown: what each tier enables in terms of assets and trading limits
- KYC widget embedded (Sumsub SDK) — document capture and selfie without leaving platform
- In-progress state saved: investor can leave and return to complete KYC
- Status tracking: Submitted → Under Review → Approved / Rejected / Needs More Info

**Step 3 — Wallet Connection**
- After KYC approval, investor connects Algorand wallet
- Supported wallets: Pera Wallet (official Algorand wallet), Defly, Exodus (Algorand support)
- MetaMask/Ethereum wallets: NOT supported (Algorand is a separate blockchain)
- Platform guides user to create/import wallet if they don't have one
- Address recorded against KYC identity in Identity Service

**Step 4 — Asset Opt-In**
- Before trading any RWA token, investor must opt into the ASA (Algorand native requirement)
- Platform explains: "To hold this asset, your wallet must opt-in. This reserves 0.1 ALGO per asset as minimum balance."
- Opt-in transaction is submitted by investor's wallet
- After opt-in: platform checks investor's whitelist eligibility and submits whitelist addition to Whitelist Registry Contract

**Step 5 — Funding**
- Investor funds their account with USDC (Algorand USDC via Circle)
- Or directly from ALGO holdings
- On-ramp integration (fiat-to-crypto) for non-crypto-native investors: partner with a licensed payment processor

### Step 10.2 — Trading Interface Design

**Market Discovery Page:**
- Grid of all active markets with: token name, last price, 24h change (%), 24h volume, asset category icon
- Filter by: asset category, jurisdiction availability, minimum investment
- Sort by: volume, price change, newest
- Locked markets displayed with "Not Available in Your Jurisdiction" or "KYC Upgrade Required" overlays

**Individual Market Page:**
- Price chart (TradingView or custom charting library) with OHLCV data
- Real-time orderbook display: top 10-20 bid and ask levels with cumulative depth visualization
- Recent trades ticker: showing last 50 trades with price, quantity, time
- Asset information panel: custodian, auditor, tokenization ratio, legal document links (for verified holders only)
- Order entry form: integrated directly on trading page

**Order Entry Form:**
- Toggle: Limit / Market / IOC / FOK
- For Limit: Price field, quantity field, estimated total calculation
- Pre-trade summary: "You will spend X USDC to buy Y tokens at Z price" with fee breakdown shown
- Compliance check preview: before submission, run a lightweight compliance preflight and show result to user ("Your order is within your trading limits")
- Confirm button: requires second confirmation for orders above defined threshold (e.g., above $5,000)

**Portfolio Page:**
- Holdings table: each asset with current quantity, average purchase price, current value, unrealized P&L
- Open orders: all active orders across all markets
- Trade history: complete filled order history with all details
- Tax report export: CSV export of all trades for tax reporting purposes (jurisdiction-specific format)

### Step 10.3 — Wallet and Asset Management

**Token Withdrawal (P2P Transfer):**
Investors can transfer tokens to other Algorand addresses ONLY if:
- Recipient address is also whitelisted for that specific asset
- Transfer complies with lock-up period and transfer restrictions
- If transferring to non-whitelisted address: the on-chain Transfer Restriction Contract will reject the transaction before it executes

Clear messaging to users: "RWA tokens can only be transferred to other verified ChainStrike users. Attempting to transfer to non-verified addresses will fail."

**USDC Withdrawal:**
- Investors can withdraw USDC to any Algorand address
- Above withdrawal thresholds (e.g., $10,000 equivalent) require compliance review
- Withdrawal requests above threshold enter a 24-hour review queue
- AML check on destination address before approval

---

## Phase 11 — Security Architecture {#phase-11}

### Step 11.1 — Application Security

**Authentication and Session Management:**
- JWT tokens for API authentication, short-lived (15-minute expiry) with refresh token rotation
- Refresh tokens stored HTTP-only cookies, not accessible to JavaScript
- Multi-factor authentication (MFA) mandatory for all issuers; strongly recommended for investors with holdings above threshold
- Hardware security key (FIDO2/WebAuthn) support for admin accounts
- Session invalidation on password change, suspicious activity, or compliance freeze

**API Security:**
- All APIs served over TLS 1.3 only
- API rate limiting per user ID and IP: aggressive limits on authentication endpoints (5 attempts per minute), moderate on trading endpoints (100 orders per minute), unlimited on market data reads
- Input validation: all user input validated server-side, never trust client-side validation
- SQL injection prevention: parameterized queries only, ORM with no raw string concatenation
- XSS prevention: all user-generated content HTML-escaped, strict Content Security Policy headers
- CORS: only platform's own domains and verified partner domains whitelisted

**Internal Service Security:**
- All inter-service communication uses mutual TLS (mTLS) — services verify each other's certificates
- Services run in isolated network segments; Settlement Service is the most isolated, accessible only from Matching Engine and Admin tools
- Principle of least privilege: each service has a database user with only the permissions it needs (read-only where reads are sufficient)
- No service has credentials that allow it to call Algorand except the Settlement Service

### Step 11.2 — Smart Contract Security

**Access Control Patterns:**
- Every sensitive function in every contract has a strict access control check at the first line
- Owner addresses and authorized caller addresses are stored in contract global state
- Admin functions require a multi-sig authorization check (verify N-of-M signatures in the transaction group)
- Emergency pause mechanism: any contract can be paused by Admin multi-sig without upgrading it

**Input Validation in Contracts:**
- Validate all passed arguments: amounts are positive and non-zero, addresses are valid Algorand addresses (not zero address), timestamps are reasonable (not in the past beyond tolerance, not impossibly far in future)
- Overflow protection: Algorand's AVM uses 64-bit unsigned integers; validate that arithmetic operations won't overflow before executing
- Reentrancy protection: Although Algorand's execution model prevents traditional reentrancy, design contracts to complete all state changes before making external calls

**Economic Attack Prevention:**
- Flash loan attacks: Not applicable on Algorand's current architecture, but design contracts so multi-block sequences cannot be exploited through coordination
- Oracle manipulation: Price band enforcement on Settlement Contract ensures no single bad oracle reading can execute trades at wildly incorrect prices
- Front-running: Off-chain order submission + atomic settlement reduces but does not eliminate front-running risk; consider adding a commit-reveal scheme for large orders

### Step 11.3 — Infrastructure Security

**Network Security:**
- All services behind WAF (Web Application Firewall) for DDoS protection and attack pattern detection
- Public internet exposure limited to: HTTPS API gateway, WebSocket endpoint for real-time data, frontend static site
- All database, message queue, internal service endpoints on private network only (no public exposure)
- VPN required for any direct database access

**Data Security:**
- All data at rest encrypted with AES-256 (managed by cloud provider KMS)
- All PII fields additionally encrypted at application layer (double encryption) before storage
- Backups encrypted and stored in geographically separate region
- Database connection strings and API keys stored in secrets manager, injected at runtime — never in code or Docker images

**Dependency Security:**
- All third-party dependencies reviewed and pinned to specific versions (no floating version ranges)
- Automated vulnerability scanning on every dependency update (Snyk, Dependabot)
- No dependencies from anonymous or unvetted publishers
- Supply chain review before adding any new dependency

### Step 11.4 — Operational Security

**Change Management:**
- All production changes via pull requests with minimum 2 reviewer approvals
- Smart contract changes require additional security team review
- Production deployments require deployment run-book and rollback plan documented before execution
- Emergency changes require documented incident justification and post-incident review

**Incident Response Plan:**
Define before launch, with clear owner for each scenario:
- Security breach (unauthorized access): Incident Commander, containment procedure, notification timeline
- Smart contract exploit: Emergency pause procedure, user communication template, on-chain resolution path
- Node downtime: Failover to backup node, trading halt procedure, recovery timeline
- Regulatory inquiry: Legal counsel contact, data preservation procedure, response timeline

**Penetration Testing:**
Annual third-party penetration test of entire platform. Scope includes: web application, API, smart contracts (separate audit), cloud infrastructure, social engineering. Results actioned within defined SLA based on severity.

---

## Phase 12 — Testing, Audit & Quality Assurance {#phase-12}

### Step 12.1 — Smart Contract Audit

Smart contract auditing is non-negotiable before MainNet deployment. No contract goes live without passing audit.

**Internal Review Process (Before External Audit):**
- Complete developer self-review checklist for each contract
- Peer code review by second senior developer
- Internal security team review focusing on: access control, input validation, economic attack vectors
- Deploy to LocalNet, run all test scenarios including adversarial cases

**External Audit Process:**
- Engage minimum 2 independent audit firms for smart contract review
- Audit firms should have Algorand-specific experience (not only EVM auditors)
- Audit scope: all five core contracts, their interactions, and upgrade mechanism
- Critical focus areas: access control correctness, atomic group validation, whitelist bypass possibilities, clawback mechanism correctness, overflow/underflow edge cases
- Audit timeline: allow 4-6 weeks minimum per audit firm
- Address all HIGH and CRITICAL findings before deployment; document MEDIUM and LOW findings with remediation plan

**Post-Audit Process:**
- All changes made in response to audit are re-reviewed by the same audit firm
- Final audit report published publicly (transparency builds institutional trust)
- Bug bounty program launched after audit (incentivizes ongoing security research)

### Step 12.2 — Matching Engine Testing

The matching engine is the most operationally critical off-chain component.

**Unit Testing:**
Every matching rule (price-time priority, partial fills, IOC/FOK behavior, self-matching prevention) tested with exhaustive case coverage. Target: 95%+ line coverage.

**Simulation Testing:**
Replay historical order data from established exchanges (anonymized) through the matching engine. Verify that output (trade list, order states) is deterministic and consistent with expected price-time priority.

**Adversarial Testing (Chaos Engineering):**
- Message queue failures mid-matching: does the engine recover consistently without duplicate settlements?
- Concurrent identical orders: does matching engine handle race conditions without double-filling?
- Orders at exactly the same price and timestamp: deterministic tiebreaking?
- Very large order books (millions of orders): does matching degrade gracefully under load?

**Load Testing:**
Target throughput: 1,000 orders per second sustained over 30 minutes without memory growth, latency increase, or errors. Load tests run on staging environment sized identically to production.

### Step 12.3 — End-to-End Integration Testing

Define critical user journeys and automate them as integration tests against TestNet:

**Journey 1 — Issuer Lifecycle:** Register → KYB → Create Asset → Launch Market → Place Initial Orders → See Live Orderbook

**Journey 2 — Investor Trading:** Register → KYC → Connect Wallet → Opt-In to Asset → Place Buy Order → Receive Fill → View Updated Portfolio

**Journey 3 — Compliance Flow:** Flag suspicious order → Review in compliance dashboard → Freeze user account → Verify frozen user's orders rejected → Unfreeze → Verify trading restored

**Journey 4 — Settlement Failure Recovery:** Simulate settlement failure → Verify orders returned to book → Verify escrowed funds not lost → Verify retry succeeds

**Journey 5 — Clawback Scenario:** Issue regulatory clawback instruction → Admin multi-sig initiates clawback → Tokens recovered from user → Settlement log updated → User notification sent

### Step 12.4 — Performance Testing

**Orderbook Depth Under Load:**
Simulate 10,000 concurrent users viewing orderbook pages with real-time WebSocket updates. Market data service must sustain this without message queuing delays exceeding 500ms.

**Settlement Throughput:**
Test maximum sustainable settlement rate against Algorand TestNet. Algorand supports approximately 6,000 transactions per second; the practical limit for the Settlement Service should be benchmarked and documented.

**Database Query Performance:**
All queries used in the critical trading path must execute in under 10ms at production data volumes. Load test with 10 million orders in the database.

---

## Phase 13 — Regulatory & Legal Framework {#phase-13}

### Step 13.1 — Legal Structure Assessment

Before operating, ChainStrike must understand its regulatory classification in each jurisdiction it plans to serve. Do this before building — regulatory structure can force architectural changes.

**Key Questions to Answer with Legal Counsel:**
- Is ChainStrike operating as a securities exchange, an alternative trading system (ATS), a multilateral trading facility (MTF), or an unregulated marketplace? This determines license requirements.
- Are the RWA tokens classified as securities, commodity instruments, payment instruments, or utility tokens? This determines issuer obligations.
- Does ChainStrike need to be a licensed VASP (Virtual Asset Service Provider) in its operating jurisdiction?
- What KYC/AML obligations does ChainStrike have as a financial intermediary?
- What data localization requirements apply to user PII in each served jurisdiction?

**Key Jurisdictions to Assess (for MVP):**
- India (SEBI, FIU-IND, proposed DPDP Act): Primary GTM market, active RWA regulatory development
- Singapore (MAS): Crypto-friendly, robust framework under Payment Services Act, active Project Guardian
- UAE (ADGM, VARA): Fast-moving regulatory sandbox, favorable for digital assets
- EU (MiCA, DORA): Comprehensive framework effective 2024-2025, harmonized across member states

### Step 13.2 — Legal Entity Structure

**Recommended Structure:**
- Operating company incorporated in a jurisdiction with clear digital asset regulatory framework (Singapore or UAE recommended)
- Separate compliance entity or compliance function appointed as the regulated entity (if exchange license required)
- Each issued RWA token is associated with an SPV incorporated by the issuer (not by ChainStrike) — ChainStrike provides the platform and infrastructure, not the legal wrapper for the underlying assets
- ChainStrike's legal terms must clearly define: ChainStrike's role as technology and marketplace provider (not asset manager, custodian, or investment advisor), issuer's responsibility for underlying asset, investor's assumption of risk

### Step 13.3 — Regulatory Documentation Package

Prepare before launch:

**For the Platform:**
- AML/CFT Policy: Documented procedures for KYC/KYB, ongoing monitoring, SAR filing, record keeping
- Terms of Service: Comprehensive user agreement covering permitted use, compliance obligations, fee structure, dispute resolution
- Privacy Policy: GDPR/PDPA-compliant data processing disclosure
- Risk Disclosure: Detailed asset-specific risks, platform risks, liquidity risks, regulatory risks
- Issuer Agreement: Legal contract between ChainStrike and each issuer defining responsibilities, warranties, and indemnities
- Investor Agreement: Legal contract between ChainStrike and each investor

**For Each Asset:**
- Offering Document (Information Memorandum): Describes the asset, risks, terms — must be prepared by issuer with legal counsel
- Custody Agreement: Contract between SPV and custodian
- Token Purchase Agreement: Legal framework for investor's rights when they acquire tokens

### Step 13.4 — Travel Rule Compliance

FATF's Travel Rule requires that Virtual Asset Service Providers (VASPs) share originator and beneficiary information for transactions above threshold (generally $1,000 / €1,000 equivalent).

**Architecture for Travel Rule:**
- Integrate with a Travel Rule solution provider (e.g., Notabene, Sygna) that handles VASP-to-VASP information sharing
- For all transfers above threshold: sender VASP (ChainStrike) must transmit KYC data to receiver VASP before transaction executes
- For transfers to non-VASP wallets (unhosted wallets): document additional due diligence per jurisdiction requirements
- Travel Rule data transmitted encrypted through standard protocols (OpenVASP, TRISA, or Notabene's DEF protocol)

### Step 13.5 — Data Protection Compliance

**GDPR / PDPA / DPDP Compliance for User Data:**
- Data minimization: only collect what is required for KYC/AML compliance
- Purpose limitation: KYC data used only for compliance, never for marketing
- Data subject rights: provide investor access to their own data, right to erasure (subject to regulatory retention requirements overriding erasure)
- Data retention schedule: KYC records retained 5 years after account closure (AML regulatory requirement)
- Third-party processor agreements: signed DPAs with Sumsub, Chainalysis, cloud providers
- Cross-border transfer mechanisms: Standard Contractual Clauses or adequacy decisions for data flowing between jurisdictions

---

## Phase 14 — Production Launch & Operations {#phase-14}

### Step 14.1 — Pre-Launch Checklist

Before any user traffic reaches production, every item on this checklist must be confirmed:

**Smart Contracts:**
- All contracts audited by 2 independent firms
- All HIGH/CRITICAL audit findings resolved
- All contracts deployed to MainNet via multi-sig deployment process
- Contract addresses publicly disclosed and verifiable
- Emergency pause mechanism tested

**Infrastructure:**
- Load testing completed; performance targets met
- DDoS protection active
- All secrets rotated and stored in KMS (not in code or config files)
- Backup and recovery procedures tested (full disaster recovery drill)
- Monitoring dashboards live; all critical alerts configured and tested

**Compliance:**
- AML/CFT policy approved by legal counsel
- KYC provider integration live and tested end-to-end
- Sanctions screening verified working (test with known sanctioned entity)
- SAR workflow tested end-to-end
- Compliance audit trail verified

**Legal:**
- Terms of Service and Privacy Policy published
- Issuer Agreement template finalized with legal counsel
- Regulatory filings completed in operating jurisdiction
- Legal entity confirmed as operating entity

**Operations:**
- Incident response runbooks written and team trained
- On-call rotation established
- Bug bounty program launched
- Support desk trained and operational

### Step 14.2 — Phased Rollout Strategy

**Phase A — Closed Beta (Month 1-2)**
- 5-10 manually selected issuers (known relationships, high-quality assets)
- 50-100 manually invited investors (crypto-native, high tolerance for early-platform risk)
- Purpose: validate full flow end-to-end with real users and real assets
- All trades monitored manually in addition to automated monitoring
- Bug fix cycle: daily deployments, rapid response

**Phase B — Limited Open Beta (Month 3-4)**
- Open issuer registration (with standard KYB gate)
- Investor registration open to waiting list
- Cap: 1,000 total investors, 5 active markets
- Focus: Liquidity metrics, spread maintenance, matching engine performance
- Begin market maker recruitment and incentive program

**Phase C — Public Launch (Month 5+)**
- Remove investor cap
- Open to broader issuer onboarding
- Launch marketing campaigns
- Begin institutional investor outreach
- Introduce market-making program with formal agreements

### Step 14.3 — Ongoing Operational Processes

**Daily Operations:**
- Compliance team: review new KYC/KYB applications, process AML flags, check sanctions screening results
- Engineering team: review monitoring dashboards, address any infrastructure alerts
- Market operations: review market health metrics, contact issuers if spread is too wide or depth is thin

**Weekly Operations:**
- Smart contract state audit: verify on-chain state matches off-chain records for whitelist entries, frozen accounts
- Performance review: matching engine latency, settlement success rate, failed order rate
- Compliance review: SAR queue review, KYC expiry queue, issuer re-verification due

**Monthly Operations:**
- Full security review: dependency updates, certificate rotations, access review
- Liquidity report: market depth trend, spread trend, volume trend
- Issuer engagement: quarterly business review with active issuers
- Oracle price accuracy audit: compare oracle prices to external market data

**Annual Operations:**
- Smart contract re-audit (if contracts updated) or annual review even if unchanged
- Full penetration test of platform
- KYB re-verification for all active issuers
- Regulatory reporting submissions (jurisdiction-dependent)
- Insurance policy review and renewal
- Disaster recovery full drill

### Step 14.4 — Scalability Roadmap

As the platform grows, anticipate and plan for these scaling inflection points:

**1,000 concurrent users:** Current architecture sufficient. Monitor Redis memory usage and matching engine queue depth.

**10,000 concurrent users:** Horizontal scaling of Orderbook Service and Market Data Service. Introduce read replicas for database. CDN edge caching for market data.

**100,000 concurrent users:** Sharding matching engine by market (each market gets its own matching engine instance). Kafka partition scaling. Database partitioning by asset ID.

**Multiple blockchains:** When expanding beyond Algorand (Ethereum, Polygon for broader market access), Settlement Service becomes multi-chain aware. Each chain has its own settlement module; compliance and matching layers remain chain-agnostic.

---

## Architecture Summary Diagram (Textual)

```
                         ┌──────────────────────────────────────┐
                         │           USER LAYER                 │
                         │  Issuer Dashboard  |  Investor App   │
                         └──────────┬───────────────┬───────────┘
                                    │               │
                         ┌──────────▼───────────────▼───────────┐
                         │         API GATEWAY + WAF            │
                         │    (Rate Limiting, Auth, TLS)        │
                         └──────────┬───────────────────────────┘
                                    │
             ┌──────────────────────┼────────────────────────────┐
             │                      │                            │
  ┌──────────▼──────┐   ┌───────────▼────────┐   ┌─────────────▼──────┐
  │ IDENTITY SERVICE│   │  ASSET SERVICE     │   │ ORDERBOOK SERVICE  │
  │ KYC/KYB Flows   │   │  Token Management  │   │ Order CRUD         │
  │ Whitelist Mgmt  │   │  ASA Lifecycle     │   │ Market Data        │
  └────────┬────────┘   └────────────────────┘   └────────┬───────────┘
           │                                              │
           ▼                                              ▼
  ┌────────────────┐                          ┌──────────────────────┐
  │COMPLIANCE SVC  │◄─────── Events ─────────►│  MATCHING ENGINE     │
  │ AML Monitoring │                          │  Price-Time Priority │
  │ SAR Workflow   │                          │  Settlement Instruct.│
  │ Rule Enforce.  │                          └──────────┬───────────┘
  └────────────────┘                                     │
                                                         ▼
                                              ┌──────────────────────┐
                                              │  SETTLEMENT SERVICE  │
                                              │  Atomic TX Builder   │
                                              │  KMS Signing         │
                                              └──────────┬───────────┘
                                                         │
                                              ┌──────────▼───────────┐
                                              │   ALGORAND NETWORK   │
                                              │ Whitelist Contract   │
                                              │ Settlement Contract  │
                                              │ Transfer Restriction │
                                              │ Escrow Contract      │
                                              │ Oracle Contract      │
                                              │ RWA ASA Tokens       │
                                              └──────────────────────┘
```

---

*This implementation guide covers the complete build path for ChainStrike from architecture through production operations. Each phase builds on the previous one. No phase should be skipped — particularly the compliance and legal phases, which are load-bearing for the entire platform's legitimacy and legal enforceability.*

*Last updated: 2026-05-14*
