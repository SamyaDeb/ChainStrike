import { api } from './api';

export interface AdminUser {
  id: string;
  email: string;
  role: string;
}

export async function adminLogin(email: string, password: string): Promise<AdminUser> {
  const { data } = await api.post('/auth/login', { email, password });
  // Login response returns { accessToken, refreshToken, expiresIn } — no user object.
  // Decode the JWT payload to get role without a round-trip.
  const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
  if (!['ADMIN', 'COMPLIANCE_OFFICER'].includes(payload.role)) {
    throw new Error('Access denied. Admin credentials required.');
  }
  localStorage.setItem('admin_token', data.accessToken);
  localStorage.setItem('admin_refresh_token', data.refreshToken);
  return { id: payload.sub, email: payload.email, role: payload.role };
}

export function adminLogout() {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_refresh_token');
  window.location.href = '/login';
}

export function getAdminToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
}

export function requireAdmin(): void {
  if (typeof window !== 'undefined' && !localStorage.getItem('admin_token')) {
    window.location.href = '/login';
  }
}
