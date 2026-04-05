/**
 * Utility to clear position cache.
 * This is useful when the cache format changes or after fixing indexer parsing issues.
 */
export function clearPositionCache() {
  if (typeof window === 'undefined') return;
  
  try {
    // Clear all position-related cache
    localStorage.removeItem('chainstrike_option_positions');
    localStorage.removeItem('chainstrike_perp_positions');
    localStorage.removeItem('chainstrike_pending_options');
    localStorage.removeItem('chainstrike_pending_perps');
    
    console.log('[Cache] Position cache cleared successfully');
  } catch (err) {
    console.error('[Cache] Failed to clear position cache:', err);
  }
}

/**
 * Clear cache and reload the page.
 * Useful for forcing a fresh data fetch.
 */
export function clearCacheAndReload() {
  clearPositionCache();
  
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}
