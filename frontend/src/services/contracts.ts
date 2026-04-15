/**
 * Contract Interaction Service
 * Provides real contract interactions with deployed Algorand contracts
 *
 * Positions are reconstructed from confirmed transaction history via Indexer,
 * with localStorage caching for fast loading and persistence.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { CONTRACTS } from "@/config/contracts";
import { getAlgodClient, getIndexerClient } from "@/lib/algorand/client";
import algosdk from "algosdk";
import { ASSETS } from "@/config/contracts";
import type { UserLPPosition, PoolData } from "@/types/pool";

// Get the active network configuration (defaulting to testnet)
const getActiveNetwork = () => "testnet" as const;
const getContracts = () => CONTRACTS[getActiveNetwork()];

// ============================================================================
// Types
// ============================================================================

export interface Position {
  id: string;
  optionId?: number;
  type: "option" | "perp";
  asset: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  liquidationPrice?: number;
  expiryDate?: Date;
  expiry?: number; // Expiry timestamp in UNIX seconds
  strike?: number;
  optionType?: "call" | "put";
  premium?: number;
  quantity?: number;
  timestamp?: number;
  txId?: string;
  status?: "active" | "expired" | "settled";
  isSettled?: boolean;
  settlementPrice?: number;
  settlementPayout?: number;
  settledAt?: number;
}

export interface PoolStats {
  totalLiquidity: number;
  totalVolume24h: number;
  apy: number;
  utilizationRate: number;
  yourDeposit: number;
  yourShare: number;
}

export interface StakingStats {
  totalStaked: number;
  yourStaked: number;
  apr: number;
  rewards: number;
  lockPeriod?: number;
}

export interface OptionData {
  strike: number;
  expiry: Date;
  callPremium: number;
  putPremium: number;
  callDelta: number;
  putDelta: number;
  callOI: number;
  putOI: number;
  callIV: number;
  putIV: number;
}

// ============================================================================
// LocalStorage Cache for Positions
// ============================================================================

const CACHE_KEY_OPTIONS = "chainstrike_option_positions";
const CACHE_KEY_PERPS = "chainstrike_perp_positions";
const CACHE_VERSION = "v2"; // Increment to invalidate old cache
const CACHE_TTL = 30_000; // 30 seconds staleness

interface CachedPositions {
  positions: Position[];
  timestamp: number;
  address: string;
  version?: string;
}

function getCachedPositions(key: string, address: string): Position[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached: CachedPositions = JSON.parse(raw, (k, v) => {
      if (k === "expiryDate" && v) return new Date(v);
      return v;
    });
    // Invalidate cache if address changed or version mismatch
    if (cached.address !== address) return null;
    if (cached.version !== CACHE_VERSION) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL) return null;
    return cached.positions;
  } catch {
    return null;
  }
}

function setCachedPositions(
  key: string,
  address: string,
  positions: Position[],
) {
  if (typeof window === "undefined") return;
  try {
    const data: CachedPositions = {
      positions,
      timestamp: Date.now(),
      address,
      version: CACHE_VERSION,
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable, ignore
  }
}

/**
 * Save a position immediately after a successful trade
 * This ensures the portfolio updates instantly without waiting for Indexer
 */
export function savePendingPosition(position: Position) {
  if (typeof window === "undefined") return;
  try {
    const key =
      position.type === "option"
        ? "chainstrike_pending_options"
        : "chainstrike_pending_perps";
    const raw = localStorage.getItem(key);
    const pending: Position[] = raw
      ? JSON.parse(raw, (k, v) => {
          if (k === "expiryDate" && v) return new Date(v);
          return v;
        })
      : [];
    pending.push(position);
    localStorage.setItem(key, JSON.stringify(pending));
  } catch {
    // ignore
  }
}

function getPendingPositions(type: "option" | "perp"): Position[] {
  if (typeof window === "undefined") return [];
  try {
    const key =
      type === "option"
        ? "chainstrike_pending_options"
        : "chainstrike_pending_perps";
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw, (k, v) => {
      if (k === "expiryDate" && v) return new Date(v);
      return v;
    });
  } catch {
    return [];
  }
}

function clearPendingPositions(
  type: "option" | "perp",
  confirmedTxIds: Set<string>,
) {
  if (typeof window === "undefined") return;
  try {
    const key =
      type === "option"
        ? "chainstrike_pending_options"
        : "chainstrike_pending_perps";
    const pending = getPendingPositions(type);
    const remaining = pending.filter(
      (p) => !p.txId || !confirmedTxIds.has(p.txId),
    );
    if (remaining.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(remaining));
    }
  } catch {
    // ignore
  }
}

/**
 * Decode an arg to a string. Handles both Uint8Array (from SDK) and base64 string (from REST).
 */
function decodeArgToString(arg: Uint8Array | string): string {
  try {
    if (arg instanceof Uint8Array) {
      return new TextDecoder().decode(arg);
    }
    if (typeof arg === "string") {
      return atob(arg);
    }
    return String(arg);
  } catch {
    return String(arg);
  }
}

/**
 * Decode an arg to a uint64 number. Handles both Uint8Array (from SDK) and base64 string (from REST).
 */
function decodeArgToUint64(arg: Uint8Array | string): number {
  try {
    let bytes: Uint8Array;
    if (arg instanceof Uint8Array) {
      bytes = arg;
    } else if (typeof arg === "string") {
      bytes = Uint8Array.from(atob(arg), (c) => c.charCodeAt(0));
    } else {
      return 0;
    }

    if (bytes.length >= 8) {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      return Number(view.getBigUint64(0, false));
    }
    // Smaller values
    let val = 0;
    for (let i = 0; i < bytes.length; i++) {
      val = (val << 8) | bytes[i];
    }
    return val;
  } catch {
    return 0;
  }
}

/**
 * Decode ABI-encoded boolean from app call argument
 * ABI booleans are encoded as single bytes: 0x80 = true, 0x00 = false
 */
function decodeArgToBool(arg: Uint8Array | string): boolean {
  try {
    let bytes: Uint8Array;
    if (arg instanceof Uint8Array) {
      bytes = arg;
    } else if (typeof arg === "string") {
      bytes = Uint8Array.from(atob(arg), (c) => c.charCodeAt(0));
    } else {
      return false;
    }

    // ABI boolean encoding: 0x80 = true, 0x00 = false
    if (bytes.length > 0) {
      return bytes[0] === 0x80;
    }
    return false;
  } catch {
    return false;
  }
}

function decodeArgToBytes(arg: Uint8Array | string): Uint8Array {
  if (arg instanceof Uint8Array) {
    return arg;
  }
  if (typeof arg === "string") {
    return Uint8Array.from(atob(arg), (c) => c.charCodeAt(0));
  }
  return new Uint8Array(0);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const ABI_UINT64_RETURN_PREFIX = new Uint8Array([0x15, 0x1f, 0x7c, 0x75]);
const OPTION_BOX_PREFIX = new TextEncoder().encode("opt_");
const CREATE_OPTION_SELECTORS = new Set(["b7704681", "df6df6fd"]);
const SETTLE_OPTION_SELECTOR = "2a17b262";
const OPTION_INFO_TUPLE_TYPE = algosdk.ABIType.from(
  "(uint64,bool,uint64,uint64,uint64,uint64,uint64,address,uint64,uint64,bool,bool)",
);

function decodeAbiUint64Log(
  logs: Array<string | Uint8Array> | undefined,
): number | null {
  if (!logs || logs.length === 0) {
    return null;
  }

  for (const log of logs) {
    const bytes = decodeArgToBytes(log);
    if (bytes.length < 12) {
      continue;
    }

    let isAbiUint64 = true;
    for (let i = 0; i < ABI_UINT64_RETURN_PREFIX.length; i++) {
      if (bytes[i] !== ABI_UINT64_RETURN_PREFIX[i]) {
        isAbiUint64 = false;
        break;
      }
    }

    if (!isAbiUint64) {
      continue;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Number(view.getBigUint64(4, false));
  }

  return null;
}

type DecodedOptionBox = {
  optionId: number;
  isCall: boolean;
  strikePriceMicroUsd: number;
  expiryTimestamp: number;
  sizeMicroAlgos: number;
  premiumMicroAlgos: number;
  buyer: string;
  creationTime: number;
  settlementPriceMicroUsd: number;
  isExercised: boolean;
  isSettled: boolean;
};

function decodeOptionBox(
  boxName: Uint8Array,
  boxValue: Uint8Array,
): DecodedOptionBox | null {
  if (boxName.length !== 12) {
    return null;
  }

  const hasPrefix = OPTION_BOX_PREFIX.every(
    (byte, index) => boxName[index] === byte,
  );
  if (!hasPrefix) {
    return null;
  }

  try {
    const decoded = OPTION_INFO_TUPLE_TYPE.decode(boxValue) as [
      bigint,
      boolean,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      string,
      bigint,
      bigint,
      boolean,
      boolean,
    ];

    return {
      optionId: Number(decoded[0]),
      isCall: decoded[1],
      strikePriceMicroUsd: Number(decoded[2]),
      expiryTimestamp: Number(decoded[3]),
      sizeMicroAlgos: Number(decoded[4]),
      premiumMicroAlgos: Number(decoded[5]),
      buyer: decoded[7],
      creationTime: Number(decoded[8]),
      settlementPriceMicroUsd: Number(decoded[9]),
      isExercised: decoded[10],
      isSettled: decoded[11],
    };
  } catch {
    return null;
  }
}

function calculateOptionPayoutMicroAlgos(params: {
  isCall: boolean;
  strikePriceMicroUsd: number;
  settlementPriceMicroUsd: number;
  sizeMicroAlgos: number;
}): number {
  const strike = BigInt(Math.max(0, Math.floor(params.strikePriceMicroUsd)));
  const settlement = BigInt(
    Math.max(0, Math.floor(params.settlementPriceMicroUsd)),
  );
  const size = BigInt(Math.max(0, Math.floor(params.sizeMicroAlgos)));

  if (settlement === BigInt(0) || size === BigInt(0)) {
    return 0;
  }

  let payout = BigInt(0);
  if (params.isCall) {
    if (settlement > strike) {
      payout = ((settlement - strike) * size) / settlement;
    }
  } else if (strike > settlement) {
    payout = ((strike - settlement) * size) / strike;
  }

  return Number(payout);
}

/**
 * Compare two group IDs that may be Uint8Array or string
 */
function groupsMatch(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  // Convert both to string for comparison
  const strA =
    a instanceof Uint8Array ? Buffer.from(a).toString("base64") : String(a);
  const strB =
    b instanceof Uint8Array ? Buffer.from(b).toString("base64") : String(b);
  return strA === strB;
}

/**
 * Get a stable string key from a group ID
 */
function groupKey(group: unknown): string {
  if (group instanceof Uint8Array) {
    return Array.from(group)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return String(group);
}

/**
 * Decode state or argument bytes into a string.
 * Supports both base64 strings (Indexer responses) and Uint8Array (Algod SDK responses).
 */
function decodeBytesToString(value: string | Uint8Array): string {
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }

  try {
    return atob(value);
  } catch {
    return value;
  }
}

/**
 * Convert Algorand uint values (number or bigint) to number.
 */
function uintToNumber(value: number | bigint | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }

  return value ?? 0;
}

/**
 * Fetch current ALGO price for P&L calculation
 */
async function fetchCurrentPrice(): Promise<number> {
  try {
    const response = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=ALGOUSDT",
    );
    if (response.ok) {
      const data = await response.json();
      return parseFloat(data.price) || 0;
    }
  } catch {
    // fallback
  }

  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=algorand&vs_currencies=usd",
    );
    if (response.ok) {
      const data = await response.json();
      return data.algorand?.usd || 0;
    }
  } catch {
    // fallback
  }

  return 0.1; // last resort fallback
}

// ============================================================================
// Global State Reader
// ============================================================================

async function readGlobalState(
  appId: number,
): Promise<Record<string, number | string>> {
  if (appId === 0) return {};

  try {
    const algodClient = getAlgodClient();
    const appInfo = await algodClient.getApplicationByID(appId).do();
    const globalState: Record<string, number | string> = {};

    const params = appInfo.params as any;
    const stateArray = (params?.globalState ||
      params?.["global-state"] ||
      []) as Array<{
      key: string | Uint8Array;
      value: {
        type: number;
        bytes?: string | Uint8Array;
        uint?: number | bigint;
      };
    }>;

    for (const item of stateArray) {
      const key = decodeBytesToString(item.key);
      const value = item.value;

      if (value.type === 1) {
        globalState[key] = decodeBytesToString(value.bytes || "");
      } else if (value.type === 2) {
        globalState[key] = uintToNumber(value.uint);
      }
    }

    return globalState;
  } catch (error) {
    console.error(`Error reading global state for app ${appId}:`, error);
    return {};
  }
}

// ============================================================================
// Position Fetching — Transaction-Based Approach
// ============================================================================

/**
 * Get user's option positions by parsing confirmed transactions from Indexer
 */
export async function getOptionPositions(
  userAddress: string,
): Promise<Position[]> {
  const contracts = getContracts();
  if (!userAddress) return [];

  // Check cache first
  const cached = getCachedPositions(CACHE_KEY_OPTIONS, userAddress);
  if (cached) return cached;

  try {
    const indexerClient = getIndexerClient();
    const currentPrice = await fetchCurrentPrice();

    // Search for user's transactions with the options market contract
    const response = (await indexerClient
      .searchForTransactions()
      .address(userAddress)
      .applicationID(contracts.optionsMarket.appId)
      .limit(200)
      .do()) as any;

    const positions: Position[] = [];
    const confirmedTxIds = new Set<string>();
    const processedGroups = new Set<string>();

    // Parse each confirmed transaction
    for (const txn of response.transactions || []) {
      const appTxn =
        txn["application-transaction"] || txn.applicationTransaction;
      if (!appTxn) continue;

      const args = appTxn["application-args"] || appTxn.applicationArgs || [];
      if (args.length === 0) continue;

      const txId = txn.id || txn.txId;
      confirmedTxIds.add(txId);

      // Check if this is a create_option transaction by matching method selector
      // create_option selector: 0xdf6df6fd, legacy buy_option: 0xb7704681
      const selectorBytes = decodeArgToBytes(args[0]);
      const selectorHex = bytesToHex(selectorBytes.slice(0, 4));

      // Skip opt-in transactions (no method args beyond the first)
      if (CREATE_OPTION_SELECTORS.has(selectorHex) && args.length >= 5) {
        // Avoid duplicating for grouped transactions
        const group = txn.group || txn["group"];
        const gKey = group ? groupKey(group) : null;
        if (gKey && processedGroups.has(gKey)) continue;
        if (gKey) processedGroups.add(gKey);

        // Decode args: [method, is_call(bool), strike(uint64), expiry(uint64), quantity(uint64)]
        const isCall = decodeArgToBool(args[1]);
        const strikeRaw = decodeArgToUint64(args[2]);
        const expiryRaw = decodeArgToUint64(args[3]);
        const quantityRaw = decodeArgToUint64(args[4]);

        const strikePrice = strikeRaw / 1_000_000; // Encoded in microUSD (6 decimals)
        const expiryTimestamp = expiryRaw;
        const quantity = quantityRaw / 1_000_000; // Encoded in microALGO (6 decimals)

        // Extract optionId from transaction logs (ABI-encoded uint64 return value)
        const logs = txn.logs || txn["logs"] || [];
        const optionId = decodeAbiUint64Log(logs);

        // Debug logging for optionId extraction
        if (!optionId) {
          console.warn(
            `[getOptionPositions] No optionId decoded from logs for txId: ${txId}`,
            {
              hasLogs: logs.length > 0,
              logCount: logs.length,
            },
          );
        } else {
          console.log(
            `[getOptionPositions] Decoded optionId: ${optionId} from txId: ${txId}`,
          );
        }

        // Find the associated payment transaction (premium) in the same group
        let premiumPaid = 0;
        if (group) {
          // Look for payment txn in the same group from inner txns
          const innerTxns = txn.innerTxns || txn["inner-txns"] || [];
          for (const inner of innerTxns) {
            const payTxn =
              inner["payment-transaction"] || inner.paymentTransaction;
            if (payTxn) {
              premiumPaid = (Number(payTxn.amount) || 0) / 1_000_000;
            }
          }
        }

        // If we couldn't find the payment from inner txns, estimate premium
        if (premiumPaid === 0) {
          const daysToExpiry =
            Math.max(0, expiryTimestamp - Date.now() / 1000) / 86400;
          const timeValue = Math.sqrt(Math.max(daysToExpiry, 0.01) / 365) * 0.1;
          let intrinsicValue = 0;
          if (isCall) {
            intrinsicValue = Math.max(0, currentPrice - strikePrice);
          } else {
            intrinsicValue = Math.max(0, strikePrice - currentPrice);
          }
          premiumPaid = Math.max(
            0.001,
            (intrinsicValue + currentPrice * timeValue) * quantity,
          );
        }

        // Calculate P&L
        let pnl = 0;
        if (isCall) {
          pnl =
            Math.max(0, currentPrice - strikePrice) * quantity - premiumPaid;
        } else {
          pnl =
            Math.max(0, strikePrice - currentPrice) * quantity - premiumPaid;
        }

        const entryPrice = premiumPaid / Math.max(1, quantity);
        const pnlPercent =
          entryPrice > 0 ? (pnl / (entryPrice * quantity)) * 100 : 0;

        // Round timestamp
        const roundTime =
          Number(txn["round-time"] || txn.roundTime) ||
          Math.floor(Date.now() / 1000);

        // Determine if option is expired or settled
        const nowSeconds = Math.floor(Date.now() / 1000);
        const isExpired = expiryTimestamp <= nowSeconds;

        positions.push({
          id: optionId ? `opt-${optionId}` : txId,
          optionId: optionId ?? undefined,
          txId,
          type: "option",
          asset: "ALGO",
          side: "long",
          size: quantity,
          entryPrice,
          currentPrice,
          pnl,
          pnlPercent,
          strike: strikePrice,
          optionType: isCall ? "call" : "put",
          expiryDate: new Date(expiryTimestamp * 1000),
          expiry: expiryTimestamp,
          premium: premiumPaid,
          quantity,
          timestamp: roundTime * 1000,
          status: isExpired ? "expired" : "active",
          isSettled: false,
        });
      }
    }

    // Merge with pending positions (not yet confirmed by indexer)
    const pending = getPendingPositions("option");
    const pendingNotConfirmed = pending.filter(
      (p) => !p.txId || !confirmedTxIds.has(p.txId),
    );

    // Update pending positions with current price and expiry status
    const nowSeconds = Math.floor(Date.now() / 1000);
    for (const p of pendingNotConfirmed) {
      p.currentPrice = currentPrice;
      if (p.optionType === "call") {
        p.pnl =
          Math.max(0, currentPrice - (p.strike || 0)) * (p.quantity || 1) -
          (p.premium || 0);
      } else {
        p.pnl =
          Math.max(0, (p.strike || 0) - currentPrice) * (p.quantity || 1) -
          (p.premium || 0);
      }
      p.pnlPercent =
        (p.premium || 0) > 0 ? (p.pnl / (p.premium || 1)) * 100 : 0;

      // Ensure expiry is set from expiryDate if not present
      if (!p.expiry && p.expiryDate) {
        p.expiry = Math.floor(p.expiryDate.getTime() / 1000);
      }

      // Update status based on expiry
      if (p.expiry && p.expiry <= nowSeconds) {
        p.status = "expired";
      }
    }

    const allPositions = [...positions, ...pendingNotConfirmed];

    // Clear pending that are now confirmed
    clearPendingPositions("option", confirmedTxIds);

    // Cache
    setCachedPositions(CACHE_KEY_OPTIONS, userAddress, allPositions);

    return allPositions;
  } catch (error) {
    console.error("Error fetching option positions:", error);

    // Fall back to pending positions
    const pending = getPendingPositions("option");
    if (pending.length > 0) return pending;

    return [];
  }
}

/**
 * Decode a Position struct from box storage bytes
 * Position struct layout (ARC4 encoding):
 * - position_id: uint64 (8 bytes)
 * - trader: address (32 bytes)
 * - is_long: bool (1 byte)
 * - size: uint64 (8 bytes)
 * - collateral: uint64 (8 bytes)
 * - leverage: uint64 (8 bytes)
 * - entry_price: uint64 (8 bytes)
 * - liquidation_price: uint64 (8 bytes)
 * - last_funding_time: uint64 (8 bytes)
 * - accumulated_funding: uint64 (8 bytes)
 * - open_time: uint64 (8 bytes)
 * - is_open: bool (1 byte)
 * Total: 106 bytes
 */
interface DecodedPosition {
  positionId: number;
  trader: string;
  isLong: boolean;
  size: number; // in microALGO
  collateral: number; // in microALGO
  leverage: number; // scaled by 100
  entryPrice: number; // in microUSD
  liquidationPrice: number; // in microUSD
  lastFundingTime: number;
  accumulatedFunding: number;
  openTime: number;
  isOpen: boolean;
}

function decodePositionFromBox(boxValue: Uint8Array): DecodedPosition | null {
  if (boxValue.length < 106) {
    console.warn("Position box too short:", boxValue.length);
    return null;
  }

  const view = new DataView(
    boxValue.buffer,
    boxValue.byteOffset,
    boxValue.byteLength,
  );
  let offset = 0;

  // position_id: uint64
  const positionId = Number(view.getBigUint64(offset, false));
  offset += 8;

  // trader: address (32 bytes)
  const traderBytes = boxValue.slice(offset, offset + 32);
  const trader = algosdk.encodeAddress(traderBytes);
  offset += 32;

  // is_long: bool (1 byte, 0x80 = true, 0x00 = false for ARC4)
  const isLong = boxValue[offset] === 0x80;
  offset += 1;

  // size: uint64
  const size = Number(view.getBigUint64(offset, false));
  offset += 8;

  // collateral: uint64
  const collateral = Number(view.getBigUint64(offset, false));
  offset += 8;

  // leverage: uint64
  const leverage = Number(view.getBigUint64(offset, false));
  offset += 8;

  // entry_price: uint64
  const entryPrice = Number(view.getBigUint64(offset, false));
  offset += 8;

  // liquidation_price: uint64
  const liquidationPrice = Number(view.getBigUint64(offset, false));
  offset += 8;

  // last_funding_time: uint64
  const lastFundingTime = Number(view.getBigUint64(offset, false));
  offset += 8;

  // accumulated_funding: uint64
  const accumulatedFunding = Number(view.getBigUint64(offset, false));
  offset += 8;

  // open_time: uint64
  const openTime = Number(view.getBigUint64(offset, false));
  offset += 8;

  // is_open: bool
  const isOpen = boxValue[offset] === 0x80;

  return {
    positionId,
    trader,
    isLong,
    size,
    collateral,
    leverage,
    entryPrice,
    liquidationPrice,
    lastFundingTime,
    accumulatedFunding,
    openTime,
    isOpen,
  };
}

/**
 * Get user's perpetual positions by reading from on-chain box storage
 */
export async function getPerpPositions(
  userAddress: string,
): Promise<Position[]> {
  const contracts = getContracts();
  if (!userAddress) return [];

  // Check cache first (short TTL for fresh data)
  const cached = getCachedPositions(CACHE_KEY_PERPS, userAddress);
  if (cached) return cached;

  try {
    const algodClient = getAlgodClient();
    const currentPrice = await fetchCurrentPrice();

    // Get next_position_id from global state to know how many positions exist
    const appInfo = await algodClient
      .getApplicationByID(contracts.perpsMarket.appId)
      .do();
    const globalState = appInfo.params?.globalState || [];

    let nextPositionId = 1;
    for (const item of globalState) {
      const keyBytes =
        typeof item.key === "string"
          ? Uint8Array.from(atob(item.key), (c) => c.charCodeAt(0))
          : new Uint8Array(Object.values(item.key));
      const key = new TextDecoder().decode(keyBytes);
      if (key === "next_position_id") {
        nextPositionId = Number(item.value?.uint || 1);
        break;
      }
    }

    console.log(
      "[getPerpPositions] Scanning positions 1 to",
      nextPositionId - 1,
      "for user",
      userAddress,
    );

    const positions: Position[] = [];

    // Scan all position boxes to find user's positions
    for (let posId = 1; posId < nextPositionId; posId++) {
      try {
        // Build box name: "pos_" + uint64 big-endian
        const boxPrefix = new TextEncoder().encode("pos_");
        const boxIdBytes = new Uint8Array(8);
        new DataView(boxIdBytes.buffer).setBigUint64(0, BigInt(posId), false);
        const boxName = new Uint8Array([...boxPrefix, ...boxIdBytes]);

        // Fetch box content
        const boxResponse = await algodClient
          .getApplicationBoxByName(contracts.perpsMarket.appId, boxName)
          .do();

        const boxValue = boxResponse.value;
        if (!boxValue || boxValue.length === 0) continue;

        const decoded = decodePositionFromBox(boxValue);
        if (!decoded) continue;

        // Check if this position belongs to the user and is still open
        if (decoded.trader.toUpperCase() !== userAddress.toUpperCase())
          continue;
        if (!decoded.isOpen) continue;

        // Convert to Position format
        const entryPriceUsd = decoded.entryPrice / 1_000_000;
        const sizeAlgo = decoded.size / 1_000_000;
        const collateralAlgo = decoded.collateral / 1_000_000;
        const leverageX = decoded.leverage / 100;
        const liquidationPriceUsd = decoded.liquidationPrice / 1_000_000;

        // Calculate PnL
        const priceDiff = currentPrice - entryPriceUsd;
        const pnlMultiplier = decoded.isLong ? 1 : -1;
        const pnl = (priceDiff / entryPriceUsd) * sizeAlgo * pnlMultiplier;
        const pnlPercent = (pnl / collateralAlgo) * 100;

        positions.push({
          id: String(decoded.positionId),
          txId: undefined,
          type: "perp",
          asset: "ALGO",
          side: decoded.isLong ? "long" : "short",
          size: sizeAlgo,
          entryPrice: entryPriceUsd,
          currentPrice,
          pnl,
          pnlPercent,
          liquidationPrice: liquidationPriceUsd,
          timestamp: decoded.openTime * 1000,
        });

        console.log(
          "[getPerpPositions] Found position:",
          decoded.positionId,
          decoded.isLong ? "LONG" : "SHORT",
          sizeAlgo,
          "ALGO",
        );
      } catch (boxError: any) {
        // Box doesn't exist or error reading - skip this position ID
        if (!boxError.message?.includes("box not found")) {
          console.warn(
            `Error reading position box ${posId}:`,
            boxError.message,
          );
        }
      }
    }

    // Also check pending positions (recently created, may not be on-chain yet)
    const pending = getPendingPositions("perp");
    const existingIds = new Set(positions.map((p) => p.id));
    const pendingNotYetOnChain = pending.filter((p) => !existingIds.has(p.id));

    const allPositions = [...positions, ...pendingNotYetOnChain];

    // Cache results
    setCachedPositions(CACHE_KEY_PERPS, userAddress, allPositions);

    console.log(
      "[getPerpPositions] Total positions found:",
      allPositions.length,
    );
    return allPositions;
  } catch (error) {
    console.error("Error fetching perp positions from boxes:", error);
    // Fall back to pending positions
    const pending = getPendingPositions("perp");
    if (pending.length > 0) return pending;
    return [];
  }
}

// ============================================================================
// Pool Stats Helpers
// ============================================================================

/**
 * Get user's LP token balance from their account assets
 */
async function getUserLPTokenBalance(
  userAddress: string,
  lpTokenId: number,
): Promise<number> {
  try {
    const algodClient = getAlgodClient();
    const accountInfo = (await algodClient
      .accountInformation(userAddress)
      .do()) as any;
    const assets = accountInfo.assets || [];

    const lpAsset = assets.find((a: any) => {
      const assetId = a["asset-id"] || a.assetId;
      return Number(assetId) === lpTokenId;
    });

    if (lpAsset) {
      const amount = lpAsset.amount || 0;
      return Number(amount) / 1_000_000; // Convert to decimal (6 decimals)
    }

    return 0;
  } catch (error) {
    console.error("Error fetching LP token balance:", error);
    return 0;
  }
}

/**
 * Read LP position from BoxMap storage
 * Box name format: prefix + user_address_bytes
 */
async function getLPPositionFromBox(
  appId: number,
  userAddress: string,
  boxPrefix: "olp_" | "plp_",
): Promise<{
  shares: number;
  depositedValue: number;
  currentValue: number;
  entryTime: number;
} | null> {
  try {
    const algodClient = getAlgodClient();

    // Construct box name: prefix + address bytes
    const encoder = new TextEncoder();
    const addressBytes = algosdk.decodeAddress(userAddress).publicKey;
    const boxName = new Uint8Array([
      ...encoder.encode(boxPrefix),
      ...addressBytes,
    ]);

    // Read box
    const boxResponse = await algodClient
      .getApplicationBoxByName(appId, boxName)
      .do();
    const boxValue = boxResponse.value;

    // Decode LPPosition struct (4 uint64 values)
    // shares(u64) + deposited_value(u64) + current_value(u64) + entry_time(u64)
    const view = new DataView(
      boxValue.buffer,
      boxValue.byteOffset,
      boxValue.byteLength,
    );

    const shares = Number(view.getBigUint64(0, false)) / 1_000_000; // Convert to decimal
    const depositedValue = Number(view.getBigUint64(8, false)) / 1_000_000;
    const currentValue = Number(view.getBigUint64(16, false)) / 1_000_000;
    const entryTime = Number(view.getBigUint64(24, false));

    return {
      shares,
      depositedValue,
      currentValue,
      entryTime,
    };
  } catch (error) {
    // Box doesn't exist or error reading - user has no position
    return null;
  }
}

/**
 * Calculate share price from pool state
 * share_price = total_liquidity / total_shares
 */
function calculateSharePrice(
  totalLiquidity: number,
  totalShares: number,
): number {
  if (totalShares === 0) return 1.0; // 1:1 for empty pool
  return totalLiquidity / totalShares;
}

// ============================================================================
// Pool Stats
// ============================================================================

export async function getOptionsPoolStats(
  userAddress?: string,
): Promise<PoolData> {
  const contracts = getContracts();
  const assets = ASSETS.testnet;

  try {
    const globalState = await readGlobalState(contracts.optionsPool.appId);

    // Extract global stats
    const totalLiquidity =
      ((globalState.total_liquidity as number) || 0) / 1_000_000;
    const utilizedLiquidity =
      ((globalState.utilized_liquidity as number) || 0) / 1_000_000;
    const totalShares = ((globalState.total_shares as number) || 0) / 1_000_000;
    const totalPremiums =
      ((globalState.total_premiums_earned as number) || 0) / 1_000_000;
    const totalPayouts =
      ((globalState.total_payouts as number) || 0) / 1_000_000;
    const utilizationRate =
      ((globalState.max_utilization as number) || 0) / 100; // basis points to %
    const lpCount = (globalState.lp_count as number) || 0;

    const availableLiquidity = Math.max(0, totalLiquidity - utilizedLiquidity);
    const sharePrice = calculateSharePrice(totalLiquidity, totalShares);

    // Calculate APY (simplified - would use historical data in production)
    const apy =
      totalLiquidity > 0 ? (totalPremiums / totalLiquidity) * 365 * 100 : 0;

    // Try to get user position
    let userPosition: UserLPPosition | null = null;

    if (userAddress) {
      try {
        // Try to read LP token balance
        const lpTokenBalance = await getUserLPTokenBalance(
          userAddress,
          assets.optionsLP.id,
        );

        if (lpTokenBalance > 0) {
          // Try to read position from BoxMap
          const boxPosition = await getLPPositionFromBox(
            contracts.optionsPool.appId,
            userAddress,
            "olp_",
          );

          if (boxPosition) {
            // Use box data
            const earnings =
              boxPosition.currentValue - boxPosition.depositedValue;
            const shareOfPool =
              totalShares > 0 ? (boxPosition.shares / totalShares) * 100 : 0;

            userPosition = {
              shares: boxPosition.shares,
              depositedValue: boxPosition.depositedValue,
              currentValue: boxPosition.currentValue,
              entryTime: boxPosition.entryTime,
              earnings,
              shareOfPool,
            };
          } else {
            // Fallback: calculate from LP token balance
            const currentValue = lpTokenBalance * sharePrice;
            userPosition = {
              shares: lpTokenBalance,
              depositedValue: 0, // Unknown without box data
              currentValue,
              entryTime: 0,
              earnings: 0, // Can't calculate without deposited value
              shareOfPool:
                totalShares > 0 ? (lpTokenBalance / totalShares) * 100 : 0,
            };
          }
        }
      } catch (err) {
        console.error("Error fetching user LP position:", err);
      }
    }

    return {
      totalLiquidity,
      availableLiquidity,
      utilizedLiquidity,
      totalShares,
      sharePrice,
      apy,
      utilizationRate,
      lpCount,
      totalEarnings: totalPremiums,
      totalPayouts,
      userPosition,
    };
  } catch (error) {
    console.error("Error fetching options pool stats:", error);
    return {
      totalLiquidity: 0,
      availableLiquidity: 0,
      utilizedLiquidity: 0,
      totalShares: 0,
      sharePrice: 1.0,
      apy: 0,
      utilizationRate: 0,
      lpCount: 0,
      totalEarnings: 0,
      totalPayouts: 0,
      userPosition: null,
    };
  }
}

export async function getPerpsPoolStats(
  userAddress?: string,
): Promise<PoolData> {
  const contracts = getContracts();
  const assets = ASSETS.testnet;

  try {
    const globalState = await readGlobalState(contracts.perpsPool.appId);

    // Extract global stats
    const totalLiquidity =
      ((globalState.total_liquidity as number) || 0) / 1_000_000;
    const reservedLiquidity =
      ((globalState.reserved_liquidity as number) || 0) / 1_000_000;
    const totalShares = ((globalState.total_shares as number) || 0) / 1_000_000;
    const totalFees =
      ((globalState.total_trading_fees as number) || 0) / 1_000_000;
    const totalPayouts =
      ((globalState.total_payouts as number) || 0) / 1_000_000;
    const maxUtilization =
      ((globalState.max_utilization as number) || 8000) / 100; // basis points to %
    const lpCount = (globalState.lp_count as number) || 0;

    const availableLiquidity = Math.max(0, totalLiquidity - reservedLiquidity);
    const utilizationRate =
      totalLiquidity > 0 ? (reservedLiquidity / totalLiquidity) * 100 : 0;
    const sharePrice = calculateSharePrice(totalLiquidity, totalShares);

    // Calculate APY from fees
    const apy =
      totalLiquidity > 0 ? (totalFees / totalLiquidity) * 365 * 100 : 0;

    // Try to get user position
    let userPosition: UserLPPosition | null = null;

    if (userAddress) {
      try {
        // Try to read LP token balance
        const lpTokenBalance = await getUserLPTokenBalance(
          userAddress,
          assets.perpsLP.id,
        );

        if (lpTokenBalance > 0) {
          // Try to read position from BoxMap
          const boxPosition = await getLPPositionFromBox(
            contracts.perpsPool.appId,
            userAddress,
            "plp_",
          );

          if (boxPosition) {
            // Use box data
            const earnings =
              boxPosition.currentValue - boxPosition.depositedValue;
            const shareOfPool =
              totalShares > 0 ? (boxPosition.shares / totalShares) * 100 : 0;

            userPosition = {
              shares: boxPosition.shares,
              depositedValue: boxPosition.depositedValue,
              currentValue: boxPosition.currentValue,
              entryTime: boxPosition.entryTime,
              earnings,
              shareOfPool,
            };
          } else {
            // Fallback: calculate from LP token balance
            const currentValue = lpTokenBalance * sharePrice;
            userPosition = {
              shares: lpTokenBalance,
              depositedValue: 0,
              currentValue,
              entryTime: 0,
              earnings: 0,
              shareOfPool:
                totalShares > 0 ? (lpTokenBalance / totalShares) * 100 : 0,
            };
          }
        }
      } catch (err) {
        console.error("Error fetching user LP position:", err);
      }
    }

    return {
      totalLiquidity,
      availableLiquidity,
      utilizedLiquidity: reservedLiquidity,
      totalShares,
      sharePrice,
      apy,
      utilizationRate,
      lpCount,
      totalEarnings: totalFees,
      totalPayouts,
      userPosition,
    };
  } catch (error) {
    console.error("Error fetching perps pool stats:", error);
    return {
      totalLiquidity: 0,
      availableLiquidity: 0,
      utilizedLiquidity: 0,
      totalShares: 0,
      sharePrice: 1.0,
      apy: 0,
      utilizationRate: 0,
      lpCount: 0,
      totalEarnings: 0,
      totalPayouts: 0,
      userPosition: null,
    };
  }
}

// ============================================================================
// Staking
// ============================================================================

export async function getStakingStats(
  userAddress?: string,
): Promise<StakingStats> {
  const contracts = getContracts();

  try {
    const globalState = await readGlobalState(contracts.staking.appId);

    let yourStaked = 0;
    let rewards = 0;
    let lockPeriod: number | undefined;

    if (userAddress) {
      try {
        const algodClient = getAlgodClient();
        const accountInfo = (await algodClient
          .accountInformation(userAddress)
          .do()) as any;
        const appsLocalState =
          accountInfo.appsLocalState || accountInfo["apps-local-state"] || [];
        const appLocal = appsLocalState.find(
          (a: any) => (a.id || a["id"]) === contracts.staking.appId,
        );

        if (appLocal) {
          const keyValues = appLocal.keyValue || appLocal["key-value"] || [];
          for (const kv of keyValues) {
            const key = decodeBytesToString(kv.key);
            const uintValue = uintToNumber(kv.value.uint);
            if (key === "staked_amount" || key === "staked") {
              yourStaked = uintValue / 1_000_000;
            }
            if (key === "pending_rewards" || key === "rewards") {
              rewards = uintValue / 1_000_000;
            }
            if (key === "lock_period") {
              lockPeriod = uintValue;
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    return {
      totalStaked: ((globalState.total_staked as number) || 0) / 1_000_000,
      yourStaked,
      apr: (globalState.apr as number) || 0,
      rewards,
      lockPeriod,
    };
  } catch (error) {
    console.error("Error fetching staking stats:", error);
    return { totalStaked: 0, yourStaked: 0, apr: 0, rewards: 0 };
  }
}

// ============================================================================
// Option Chain
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getOptionChain(
  asset: string,
  currentPrice: number,
): Promise<OptionData[]> {
  const contracts = getContracts();

  try {
    const indexerClient = getIndexerClient();

    const response = (await indexerClient
      .searchForTransactions()
      .applicationID(contracts.optionsMarket.appId)
      .limit(1000)
      .do()) as any;

    const optionsMap = new Map<string, OptionData>();

    for (const txn of response.transactions || []) {
      const appTxn =
        txn["application-transaction"] || txn.applicationTransaction;
      if (appTxn?.applicationArgs || appTxn?.["application-args"]) {
        const args = appTxn.applicationArgs || appTxn["application-args"] || [];
        if (args.length > 0) {
          const method = decodeBytesToString(args[0]);
          if (method === "create_option") {
            // Extract option details based on contract's structure
          }
        }
      }
    }

    return Array.from(optionsMap.values());
  } catch (error) {
    console.error("Error fetching option chain:", error);
    return [];
  }
}

// ============================================================================
// Portfolio Summary
// ============================================================================

export async function getPortfolioSummary(userAddress: string) {
  if (!userAddress) {
    return {
      totalValue: 0,
      totalPnL: 0,
      optionPositions: [],
      perpPositions: [],
      poolPositions: [],
      stakingPosition: null,
    };
  }

  try {
    const [optionPositions, perpPositions, optionsPool, perpsPool, staking] =
      await Promise.all([
        getOptionPositions(userAddress),
        getPerpPositions(userAddress),
        getOptionsPoolStats(userAddress),
        getPerpsPoolStats(userAddress),
        getStakingStats(userAddress),
      ]);

    const optionsPoolValue = optionsPool.userPosition?.currentValue || 0;
    const perpsPoolValue = perpsPool.userPosition?.currentValue || 0;

    const totalValue =
      optionPositions.reduce(
        (sum, p) => sum + (p.premium || p.size * p.currentPrice),
        0,
      ) +
      perpPositions.reduce((sum, p) => sum + p.size, 0) +
      optionsPoolValue +
      perpsPoolValue +
      staking.yourStaked;

    const totalPnL =
      optionPositions.reduce((sum, p) => sum + p.pnl, 0) +
      perpPositions.reduce((sum, p) => sum + p.pnl, 0);

    return {
      totalValue,
      totalPnL,
      optionPositions,
      perpPositions,
      poolPositions: [
        {
          type: "Options Pool",
          amount: optionsPoolValue,
          apy: optionsPool.apy,
        },
        { type: "Perps Pool", amount: perpsPoolValue, apy: perpsPool.apy },
      ],
      stakingPosition: staking,
    };
  } catch (error) {
    console.error("Error fetching portfolio summary:", error);
    return {
      totalValue: 0,
      totalPnL: 0,
      optionPositions: [],
      perpPositions: [],
      poolPositions: [],
      stakingPosition: null,
    };
  }
}

// ============================================================================
// Oracle
// ============================================================================

export async function getOraclePrice(): Promise<{
  price: number;
  timestamp: number;
}> {
  const contracts = getContracts();

  try {
    const globalState = await readGlobalState(contracts.oracle.appId);

    return {
      price: (globalState.price as number) || 0,
      timestamp: (globalState.last_update as number) || Date.now(),
    };
  } catch (error) {
    console.error("Error fetching oracle price:", error);
    return { price: 0, timestamp: Date.now() };
  }
}

// ============================================================================
// Quick Options (5-minute expiry)
// ============================================================================

export interface QuickOption {
  id: string;
  isCall: boolean;
  strikePrice: number;
  expiry: number; // Unix timestamp
  size: number; // ALGO
  premium: number; // ALGO
  holder: string;
  isSettled: boolean;
  createdAt: number;
}

export interface QuickOptionResult {
  success: boolean;
  optionId?: string;
  txId?: string;
  premium?: number;
  expiry?: number;
  error?: string;
}

/**
 * Calculate premium for a quick option (5-minute expiry)
 * Uses simplified Black-Scholes approximation
 */
export function calculateQuickOptionPremium(
  isCall: boolean,
  currentPrice: number,
  strikePrice: number,
  sizeAlgo: number,
  volatility: number = 0.8, // 80% default IV
): number {
  const timeToExpiry = 300; // 5 minutes in seconds
  const yearInSeconds = 365 * 24 * 60 * 60;

  // Time factor: sqrt(time / year)
  const timeFactor = Math.sqrt(timeToExpiry / yearInSeconds);

  // Base premium (at-the-money): ~0.4 * spot * volatility * sqrt(time)
  const atmPremium = 0.4 * currentPrice * volatility * timeFactor;

  // Moneyness adjustment
  const moneyness = isCall
    ? (currentPrice - strikePrice) / currentPrice
    : (strikePrice - currentPrice) / strikePrice;

  let premium = atmPremium;

  if (moneyness > 0) {
    // In the money - add intrinsic value
    const intrinsic = Math.abs(currentPrice - strikePrice) * sizeAlgo;
    premium = atmPremium + intrinsic / sizeAlgo;
  } else if (moneyness < -0.5) {
    // Deep out of the money - reduce premium
    premium = atmPremium * 0.25;
  } else if (moneyness < 0) {
    // Out of the money - reduce proportionally
    premium = atmPremium * (1 + moneyness);
  }

  // Minimum premium: 0.5% of size
  const minPremium = currentPrice * 0.005;
  premium = Math.max(premium, minPremium);

  // Total premium for size
  return premium * sizeAlgo;
}

/**
 * Get active quick options for a user
 */
export async function getQuickOptions(
  userAddress: string,
): Promise<QuickOption[]> {
  try {
    const options = await getOptionPositions(userAddress);

    // Filter for quick options (5-minute or less expiry from creation)
    const quickOptions: QuickOption[] = options
      .filter((opt) => {
        const expiryTime = opt.expiryDate?.getTime() || 0;
        const createdAt = opt.timestamp || 0;
        const expiryDuration = (expiryTime - createdAt) / 1000;
        return expiryDuration <= 600; // 10 minutes or less = quick option
      })
      .map((opt) => ({
        id: opt.id,
        isCall: opt.optionType === "call",
        strikePrice: opt.strike || 0,
        expiry: Math.floor((opt.expiryDate?.getTime() || 0) / 1000),
        size: opt.size,
        premium: opt.premium || 0,
        holder: userAddress,
        isSettled: opt.expiryDate
          ? opt.expiryDate.getTime() < Date.now()
          : false,
        createdAt: opt.timestamp || Date.now(),
      }));

    return quickOptions;
  } catch (error) {
    console.error("Error fetching quick options:", error);
    return [];
  }
}

/**
 * Calculate quick option settlement result
 */
export function calculateQuickOptionPayout(
  option: QuickOption,
  settlementPrice: number,
): { payout: number; profit: number; isITM: boolean } {
  let payout = 0;
  let isITM = false;

  if (option.isCall) {
    // Call: profit if price > strike
    if (settlementPrice > option.strikePrice) {
      isITM = true;
      payout =
        ((settlementPrice - option.strikePrice) * option.size) /
        settlementPrice;
    }
  } else {
    // Put: profit if price < strike
    if (settlementPrice < option.strikePrice) {
      isITM = true;
      payout =
        ((option.strikePrice - settlementPrice) * option.size) /
        option.strikePrice;
    }
  }

  const profit = payout - option.premium;

  return { payout, profit, isITM };
}
