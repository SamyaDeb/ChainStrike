"use client";

import { useQuery } from '@tanstack/react-query';
import { useSafeWallet } from '@/hooks/useSafeWallet';
import { getStakingStats } from '@/services/contracts';

export function useStakingStats() {
  const { activeAccount } = useSafeWallet();
  const address = activeAccount?.address;

  return useQuery({
    queryKey: ['staking', address],
    queryFn: async ({ signal }) => {
      if (!address) throw new Error('No wallet connected');

      const controller = new AbortController();
      signal?.addEventListener('abort', () => controller.abort());

      return await getStakingStats(address);
    },
    enabled: !!address,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    retry: 2,
  });
}
