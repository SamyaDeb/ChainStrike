import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  timeout: 10_000,
});

api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Single in-flight refresh shared across concurrent 401s, so parallel requests
// don't each fire a refresh and revoke each other's rotated refresh token.
let refreshPromise: Promise<string> | null = null;

function forceLogin(): void {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  window.location.href = '/login';
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) throw new Error('No refresh token');

  // Bare axios (not the `api` instance) to avoid interceptor recursion.
  const { data } = await axios.post(`${API_URL}/api/v1/auth/refresh`, { refreshToken });

  // Refresh token is rotated server-side — the old one is now revoked, so the
  // new refresh token MUST be persisted or the next refresh will fail.
  localStorage.setItem('access_token', data.accessToken);
  localStorage.setItem('refresh_token', data.refreshToken);
  return data.accessToken as string;
}

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (
      err.response?.status === 401 &&
      typeof window !== 'undefined' &&
      original &&
      !original._retry &&
      localStorage.getItem('refresh_token')
    ) {
      original._retry = true;
      try {
        if (!refreshPromise) {
          refreshPromise = refreshAccessToken().finally(() => {
            refreshPromise = null;
          });
        }
        const newToken = await refreshPromise;
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        forceLogin();
        return Promise.reject(err);
      }
    }

    if (err.response?.status === 401 && typeof window !== 'undefined') {
      forceLogin();
    }
    return Promise.reject(err);
  },
);
