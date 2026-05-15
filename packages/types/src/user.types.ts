import type { ActiveStatus } from './common.types';

export type UserRole = 'investor' | 'issuer' | 'admin' | 'compliance_officer' | 'market_maker';

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  status: ActiveStatus;
  mfaEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserDto {
  email: string;
  password: string;
  role: UserRole;
}

export interface LoginDto {
  email: string;
  password: string;
  totpCode?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface JwtPayload {
  sub: string;       // user ID
  email: string;
  role: UserRole;
  kycTier: KycTier;
  iat: number;
  exp: number;
}

export type KycTier = 0 | 1 | 2 | 3;
