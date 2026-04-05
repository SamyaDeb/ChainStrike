import { useQuery } from '@tanstack/react-query';
import { fetchPriceData } from '@/services/oracle';

/**
 * Hook for live ALGO price with very fast updates
 */
export function useLivePrice() {
  return useQuery({
    queryKey: ['live-price'],
    queryFn: fetchPriceData,
    staleTime: 2 * 1000,        // 2 seconds - very fresh data
    refetchInterval: 3 * 1000,   // Refetch every 3 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    retry: (failureCount, error) => {
      // Retry up to 3 times with exponential backoff
      if (failureCount < 3) {
        console.warn(`Price fetch attempt ${failureCount + 1} failed:`, error);
        return true;
      }
      return false;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    
    // Keep showing old data while refetching
    placeholderData: (previousData) => previousData,
    
    // Don't throw errors to UI, handle gracefully
    throwOnError: false,
    
    // Meta for debugging
    meta: {
      errorPolicy: 'soft'
    }
  });
}

/**
 * Hook for general price data (less frequent updates)
 */
export function usePrice() {
  return useQuery({
    queryKey: ['price'],
    queryFn: fetchPriceData,
    staleTime: 10 * 1000,       // 10 seconds
    refetchInterval: 15 * 1000,  // Refetch every 15 seconds
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: 2000,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}

/**
 * Hook for price data with manual refresh capability
 */
export function usePriceWithRefresh() {
  const query = useLivePrice();
  
  return {
    ...query,
    refresh: () => query.refetch(),
  };
}
