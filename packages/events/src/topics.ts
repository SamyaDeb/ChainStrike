// ─────────────────────────────────────────────────────────────────────────────
// Kafka Topic Registry
// Single source of truth for all event topic names.
// Every service imports from here — no magic strings.
// ─────────────────────────────────────────────────────────────────────────────

export const Topics = {
  // KYC events (published by: identity-service)
  KYC_VERIFIED: 'kyc.verified',
  KYC_EXPIRED: 'kyc.expired',
  KYC_REJECTED: 'kyc.rejected',
  KYC_TIER_CHANGED: 'kyc.tier_changed',

  // KYB events (published by: identity-service)
  KYB_APPROVED: 'kyb.approved',
  KYB_REJECTED: 'kyb.rejected',
  KYB_RE_VERIFICATION_DUE: 'kyb.re_verification_due',

  // Asset events (published by: asset-service)
  ASSET_CREATED: 'asset.created',
  ASSET_STATUS_CHANGED: 'asset.status.changed',
  ASSET_METADATA_UPDATED: 'asset.metadata_updated',
  ASSET_SUSPENDED: 'asset.suspended',
  ASSET_LP_TOKENS_READY: 'asset.lp_tokens_ready',

  // Order matching events (published by: matching-engine)
  ORDER_MATCHED: 'order.matched',

  // Settlement events (published by: settlement-service)
  TRADE_SETTLED: 'trade.settled',
  SETTLEMENT_FAILED: 'settlement.failed',
  SETTLEMENT_RETRY: 'settlement.retry',

  // Compliance events (published by: compliance-service)
  WHITELIST_UPDATED: 'compliance.whitelist_updated',
  COMPLIANCE_FLAGGED: 'compliance.flagged',
  COMPLIANCE_CLEARED: 'compliance.cleared',
  ACCOUNT_FROZEN: 'compliance.account.frozen',
  ACCOUNT_UNFROZEN: 'compliance.account_unfrozen',
  ASSET_FROZEN: 'compliance.asset_frozen',
  SAR_FILED: 'compliance.sar_filed',

  // Notification events (consumed by: notification-service)
  NOTIFICATION_EMAIL: 'notification.email',
  NOTIFICATION_INAPP: 'notification.inapp',
} as const;

export type TopicName = (typeof Topics)[keyof typeof Topics];

// ─── Consumer Group IDs ───────────────────────────────────────────────────────

export const ConsumerGroups = {
  COMPLIANCE_KYC: 'compliance-service.kyc-processor',
  COMPLIANCE_ASSET: 'compliance-service.asset-processor',
  COMPLIANCE_TRADE: 'compliance-service.trade-monitor',

  SETTLEMENT_MATCHES: 'settlement-service.match-processor',

  ANALYTICS_ALL: 'analytics-service.event-processor',

  NOTIFICATION_ALL: 'notification-service.event-processor',
} as const;
