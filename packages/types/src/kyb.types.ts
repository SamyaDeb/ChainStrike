import type { VerificationStatus, ISO3166Alpha2 } from './common.types';

// ─── KYB Entity ──────────────────────────────────────────────────────────────

export type BusinessType =
  | 'private_limited'
  | 'public_limited'
  | 'llc'
  | 'partnership'
  | 'trust'
  | 'fund'
  | 'other';

export interface KybEntity {
  id: string;
  issuerId: string;         // links to User in Identity service
  legalName: string;
  tradingName?: string;
  businessType: BusinessType;
  registrationNumber: string;
  incorporationJurisdiction: ISO3166Alpha2;
  incorporationDate: Date;
  registeredAddress: Address;
  operationalAddress?: Address;
  primaryBusinessActivity: string;
  website?: string;
  status: VerificationStatus;
  riskRating: KybRiskRating;
  sumsubCompanyApplicantId?: string;
  approvedAt?: Date;
  expiresAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: ISO3166Alpha2;
}

export type KybRiskRating = 'low' | 'medium' | 'high';

// ─── KYB Documents ───────────────────────────────────────────────────────────

export type KybDocumentType =
  | 'CERTIFICATE_OF_INCORPORATION'
  | 'ARTICLES_OF_ASSOCIATION'
  | 'SHAREHOLDER_REGISTER'
  | 'PROOF_OF_ADDRESS'
  | 'BANK_STATEMENT'
  | 'AUDITED_FINANCIALS'
  | 'BOARD_RESOLUTION'
  | 'REGULATORY_LICENSE'
  | 'GROUP_STRUCTURE'
  | 'NOTARIZED_AUTHORIZATION'
  | 'OTHER';

export interface KybDocument {
  id: string;
  kybEntityId: string;
  type: KybDocumentType;
  status: VerificationStatus;
  storageKey: string;
  documentHash: string;
  issuedDate?: Date;
  expiresDate?: Date;
  createdAt: Date;
}

// ─── UBO (Ultimate Beneficial Owner) ─────────────────────────────────────────

export interface UboRecord {
  id: string;
  kybEntityId: string;
  fullName: string;
  dateOfBirth: Date;
  nationality: ISO3166Alpha2;
  residenceCountry: ISO3166Alpha2;
  ownershipPercentage: number;        // 0-100
  controlType: UboControlType[];
  isPep: boolean;                      // Politically Exposed Person
  kycStatus: VerificationStatus;       // UBO must also pass individual KYC
  linkedUserId?: string;               // If UBO has a platform account
  createdAt: Date;
  updatedAt: Date;
}

export type UboControlType =
  | 'direct_ownership'
  | 'indirect_ownership'
  | 'voting_rights'
  | 'board_control'
  | 'veto_rights'
  | 'other_control';

// ─── Director / Authorized Signatory ─────────────────────────────────────────

export interface AuthorizedSignatory {
  id: string;
  kybEntityId: string;
  fullName: string;
  title: string;
  role: 'director' | 'authorized_signatory' | 'officer';
  kycStatus: VerificationStatus;
  linkedUserId?: string;
  createdAt: Date;
}
