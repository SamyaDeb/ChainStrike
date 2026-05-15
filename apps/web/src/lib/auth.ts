import { api } from './api';

export interface User {
  id: string;
  email: string;
  role: string;
  kycTier: number;
  fullName?: string;
}

export async function login(email: string, password: string): Promise<User> {
  const { data } = await api.post('/auth/login', { email, password });
  localStorage.setItem('access_token', data.accessToken);
  localStorage.setItem('refresh_token', data.refreshToken);
  return data.user;
}

export async function register(email: string, password: string): Promise<void> {
  await api.post('/auth/register', { email, password, role: 'investor' });
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
