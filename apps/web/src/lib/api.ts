import axios from 'axios';

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

// Single-flight refresh so concurrent 401s trigger only one /auth/refresh call.
let refreshPromise: Promise<string> | null = null;

async function runRefresh(): Promise<string> {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) throw new Error('No refresh token');
  // Bare axios call (not `api`) so this request bypasses the interceptors below.
  const { data } = await axios.post(`${API_URL}/api/v1/auth/refresh`, { refreshToken });
  localStorage.setItem('access_token', data.accessToken);
  localStorage.setItem('refresh_token', data.refreshToken);
  return data.accessToken as string;
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (
      err.response?.status === 401 &&
      typeof window !== 'undefined' &&
      original &&
      !original._retry &&
      !String(original.url ?? '').includes('/auth/')
    ) {
      try {
        original._retry = true;
        refreshPromise = refreshPromise ?? runRefresh();
        const newToken = await refreshPromise;
        refreshPromise = null;
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        refreshPromise = null;
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
        return Promise.reject(err);
      }
    }
    if (
      err.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/login') &&
      !window.location.pathname.startsWith('/register')
    ) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      window.location.href = '/login';
      return Promise.reject(err);
    }
    if (err.response?.status === 502 || err.response?.status === 503 || !err.response) {
      const friendly = new Error(
        !err.response
          ? 'Cannot reach the API server. Make sure all backend services are running (run: npm run dev from the project root).'
          : 'Backend service is offline. Run `npm run dev` from the project root to start all services.',
      );
      (friendly as any).isServiceDown = true;
      return Promise.reject(friendly);
    }
    return Promise.reject(err);
  },
);
