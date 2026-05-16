import { api } from './api';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  kycTier: number;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const { data } = await api.post('/auth/login', { email, password });
  const payload = JSON.parse(atob(data.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (['ADMIN', 'COMPLIANCE_OFFICER', 'admin', 'compliance_officer'].includes(payload.role)) {
    throw Object.assign(new Error('ADMIN_ROLE'), { code: 'ADMIN_ROLE' });
  }
  localStorage.setItem('access_token', data.accessToken);
  localStorage.setItem('refresh_token', data.refreshToken);
  return { id: payload.sub, email: payload.email, role: payload.role, kycTier: payload.kycTier ?? 0 };
}

export async function register(
  email: string,
  password: string,
  walletAddress?: string,
): Promise<{ userId: string }> {
  const { data } = await api.post('/auth/register', {
    email,
    password,
    role: 'issuer',
    ...(walletAddress ? { walletAddress } : {}),
  });
  return data;
}

export async function walletChallenge(address: string): Promise<{ nonce: string; expiresAt: number }> {
  const { data } = await api.get('/auth/wallet-challenge', { params: { address } });
  return data;
}

export async function walletLogin(
  address: string,
  nonce: string,
  signature: string,
): Promise<AuthUser> {
  const { data } = await api.post('/auth/wallet-login', { address, nonce, signature });
  localStorage.setItem('access_token', data.accessToken);
  localStorage.setItem('refresh_token', data.refreshToken);
  return data.user;
}

export async function logout() {
  try {
    const refreshToken = localStorage.getItem('refresh_token');
    if (refreshToken) await api.post('/auth/logout', { refreshToken });
  } finally {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = '/login';
  }
}

export function getStoredToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
}

export interface CurrentUser {
  id: string;
  email: string;
  role: string;
  kycTier: number;
}

export function getCurrentUser(): CurrentUser | null {
  const token = getStoredToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return { id: payload.sub, email: payload.email, role: payload.role, kycTier: payload.kycTier ?? 0 };
  } catch {
    return null;
  }
}
