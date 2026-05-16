import type { VerificationStatus, ISO3166Alpha2 } from './common.types';

// ─── Asset Categories ─────────────────────────────────────────────────────────

export type AssetCategory =
  | 'precious_metals'
  | 'real_estate'
  | 'private_debt'
  | 'corporate_bond'
  | 'commodity'
  | 'private_equity';

export type IssuanceEscrowStatus = 'PENDING' | 'RELEASED_TO_VAULT' | 'RETURNED_TO_ISSUER';

export type AssetStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'pre_market'    // ASA created, initial orders being placed
  | 'active'        // live trading
  | 'suspended'
  | 'redemption_open'
  | 'redeemed'
  | 'rejected';

// ─── Asset (RWA Token) ────────────────────────────────────────────────────────

export interface Asset {
  id: string;
  issuerId: string;
  name: string;
  ticker: string;               // e.g. "XGLD"
  category: AssetCategory;
  description: string;
  status: AssetStatus;

  // Algorand on-chain identifiers
  asaId?: number;               // Assigned after ASA creation
  complianceContractId?: number;// Transfer Restriction contract app ID
  settlementContractId?: number;

  // Tokenization parameters
  totalSupply: bigint;
  decimals: number;
  tokenizationRatio: string;    // Human-readable e.g. "1 token = 1 gram gold"
  // Custody
  custodianName: string;
  custodianJurisdiction: ISO3166Alpha2;
  spvEntityName?: string;

  // Metadata
  metadataIpfsCid?: string;
  metadataHash?: string;

  // Compliance
  jurisdictionBlocklist: ISO3166Alpha2[];
  minimumKycTier: number;       // 1, 2, or 3
  accreditedInvestorRequired: boolean;
  lockupDays: number;           // 0 = no lockup

  // Issuance liquidity escrow — on-chain USDC hold during verification pipeline
  issuanceEscrowStatus?: IssuanceEscrowStatus;
  issuanceEscrowAmount?: bigint;
  issuanceEscrowTxId?: string;
  issuanceEscrowReleaseTxId?: string;

  verificationStatus: VerificationStatus;
  listedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Asset Document ───────────────────────────────────────────────────────────

export type AssetDocumentType =
  | 'VAULT_RECEIPT'
  | 'ASSAY_CERTIFICATE'
  | 'INSURANCE_CERTIFICATE'
  | 'PROPERTY_TITLE'
  | 'VALUATION_REPORT'
  | 'SPV_INCORPORATION'
  | 'CUSTODY_AGREEMENT'
  | 'BOND_INDENTURE'
  | 'OFFERING_DOCUMENT'
  | 'AUDIT_REPORT'
  | 'WAREHOUSE_RECEIPT'
  | 'QUALITY_CERTIFICATE'
  | 'LEGAL_OPINION'
  | 'OTHER';

export interface AssetDocument {
  id: string;
  assetId: string;
  type: AssetDocumentType;
  fileName: string;
  storageKey: string;
  documentHash: string;         // SHA-256 — committed to on-chain metadata
  isPublic: boolean;            // Visible to verified investors?
  verifiedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}

// ─── Asset Metadata (IPFS/ARC-3 standard) ────────────────────────────────────

export interface AssetMetadata {
  platform: 'ChainStrike';
  assetId: string;
  asaId: number;
  name: string;
  unitName: string;
  description: string;
  assetCategory: AssetCategory;
  issuer: {
    name: string;
    jurisdictionCode: ISO3166Alpha2;
  };
  custodian: {
    name: string;
    licenseNumber?: string;
    jurisdiction: ISO3166Alpha2;
  };
  tokenizationRatio: string;
  legalDocuments: Array<{ type: string; ipfsCid: string; hash: string }>;
  auditorReports: Array<{ date: string; auditor: string; ipfsCid: string }>;
  platformListingDate: string;
  complianceContractId: number;
  jurisdictionRestrictions: ISO3166Alpha2[];
  investorRequirements: {
    minimumKycTier: number;
    accreditedInvestorRequired: boolean;
  };
}

// ─── Corporate Action ─────────────────────────────────────────────────────────

export type CorporateActionType = 'dividend' | 'coupon_payment' | 'buyback' | 'redemption' | 'announcement';

export interface CorporateAction {
  id: string;
  assetId: string;
  type: CorporateActionType;
  recordDate: Date;
  paymentDate?: Date;
  amountPerToken?: bigint;     // In USDC microunits
  totalAmount?: bigint;
  status: 'announced' | 'processing' | 'completed' | 'cancelled';
  onChainTxId?: string;
  createdAt: Date;
}
