import { api } from './api';

export interface User {
  id: string;
  email: string;
  role: string;
  kycTier: number;
  fullName?: string | null;
  createdAt?: string | null;
}

function decodeToken(token: string): User {
  const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  return { id: payload.sub, email: payload.email, role: payload.role, kycTier: payload.kycTier ?? 0 };
}

export async function login(email: string, password: string): Promise<User> {
  const { data } = await api.post('/auth/login', { email, password });
  localStorage.setItem('access_token', data.accessToken);
  localStorage.setItem('refresh_token', data.refreshToken);
  return decodeToken(data.accessToken);
}

export type AccountRole = 'investor' | 'issuer';

export async function register(
  email: string,
  password: string,
  walletAddress?: string,
  role: AccountRole = 'investor',
  fullName?: string,
): Promise<void> {
  await api.post('/auth/register', {
    email,
    password,
    role,
    ...(walletAddress ? { walletAddress } : {}),
    ...(fullName ? { fullName } : {}),
  });
}

export async function refreshSession(): Promise<User> {
  const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('refresh_token') : null;
  if (!refreshToken) throw new Error('No refresh token');
  const { data } = await api.post('/auth/refresh', { refreshToken });
  localStorage.setItem('access_token', data.accessToken);
  localStorage.setItem('refresh_token', data.refreshToken);
  return decodeToken(data.accessToken);
}

export async function fetchMe(): Promise<User> {
  const { data } = await api.get('/users/me');
  return {
    id: data.id,
    email: data.email,
    role: data.role,
    kycTier: data.kycProfile?.tier ?? data.kycTier ?? 0,
    fullName: data.fullName,
    createdAt: data.createdAt ?? null,
  };
}

export function canIssue(user: User | null): boolean {
  if (!user) return false;
  const adminRoles = ['admin', 'ADMIN', 'compliance_officer', 'COMPLIANCE_OFFICER'];
  return !adminRoles.includes(user.role);
}

export function isAdmin(user: User | null): boolean {
  if (!user) return false;
  return ['admin', 'ADMIN', 'compliance_officer', 'COMPLIANCE_OFFICER'].includes(user.role);
}

export async function walletChallenge(address: string): Promise<{ nonce: string; expiresAt: number }> {
  const { data } = await api.get('/auth/wallet-challenge', { params: { address } });
  return data;
}

export async function walletLogin(address: string, nonce: string, signature: string): Promise<User> {
  const { data } = await api.post('/auth/wallet-login', { address, nonce, signature });
  localStorage.setItem('access_token', data.accessToken);
  localStorage.setItem('refresh_token', data.refreshToken);
  return decodeToken(data.accessToken);
}

export function getCurrentUser(): User | null {
  const token = getToken();
  if (!token) return null;
  try {
    return decodeToken(token);
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    const refreshToken = localStorage.getItem('refresh_token');
    if (refreshToken) await api.post('/auth/logout', { refreshToken });
  } finally {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = '/login';
  }
}

export function getToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
