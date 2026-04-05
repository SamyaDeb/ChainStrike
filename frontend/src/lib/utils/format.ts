import { formatDistanceToNow, format } from "date-fns";

export function formatNumber(
  value: number,
  options: {
    decimals?: number;
    prefix?: string;
    suffix?: string;
    compact?: boolean;
  } = {}
): string {
  const { decimals = 2, prefix = "", suffix = "", compact = false } = options;

  if (compact) {
    const formatter = new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: decimals,
    });
    return `${prefix}${formatter.format(value)}${suffix}`;
  }

  const formatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return `${prefix}${formatter.format(value)}${suffix}`;
}

export function formatUSD(value: number, decimals = 2): string {
  return formatNumber(value, { prefix: "$", decimals });
}

export function formatALGO(value: number, decimals = 4): string {
  return formatNumber(value, { suffix: " ALGO", decimals });
}

export function formatPercent(value: number, decimals = 2): string {
  return formatNumber(value, { suffix: "%", decimals });
}

export function formatPnL(value: number): string {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${formatUSD(value)}`;
}

export function formatPnLPercent(value: number): string {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${formatPercent(value)}`;
}

export function formatTimeAgo(timestamp: number | Date): string {
  return formatDistanceToNow(timestamp, { addSuffix: true });
}

export function formatDate(timestamp: number | Date, pattern = "MMM dd, yyyy"): string {
  return format(timestamp, pattern);
}

export function formatDateTime(timestamp: number | Date): string {
  return format(timestamp, "MMM dd, yyyy HH:mm");
}

export function microAlgoToAlgo(microAlgo: number | bigint): number {
  return Number(microAlgo) / 1_000_000;
}

export function algoToMicroAlgo(algo: number): bigint {
  return BigInt(Math.floor(algo * 1_000_000));
}

export function microUSDToUSD(microUSD: number | bigint): number {
  return Number(microUSD) / 1_000_000;
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function shortenTxId(txId: string, chars = 8): string {
  if (!txId) return "";
  return `${txId.slice(0, chars)}...${txId.slice(-chars)}`;
}

export function formatLeverage(leverage: number): string {
  return `${(leverage / 100).toFixed(1)}x`;
}

export function formatBasisPoints(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function calculatePercentChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}
