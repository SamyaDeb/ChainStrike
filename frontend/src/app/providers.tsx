"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, type ReactNode } from "react";
import dynamic from "next/dynamic";

// Loading component for wallet initialization
function WalletLoading() {
  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center">
      <div className="text-gray-400 animate-pulse">Initializing...</div>
    </div>
  );
}

// Dynamically import wallet provider - this ensures it only loads on client
const WalletProviderWrapper = dynamic(
  () => import("@/components/wallet-provider").then((mod) => mod.WalletProviderWrapper),
  {
    ssr: false,
    loading: () => <WalletLoading />,
  }
);

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            gcTime: 5 * 60 * 1000,
            refetchInterval: 60 * 1000,
            retry: 2,
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
            refetchOnWindowFocus: false,
            refetchOnMount: true,
            refetchOnReconnect: true,
          },
        },
      })
  );

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Server-side or initial render - show loading
  if (!mounted) {
    return (
      <QueryClientProvider client={queryClient}>
        <WalletLoading />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <WalletProviderWrapper>{children}</WalletProviderWrapper>
    </QueryClientProvider>
  );
}
