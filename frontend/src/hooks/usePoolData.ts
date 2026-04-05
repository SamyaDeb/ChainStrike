import { useState, useEffect, useCallback, useRef } from 'react';
import { getOptionsPoolStats, getPerpsPoolStats } from '@/services/contracts';
import type { PoolData } from '@/types/pool';

interface UsePoolDataResult {
  optionsPool: PoolData | null;
  perpsPool: PoolData | null;
  loading: boolean;
  error: string | null;
  lastUpdate: number;
  refresh: () => Promise<void>;
  onTransactionComplete: () => Promise<void>;
}

const REFRESH_INTERVAL = 5000; // 5 seconds - near real-time updates

export function usePoolData(activeAddress?: string): UsePoolDataResult {
  const [optionsPool, setOptionsPool] = useState<PoolData | null>(null);
  const [perpsPool, setPerpsPool] = useState<PoolData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState(0);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPoolData = useCallback(async () => {
    try {
      setError(null);
      
      const [optionsData, perpsData] = await Promise.all([
        getOptionsPoolStats(activeAddress),
        getPerpsPoolStats(activeAddress),
      ]);

      setOptionsPool(optionsData);
      setPerpsPool(perpsData);
      setLastUpdate(Date.now());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch pool data';
      console.error('Error fetching pool data:', errorMessage);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [activeAddress]);

  // Initial fetch and setup interval
  useEffect(() => {
    setLoading(true);
    fetchPoolData();

    // Setup auto-refresh interval
    intervalRef.current = setInterval(() => {
      fetchPoolData();
    }, REFRESH_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchPoolData]);

  // Manual refresh function
  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchPoolData();
  }, [fetchPoolData]);

  // Callback for immediate refresh after transactions
  const onTransactionComplete = useCallback(async () => {
    // Wait a brief moment for blockchain state to update
    await new Promise(resolve => setTimeout(resolve, 1000));
    await fetchPoolData();
  }, [fetchPoolData]);

  return {
    optionsPool,
    perpsPool,
    loading,
    error,
    lastUpdate,
    refresh,
    onTransactionComplete,
  };
}
