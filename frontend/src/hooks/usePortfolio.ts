"use client";

import { useQuery } from '@tanstack/react-query';
import { useSafeWallet } from '@/hooks/useSafeWallet';
import {
  getPortfolioSummary,
  getOptionsPoolStats,
  getPerpsPoolStats,
} from '@/services/contracts';

export function usePortfolioData() {
  const { activeAccount } = useSafeWallet();
  const address = activeAccount?.address;

  return useQuery({
    queryKey: ['portfolio', address],
    queryFn: async ({ signal }) => {
      if (!address) throw new Error('No wallet connected');

      const controller = new AbortController();
      signal?.addEventListener('abort', () => controller.abort());

      const [summary, optionsPool, perpsPool] = await Promise.all([
        getPortfolioSummary(address),
        getOptionsPoolStats(address),
        getPerpsPoolStats(address),
      ]);

      return {
        summary,
        optionsPool,
        perpsPool,
      };
    },
    enabled: !!address,
    staleTime: 10 * 1000, // 10 seconds
    refetchInterval: 30 * 1000, // 30 seconds
    retry: 2,
  });
}

export function useOptionsPoolStats() {
  const { activeAccount } = useSafeWallet();
  const address = activeAccount?.address;

  return useQuery({
    queryKey: ['optionsPool', address],
    queryFn: async ({ signal }) => {
      if (!address) throw new Error('No wallet connected');

      const controller = new AbortController();
      signal?.addEventListener('abort', () => controller.abort());

      return await getOptionsPoolStats(address);
    },
    enabled: !!address,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    retry: 2,
  });
}

export function usePerpsPoolStats() {
  const { activeAccount } = useSafeWallet();
  const address = activeAccount?.address;

  return useQuery({
    queryKey: ['perpsPool', address],
    queryFn: async ({ signal }) => {
      if (!address) throw new Error('No wallet connected');

      const controller = new AbortController();
      signal?.addEventListener('abort', () => controller.abort());

      return await getPerpsPoolStats(address);
    },
    enabled: !!address,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    retry: 2,
  });
}
