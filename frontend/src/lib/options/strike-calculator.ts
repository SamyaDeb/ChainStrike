/**
 * Strike Calculator - Volatility-Based Strike Price Generation
 * 
 * Generates realistic strike prices based on:
 * - Current asset price
 * - Time to expiry
 * - Implied volatility
 * 
 * Uses industry-standard formula:
 *   Expected Move = Price × IV × √(Time in Years)
 */

/**
 * Calculate expected price movement for a given timeframe
 * 
 * @param currentPrice - Current asset price
 * @param expirySeconds - Time to expiry in seconds
 * @param impliedVolatility - IV as decimal (e.g., 0.80 for 80%)
 * @returns Expected price movement (1 standard deviation)
 */
export function calculateExpectedMove(
  currentPrice: number,
  expirySeconds: number,
  impliedVolatility: number = 0.80 // 80% IV default for crypto
): number {
  // Convert expiry from seconds to years
  const yearsToExpiry = expirySeconds / (365 * 24 * 60 * 60);
  
  // Expected move = Price × IV × √Time
  // This gives us 1 standard deviation (68% confidence interval)
  const expectedMove = currentPrice * impliedVolatility * Math.sqrt(yearsToExpiry);
  
  return expectedMove;
}

/**
 * Calculate appropriate strike step size for a timeframe
 * 
 * @param currentPrice - Current asset price
 * @param expirySeconds - Time to expiry in seconds
 * @param impliedVolatility - IV as decimal
 * @returns Strike step size (distance between strikes)
 */
export function calculateStrikeStep(
  currentPrice: number,
  expirySeconds: number,
  impliedVolatility: number = 0.80
): number {
  const expectedMove = calculateExpectedMove(currentPrice, expirySeconds, impliedVolatility);
  
  // For short-term options (<5 min), use smaller steps for precision
  // For longer-term, we can use wider steps
  let stepMultiplier = 0.5; // Default: 0.5 standard deviations between strikes
  
  if (expirySeconds <= 60) {
    // 1 minute: very tight strikes (0.25 sigma)
    stepMultiplier = 0.25;
  } else if (expirySeconds <= 300) {
    // 5 minutes: tight strikes (0.33 sigma)
    stepMultiplier = 0.33;
  } else if (expirySeconds <= 3600) {
    // 1 hour: moderate strikes (0.5 sigma)
    stepMultiplier = 0.5;
  } else if (expirySeconds <= 86400) {
    // 1 day: wider strikes (0.75 sigma)
    stepMultiplier = 0.75;
  } else {
    // >1 day: widest strikes (1 sigma)
    stepMultiplier = 1.0;
  }
  
  const step = expectedMove * stepMultiplier;
  
  // Ensure minimum step size based on price (avoid dust strikes)
  const minStep = currentPrice * 0.0005; // 0.05% minimum
  
  return Math.max(step, minStep);
}

/**
 * Generate strike prices around current price using volatility-based steps
 * 
 * @param currentPrice - Current asset price
 * @param expirySeconds - Time to expiry in seconds
 * @param count - Number of strikes to generate (should be odd for ATM center)
 * @param impliedVolatility - IV as decimal
 * @returns Array of strike prices sorted ascending
 */
export function generateVolatilityBasedStrikes(
  currentPrice: number,
  expirySeconds: number,
  count: number = 11,
  impliedVolatility: number = 0.80
): number[] {
  const step = calculateStrikeStep(currentPrice, expirySeconds, impliedVolatility);
  
  // Round current price to appropriate precision for the step size
  const precision = getPrecisionForStep(step);
  const atmStrike = roundToStepPrecision(currentPrice, precision);
  
  const strikes: number[] = [];
  const halfCount = Math.floor(count / 2);
  
  // Generate strikes centered around ATM
  for (let i = -halfCount; i <= halfCount; i++) {
    const strike = atmStrike + (i * step);
    strikes.push(roundToStepPrecision(strike, precision));
  }
  
  return strikes.filter(s => s > 0); // Remove any negative strikes
}

/**
 * Get strike multipliers (percentages) for preset buttons based on timeframe
 * 
 * @param expirySeconds - Time to expiry in seconds
 * @param impliedVolatility - IV as decimal
 * @returns Array of multipliers (e.g., [0.998, 0.999, 1.0, 1.001, 1.002])
 */
export function getStrikeMultipliersForTimeframe(
  expirySeconds: number,
  impliedVolatility: number = 0.80
): number[] {
  // Calculate expected move as percentage
  const yearsToExpiry = expirySeconds / (365 * 24 * 60 * 60);
  const expectedMovePercent = impliedVolatility * Math.sqrt(yearsToExpiry);

   // For very short expiries, enforce a practical minimum strike span.
   // This ensures users can select meaningful ITM/OTM strikes even when
   // statistical expected move is extremely small (e.g. 1-minute options).
   let minOneSigma = 0;
   if (expirySeconds <= 60) {
     minOneSigma = 0.05; // +/-5%
   } else if (expirySeconds <= 300) {
     minOneSigma = 0.03; // +/-3%
   } else if (expirySeconds <= 3600) {
     minOneSigma = 0.015; // +/-1.5%
   }
  
  // Generate multipliers at 0.5σ, 1σ intervals
  const sigma1 = Math.max(expectedMovePercent, minOneSigma);
  const sigma05 = sigma1 * 0.5;
  
  // Return 5 strikes: -1σ, -0.5σ, ATM, +0.5σ, +1σ
  return [
    1 - sigma1,      // Deep OTM (for opposite direction)
    1 - sigma05,     // Slight OTM
    1.0,             // ATM
    1 + sigma05,     // Slight OTM
    1 + sigma1,      // Deep OTM
  ].map(m => {
    // Ensure we don't go negative or ridiculously high
    return Math.max(0.5, Math.min(2.0, m));
  });
}

/**
 * Get appropriate price precision based on step size
 * For display purposes - smaller steps need more decimal places
 */
function getPrecisionForStep(step: number): number {
  if (step < 0.0001) return 6;      // $0.000100 → 6 decimals
  if (step < 0.001) return 5;       // $0.00100 → 5 decimals
  if (step < 0.01) return 4;        // $0.0100 → 4 decimals
  if (step < 0.1) return 3;         // $0.100 → 3 decimals
  if (step < 1) return 2;           // $1.00 → 2 decimals
  return 0;                          // $10 → 0 decimals
}

/**
 * Round a number to specific decimal places
 */
function roundToStepPrecision(value: number, decimals: number): number {
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Get descriptive label for a timeframe in seconds
 */
export function getTimeframeLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * Get expected move statistics for a timeframe
 * Useful for displaying to traders
 */
export function getExpectedMoveStats(
  currentPrice: number,
  expirySeconds: number,
  impliedVolatility: number = 0.80
) {
  const expectedMove = calculateExpectedMove(currentPrice, expirySeconds, impliedVolatility);
  const expectedMovePercent = (expectedMove / currentPrice) * 100;
  
  return {
    moveAmount: expectedMove,
    movePercent: expectedMovePercent,
    upperBound: currentPrice + expectedMove,
    lowerBound: currentPrice - expectedMove,
    timeframe: getTimeframeLabel(expirySeconds),
  };
}
