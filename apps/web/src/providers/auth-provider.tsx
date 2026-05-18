'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { type User, fetchMe, refreshSession, logout } from '@/lib/auth';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const hasAccess = localStorage.getItem('access_token');
      const hasRefresh = localStorage.getItem('refresh_token');
      if (!hasAccess && !hasRefresh) {
        setUser(null);
        return;
      }
      // /users/me triggers a silent token refresh via the api interceptor if the
      // access token is expired; fall back to an explicit refresh if it's missing.
      if (!hasAccess && hasRefresh) {
        await refreshSession();
      }
      setUser(await fetchMe());
    } catch {
      setUser(null);
    }
  }, []);

  const signOut = useCallback(async () => {
    setUser(null);
    await logout();
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
