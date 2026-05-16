import type { KycTier } from './user.types';
import type { VerificationStatus } from './common.types';
import type { TradeStatus } from './trade.types';
import type { AmlAlertType } from './compliance.types';

// Every event has a shared envelope so consumers can route and log uniformly.

export interface EventEnvelope<T> {
  eventId: string;           // UUID — deduplicate on consumer side
  eventType: string;         // e.g. "kyc.verified"
  source: string;            // e.g. "identity-service"
  version: '1.0';
  timestamp: string;         // ISO 8601
  payload: T;
}

// ─── KYC Events ──────────────────────────────────────────────────────────────

export interface KycVerifiedPayload {
  userId: string;
  walletAddress: string;
  tier: KycTier;
  jurisdiction: string;
  expiresAt: string;
}

export interface KycExpiredPayload {
  userId: string;
  walletAddress: string;
  previousTier: KycTier;
}

export interface KycRejectedPayload {
  userId: string;
  reason: string;
}

// ─── KYB Events ──────────────────────────────────────────────────────────────

export interface KybApprovedPayload {
  issuerId: string;
  kybEntityId: string;
  riskRating: string;
}

export interface KybRejectedPayload {
  issuerId: string;
  reason: string;
}

// ─── Asset Events ─────────────────────────────────────────────────────────────

export interface AssetCreatedPayload {
  assetId: string;
  issuerId: string;
  asaId: number;
  ticker: string;
  complianceContractId: number;
}

export interface AssetStatusChangedPayload {
  assetId: string;
  asaId: number;
  previousStatus: string;
  newStatus: string;
  reason?: string;
}

// ─── Order Events ─────────────────────────────────────────────────────────────

export interface OrderPlacedPayload {
  orderId: string;
  userId: string;
  assetId: string;
  asaId: number;
  side: 'buy' | 'sell' | 'BUY' | 'SELL';
  orderType: 'limit' | 'market' | 'LIMIT' | 'MARKET';
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  price?: string;
  quantity: string;
  walletAddress: string;
}

export interface OrderMatchedPayload {
  tradeId: string;
  buyOrderId: string;
  sellOrderId: string;
  assetId: string;
  asaId: number;
  price: string;
  quantity: string;
  buyerWalletAddress: string;
  sellerWalletAddress: string;
  buyerUserId?: string;
  sellerUserId?: string;
}

export interface OrderCancelledPayload {
  orderId: string;
  userId: string;
  reason: string;
}

// ─── Settlement Events ────────────────────────────────────────────────────────

export interface TradeSettledPayload {
  tradeId: string;
  assetId: string;
  asaId: number;
  buyerUserId: string;
  sellerUserId: string;
  price: string;
  quantity: string;
  onChainTxId: string;
  settledAt: string;
}

export interface SettlementFailedPayload {
  tradeId: string;
  attempt: number;
  reason: string;
}

// ─── Compliance Events ────────────────────────────────────────────────────────

export interface WhitelistUpdatedPayload {
  action: 'added' | 'removed';
  walletAddress: string;
  assetId: string;
  asaId: number;
  userId: string;
  reason?: string;
}

export interface ComplianceFlaggedPayload {
  alertId: string;
  userId?: string;
  walletAddress?: string;
  tradeId?: string;
  alertType: AmlAlertType;
  severity: string;
}

export interface AccountFrozenPayload {
  userId: string;
  walletAddress: string;
  reason: string;
  frozenBy: string;
}
