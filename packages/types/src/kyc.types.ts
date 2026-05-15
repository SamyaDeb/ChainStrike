import type { VerificationStatus, ISO3166Alpha2 } from './common.types';
import type { KycTier } from './user.types';

// ─── KYC Profile ─────────────────────────────────────────────────────────────

export interface KycProfile {
  id: string;
  userId: string;
  tier: KycTier;
  status: VerificationStatus;
  riskBand: AmlRiskBand;
  jurisdiction: ISO3166Alpha2;
  sumsubApplicantId?: string;
  sumsubInspectionId?: string;
  approvedAt?: Date;
  expiresAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── KYC Documents ───────────────────────────────────────────────────────────

export type KycDocumentType =
  | 'PASSPORT'
  | 'NATIONAL_ID'
  | 'DRIVERS_LICENSE'
  | 'BANK_STATEMENT'
  | 'UTILITY_BILL'
  | 'SOURCE_OF_FUNDS'
  | 'NET_WORTH_DECLARATION'
  | 'INVESTMENT_ACCOUNT';

export interface KycDocument {
  id: string;
  kycProfileId: string;
  type: KycDocumentType;
  status: VerificationStatus;
  storageKey: string;       // S3 object key (encrypted at rest)
  documentHash: string;     // SHA-256 of document for tamper detection
  expiresAt?: Date;
  reviewedAt?: Date;
  createdAt: Date;
}

// ─── Sumsub Webhook Payload ───────────────────────────────────────────────────

export interface SumsubWebhookPayload {
  applicantId: string;
  inspectionId: string;
  correlationId: string;
  externalUserId: string;   // ChainStrike user ID
  type: SumsubWebhookType;
  reviewStatus: SumsubReviewStatus;
  reviewResult?: SumsubReviewResult;
  createdAtMs: number;
}

export type SumsubWebhookType =
  | 'applicantCreated'
  | 'applicantPending'
  | 'applicantReviewed'
  | 'applicantPersonalInfoChanged'
  | 'applicantDeleted';

export type SumsubReviewStatus = 'init' | 'pending' | 'prechecked' | 'queued' | 'completed' | 'onHold';

export interface SumsubReviewResult {
  reviewAnswer: 'GREEN' | 'RED';
  rejectLabels?: string[];
  reviewRejectType?: 'FINAL' | 'RETRY';
  moderationComment?: string;
  clientComment?: string;
}

// ─── AML / Risk ──────────────────────────────────────────────────────────────

export type AmlRiskBand = 'clean' | 'low' | 'medium' | 'high' | 'severe';

export interface WalletRiskScore {
  address: string;
  riskBand: AmlRiskBand;
  score: number;           // 0-100
  exposures: AmlExposure[];
  lastCheckedAt: Date;
  provider: 'chainalysis' | 'elliptic' | 'trm';
}

export interface AmlExposure {
  category: string;        // e.g. "sanctions", "darknet_market", "theft"
  percentage: number;      // percentage of funds with this exposure
  exposureType: 'direct' | 'indirect';
}

// ─── Sanctions Screening ─────────────────────────────────────────────────────

export interface SanctionsScreeningResult {
  userId: string;
  isMatch: boolean;
  matchedLists: string[];  // e.g. ["OFAC_SDN", "UN_CONSOLIDATED"]
  matchedNames: string[];
  screenerAt: Date;
  requiresReview: boolean;
}
