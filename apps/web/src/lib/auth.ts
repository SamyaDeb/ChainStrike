import { api } from './api';

export interface User {
  id: string;
  email: string;
  role: string;
  kycTier: number;
  fullName?: string;
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

export async function register(email: string, password: string, walletAddress?: string): Promise<void> {
  await api.post('/auth/register', {
    email,
    password,
    role: 'investor',
    ...(walletAddress ? { walletAddress } : {}),
  });
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
