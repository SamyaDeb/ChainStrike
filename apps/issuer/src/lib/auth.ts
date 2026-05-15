import { api } from './api';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  kycTier: number;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const { data } = await api.post('/auth/login', { email, password });
  localStorage.setItem('access_token', data.accessToken);
  localStorage.setItem('refresh_token', data.refreshToken);
  return data.user;
}

export async function logout() {
  try {
    await api.post('/auth/logout');
  } finally {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = '/login';
  }
}

export function getStoredToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
}
