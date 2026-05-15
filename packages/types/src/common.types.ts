// ─── Pagination ──────────────────────────────────────────────────────────────

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── API Response ─────────────────────────────────────────────────────────────

export interface ApiResponse<T = void> {
  success: boolean;
  data?: T;
  error?: ApiError;
  timestamp: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorType: 'system' | 'admin' | 'compliance_officer' | 'issuer' | 'investor';
  actorId: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

// ─── Currency ─────────────────────────────────────────────────────────────────

export type SupportedCurrency = 'USDC' | 'ALGO';

export interface Money {
  amount: bigint;
  currency: SupportedCurrency;
  decimals: number;
}

// ─── Jurisdiction ─────────────────────────────────────────────────────────────

export type ISO3166Alpha2 = string; // Two-letter country code e.g. "IN", "SG", "US"

// ─── Status patterns ─────────────────────────────────────────────────────────

export type VerificationStatus = 'pending' | 'under_review' | 'approved' | 'rejected' | 'expired';

export type ActiveStatus = 'active' | 'suspended' | 'closed';
