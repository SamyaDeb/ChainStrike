// ─── Algorand Network Config ──────────────────────────────────────────────────

export type AlgorandNetwork = 'localnet' | 'testnet' | 'mainnet';

export interface AlgorandNodeConfig {
  host: string;
  port: number;
  token: string;
  network: AlgorandNetwork;
}

// ─── ASA Configuration ────────────────────────────────────────────────────────

export interface AsaCreateParams {
  creator: string;          // Creator Algorand address
  total: bigint;            // Total supply in base units
  decimals: number;
  defaultFrozen: boolean;   // MUST be true for RWA tokens
  unitName: string;
  assetName: string;
  url?: string;             // ARC-3 metadata URL (IPFS)
  metadataHash?: Uint8Array;// 32-byte hash
  managerAddress: string;   // Platform admin multi-sig
  reserveAddress: string;   // Issuer/custodian address
  freezeAddress: string;    // Compliance master multi-sig
  clawbackAddress: string;  // Compliance master multi-sig (same as freeze for RWA)
}

export interface AsaInfo {
  asaId: number;
  name: string;
  unitName: string;
  total: bigint;
  decimals: number;
  defaultFrozen: boolean;
  creator: string;
  manager?: string;
  reserve?: string;
  freeze?: string;
  clawback?: string;
  url?: string;
  metadataHash?: string;
}

// ─── Settlement Transaction Group ─────────────────────────────────────────────

export interface SettlementTxGroup {
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  adminAddress: string;      // Admin/custodian account that holds USDC and signs payment txns
  asaId: number;
  tokenAmount: bigint;       // Token base units
  usdcAmount: bigint;        // USDC microunits (6 decimals)
  platformFee: bigint;       // Platform fee in USDC microunits
  treasuryAddress: string;
}

export interface SignedSettlementGroup {
  tradeId: string;
  signedTxns: Uint8Array[];  // Array of signed transaction bytes
  groupId: string;           // Algorand transaction group ID
}

// ─── Contract Application ─────────────────────────────────────────────────────

export interface ContractDeployResult {
  appId: number;
  appAddress: string;
  txId: string;
  confirmedRound: number;
}

// ─── Oracle Price Update ──────────────────────────────────────────────────────

export interface OraclePriceUpdate {
  asaId: number;
  assetId: string;
  price: bigint;             // In USDC microunits
  timestamp: number;         // Unix seconds
  source: string;
  signature: string;         // Oracle service signature
}

// ─── Whitelist Contract Call ──────────────────────────────────────────────────

export interface WhitelistUpdateCall {
  action: 'add' | 'remove';
  walletAddress: string;
  asaId: number;
  kycTier: number;
  expiryTimestamp?: number;  // Unix seconds; 0 = no expiry
}
