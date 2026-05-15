import type { ISO3166Alpha2 } from './common.types';

// ─── Whitelist ────────────────────────────────────────────────────────────────

export interface WhitelistEntry {
  id: string;
  walletAddress: string;
  assetId: string;           // Platform asset ID
  asaId: number;             // Algorand ASA ID
  kycTier: number;
  userId: string;
  isActive: boolean;
  addedAt: Date;
  expiresAt?: Date;
  removedAt?: Date;
  removedReason?: string;
  onChainTxId?: string;      // TX that updated the whitelist contract
}

// ─── Transfer Rules ───────────────────────────────────────────────────────────

export interface TransferRule {
  id: string;
  assetId: string;
  ruleType: TransferRuleType;
  value: string;             // JSON-serialized rule value
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type TransferRuleType =
  | 'jurisdiction_blocklist'
  | 'minimum_kyc_tier'
  | 'lockup_days'
  | 'min_transfer_amount'
  | 'max_transfer_amount'
  | 'max_holding_percentage'
  | 'accredited_only'
  | 'trading_hours'
  | 'transfer_cooldown_hours';

// ─── Pre-Trade Compliance Result ─────────────────────────────────────────────

export interface PreTradeCheckResult {
  approved: boolean;
  failedChecks: ComplianceCheckFailure[];
  checkedAt: Date;
}

export interface ComplianceCheckFailure {
  checkName: string;
  code: string;
  reason: string;
}

// ─── AML Alert ────────────────────────────────────────────────────────────────

export type AmlAlertType =
  | 'structuring'
  | 'rapid_round_trip'
  | 'wash_trading'
  | 'sanctions_match'
  | 'high_risk_wallet'
  | 'unusual_volume'
  | 'jurisdiction_mismatch';

export type AmlAlertStatus = 'open' | 'under_review' | 'cleared' | 'escalated' | 'sar_filed';

export interface AmlAlert {
  id: string;
  userId?: string;
  walletAddress?: string;
  tradeId?: string;
  orderId?: string;
  alertType: AmlAlertType;
  status: AmlAlertStatus;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detectedAt: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  resolution?: string;
}

// ─── SAR (Suspicious Activity Report) ────────────────────────────────────────

export type SarStatus = 'draft' | 'pending_approval' | 'filed' | 'rejected';

export interface SarReport {
  id: string;
  alertId: string;
  status: SarStatus;
  fiuReference?: string;     // FIU acknowledgment number after filing
  filingJurisdiction: ISO3166Alpha2;
  filedAt?: Date;
  filedBy?: string;
  createdAt: Date;
}

// ─── Compliance Event (Immutable audit entry) ─────────────────────────────────

export interface ComplianceEvent {
  id: string;
  eventType: ComplianceEventType;
  subjectType: 'user' | 'wallet' | 'asset' | 'order' | 'trade';
  subjectId: string;
  actorId: string;
  description: string;
  metadata: Record<string, unknown>;
  onChainTxId?: string;
  createdAt: Date;
}

export type ComplianceEventType =
  | 'whitelist_added'
  | 'whitelist_removed'
  | 'account_frozen'
  | 'account_unfrozen'
  | 'asset_frozen'
  | 'asset_unfrozen'
  | 'clawback_executed'
  | 'sar_filed'
  | 'aml_flag_raised'
  | 'aml_flag_cleared'
  | 'order_rejected_compliance'
  | 'sanctions_match_detected'
  | 'kyc_expired'
  | 'kyc_renewed';
