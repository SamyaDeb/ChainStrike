"use client";

import { useCallback, useState } from "react";
import { useSafeWallet } from "@/hooks/useSafeWallet";
import { CONTRACTS, PROTOCOL, ASSETS } from "@/config/contracts";
import {
  makeAppCallTxn,
  makePaymentTxn,
  assignGroupID,
} from "@/lib/algorand/transactions";
import { getAlgodClient, isOptedIntoApp } from "@/lib/algorand/client";
import { savePendingPosition } from "@/services/contracts";
import algosdk from "algosdk";

export type OrderSide = "long" | "short";
export type OptionType = "call" | "put";

export interface TradeResult {
  success: boolean;
  txId?: string;
  optionId?: number;
  settlementPayout?: number;
  error?: string;
}

/**
 * Helper to send signed transactions via algod client
 */
async function sendSignedTransactions(
  signedTxns: (Uint8Array | null)[],
): Promise<{ txId: string }> {
  const algodClient = getAlgodClient();

  // Filter out null entries and send
  const validTxns = signedTxns.filter((txn): txn is Uint8Array => txn !== null);

  if (validTxns.length === 0) {
    throw new Error("No valid signed transactions to send");
  }

  // Send the transactions
  const { txid } = await algodClient.sendRawTransaction(validTxns).do();

  // Wait for confirmation
  await algosdk.waitForConfirmation(algodClient, txid, 4);

  return { txId: txid };
}

function decodeGlobalStateKey(key: Uint8Array | string): string {
  if (key instanceof Uint8Array) {
    return new TextDecoder().decode(key);
  }

  if (typeof key === "string" && typeof atob === "function") {
    try {
      return atob(key);
    } catch {
      return key;
    }
  }

  return String(key);
}

function getGlobalStateUint(
  appInfo: unknown,
  targetKey: string,
): bigint | null {
  if (!appInfo || typeof appInfo !== "object") {
    return null;
  }

  const params = (
    appInfo as {
      params?: {
        globalState?: Array<{
          key: Uint8Array | string;
          value?: { uint?: bigint | number | string };
        }>;
        ["global-state"]?: Array<{
          key: Uint8Array | string;
          value?: { uint?: bigint | number | string };
        }>;
      };
    }
  ).params;
  const state = params?.globalState ?? params?.["global-state"] ?? [];

  for (const entry of state) {
    const decodedKey = decodeGlobalStateKey(entry.key);
    if (decodedKey !== targetKey) {
      continue;
    }

    const uintValue = entry.value?.uint;
    if (typeof uintValue === "bigint") {
      return uintValue;
    }
    if (typeof uintValue === "number") {
      return BigInt(Math.floor(uintValue));
    }
    if (typeof uintValue === "string") {
      return BigInt(uintValue);
    }
    return null;
  }

  return null;
}

function sqrtBigInt(value: bigint): bigint {
  if (value <= BigInt(0)) {
    return BigInt(0);
  }

  let z = value;
  let y = (value + BigInt(1)) / BigInt(2);

  while (y < z) {
    z = y;
    y = (value / y + y) / BigInt(2);
  }

  return z;
}

function calculateContractPremiumMicroAlgos(params: {
  isCall: boolean;
  spotPriceMicroUsd: bigint;
  strikePriceMicroUsd: bigint;
  expiryTimestamp: bigint;
  sizeMicroAlgos: bigint;
  currentTimestamp: bigint;
  impliedVolatilityBp: bigint;
}): bigint {
  const precision = BigInt(1_000_000);
  const yearSeconds = BigInt(31_536_000);

  if (
    params.spotPriceMicroUsd <= BigInt(0) ||
    params.expiryTimestamp <= params.currentTimestamp
  ) {
    return BigInt(0);
  }

  const timeToExpiry = params.expiryTimestamp - params.currentTimestamp;
  const timeFactorInput = (timeToExpiry * BigInt(10_000)) / yearSeconds;
  const timeFactor = sqrtBigInt(timeFactorInput);

  // Time-based IV adjustment - short-term options have higher IV (volatility smile)
  let adjustedIV = params.impliedVolatilityBp;
  if (timeToExpiry <= BigInt(60)) {
    // 1-minute options: double IV (e.g., 80% -> 160%)
    adjustedIV = params.impliedVolatilityBp * BigInt(2);
  } else if (timeToExpiry <= BigInt(300)) {
    // 5-minute options: 1.5x IV (e.g., 80% -> 120%)
    adjustedIV = (params.impliedVolatilityBp * BigInt(3)) / BigInt(2);
  }

  let basePremium =
    (params.spotPriceMicroUsd * adjustedIV * timeFactor * BigInt(4)) /
    BigInt(1_000_000_000);

  console.log(
    "[calculatePremium] Initial base premium:",
    basePremium.toString(),
  );

  if (params.isCall) {
    if (params.strikePriceMicroUsd < params.spotPriceMicroUsd) {
      const intrinsic = params.spotPriceMicroUsd - params.strikePriceMicroUsd;
      const intrinsicAdd =
        (intrinsic * params.sizeMicroAlgos) / params.spotPriceMicroUsd;
      console.log(
        "[calculatePremium] ITM Call intrinsic add:",
        intrinsicAdd.toString(),
      );
      basePremium += intrinsicAdd;
    } else if (params.strikePriceMicroUsd > params.spotPriceMicroUsd) {
      const otmRatio =
        ((params.strikePriceMicroUsd - params.spotPriceMicroUsd) *
          BigInt(10_000)) /
        params.spotPriceMicroUsd;
      if (otmRatio < BigInt(5_000)) {
        basePremium =
          (basePremium * (BigInt(10_000) - otmRatio)) / BigInt(10_000);
      } else {
        basePremium /= BigInt(4);
      }
    }
  } else {
    if (params.strikePriceMicroUsd > params.spotPriceMicroUsd) {
      const intrinsic = params.strikePriceMicroUsd - params.spotPriceMicroUsd;
      const intrinsicAdd =
        (intrinsic * params.sizeMicroAlgos) / params.strikePriceMicroUsd;
      console.log(
        "[calculatePremium] ITM Put intrinsic add:",
        intrinsicAdd.toString(),
      );
      basePremium += intrinsicAdd;
    } else if (params.strikePriceMicroUsd < params.spotPriceMicroUsd) {
      const otmRatio =
        ((params.spotPriceMicroUsd - params.strikePriceMicroUsd) *
          BigInt(10_000)) /
        params.spotPriceMicroUsd;
      if (otmRatio < BigInt(5_000)) {
        basePremium =
          (basePremium * (BigInt(10_000) - otmRatio)) / BigInt(10_000);
      } else {
        basePremium /= BigInt(4);
      }
    }
  }

  console.log(
    "[calculatePremium] Base premium after moneyness:",
    basePremium.toString(),
  );

  let premium = (basePremium * params.sizeMicroAlgos) / precision;

  console.log(
    "[calculatePremium] Premium after size multiply:",
    premium.toString(),
  );

  // Minimum premium - higher for short-term options to prevent dust trades
  const minPremium =
    timeToExpiry <= BigInt(300)
      ? params.sizeMicroAlgos / BigInt(100) // <5 minutes: 1% minimum
      : params.sizeMicroAlgos / BigInt(200); // Longer expiries: 0.5% minimum

  if (premium < minPremium) {
    console.log("[calculatePremium] Using min premium:", minPremium.toString());
    premium = minPremium;
  }

  console.log("[calculatePremium] Final premium:", premium.toString());

  return premium;
}

function encodeUint64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, value, false);
  return bytes;
}

function getOptionBoxName(optionId: bigint): Uint8Array {
  const prefix = new TextEncoder().encode("opt_");
  const idBytes = encodeUint64(optionId);
  return new Uint8Array([...prefix, ...idBytes]);
}

const ABI_UINT64_RETURN_PREFIX = new Uint8Array([0x15, 0x1f, 0x7c, 0x75]);

function decodeBase64Bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function decodeFirstAbiUint64Log(
  logs: Array<string | Uint8Array> | undefined,
): bigint | null {
  if (!logs || logs.length === 0) {
    return null;
  }

  for (const log of logs) {
    const bytes = log instanceof Uint8Array ? log : decodeBase64Bytes(log);
    if (bytes.length < 12) {
      continue;
    }

    let prefixMatches = true;
    for (let i = 0; i < ABI_UINT64_RETURN_PREFIX.length; i++) {
      if (bytes[i] !== ABI_UINT64_RETURN_PREFIX[i]) {
        prefixMatches = false;
        break;
      }
    }

    if (!prefixMatches) {
      continue;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getBigUint64(4, false);
  }

  return null;
}

/**
 * Hook for trading options
 */
export function useOptionsTrading() {
  const { activeAccount, signTransactions } = useSafeWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buyOption = useCallback(
    async (params: {
      optionType: OptionType;
      strike: number; // in microUSD
      expiryTimestamp: number;
      quantity: number; // number of contracts (each contract = 1 ALGO)
      premium: number; // total premium in ALGO
    }): Promise<TradeResult> => {
      if (!activeAccount || !signTransactions) {
        return { success: false, error: "Wallet not connected" };
      }

      const sender = activeAccount.address.toString();

      setIsLoading(true);
      setError(null);

      try {
        const contracts = CONTRACTS.testnet;
        const algodClient = getAlgodClient();

        // Get next option ID from contract global state
        const appInfo = await algodClient
          .getApplicationByID(contracts.optionsMarket.appId)
          .do();
        const nextOptionIdBigInt = getGlobalStateUint(
          appInfo,
          "next_option_id",
        );
        if (nextOptionIdBigInt === null) {
          return {
            success: false,
            error: "Failed to read next_option_id from contract",
          };
        }
        const nextOptionId = nextOptionIdBigInt;

        // Get current price from oracle
        const oracleInfo = await algodClient
          .getApplicationByID(contracts.oracle.appId)
          .do();
        const currentPriceMicroUsd = getGlobalStateUint(
          oracleInfo,
          "current_price",
        );
        if (
          currentPriceMicroUsd === null ||
          currentPriceMicroUsd <= BigInt(0)
        ) {
          return {
            success: false,
            error: "Oracle price not available. Contact administrator.",
          };
        }

        const isCall = params.optionType === "call";
        const sizeMicroAlgos = BigInt(params.quantity * 1_000_000); // Convert contracts to microALGO
        const strikePriceMicroUsd = BigInt(params.strike);
        const nowTimestamp = Math.floor(Date.now() / 1000);

        // Get IV from contract global state
        const ivBigInt = getGlobalStateUint(appInfo, "default_iv");
        const impliedVolatilityBp = ivBigInt ?? BigInt(8000); // 80% default

        // Calculate premium using same logic as contract
        const tradingFeeBp = BigInt(30); // 0.3% - match contract
        const premiumMicroAlgos = calculateContractPremiumMicroAlgos({
          isCall,
          spotPriceMicroUsd: currentPriceMicroUsd, // Use real oracle price
          strikePriceMicroUsd,
          expiryTimestamp: BigInt(params.expiryTimestamp),
          sizeMicroAlgos,
          currentTimestamp: BigInt(nowTimestamp),
          impliedVolatilityBp,
        });

        // Debug logging
        console.log("[buyOption] Premium calculation:", {
          spotPriceMicroUsd: currentPriceMicroUsd.toString(),
          strikePriceMicroUsd: strikePriceMicroUsd.toString(),
          sizeMicroAlgos: sizeMicroAlgos.toString(),
          premiumMicroAlgos: premiumMicroAlgos.toString(),
          premiumAlgo: (Number(premiumMicroAlgos) / 1_000_000).toFixed(6),
          impliedVolatilityBp: impliedVolatilityBp.toString(),
        });

        if (premiumMicroAlgos <= BigInt(0)) {
          return {
            success: false,
            error:
              "Failed to compute premium for this option. Adjust strike/expiry and retry.",
          };
        }

        const tradingFeeMicroAlgos =
          (premiumMicroAlgos * tradingFeeBp) / BigInt(10_000);
        const boxMbrMicroAlgos = BigInt(100_000);
        const priceSafetyBuffer = BigInt(1_000);
        const paymentAmountMicroAlgos =
          premiumMicroAlgos +
          tradingFeeMicroAlgos +
          boxMbrMicroAlgos +
          priceSafetyBuffer;

        // Pre-flight balance check for options
        const accountInfo = await algodClient.accountInformation(sender).do();
        const balance = Number(accountInfo.amount);
        const minBalance = Number(accountInfo.minBalance);
        const availableBalance = balance - minBalance;
        const txFees = 6_000; // ~0.006 ALGO for transaction fees
        const requiredMicroAlgos = Number(paymentAmountMicroAlgos) + txFees;

        if (availableBalance < requiredMicroAlgos) {
          const availableAlgo = (availableBalance / 1_000_000).toFixed(4);
          const requiredAlgo = (requiredMicroAlgos / 1_000_000).toFixed(4);
          return {
            success: false,
            error: `Insufficient available balance. You have ${availableAlgo} ALGO available but need ${requiredAlgo} ALGO (premium + fees). Your account has a high minimum balance requirement.`,
          };
        }

        const suggestedParams = await algodClient.getTransactionParams().do();
        const paymentParams = {
          ...suggestedParams,
          flatFee: true,
          fee: 2000,
        };
        const appCallParams = {
          ...suggestedParams,
          flatFee: true,
          fee: 4000,
        };

        // Transaction 0: Payment for premium + fee to the options market
        // IMPORTANT: Payment MUST be at index 0 (contract checks gtxn.PaymentTransaction(0))
        const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender,
          receiver: contracts.optionsMarket.address.toString(),
          amount: paymentAmountMicroAlgos,
          suggestedParams: paymentParams,
          note: new TextEncoder().encode("option_premium"),
        });

        // Transaction 1: ABI method call for create_option
        // Using proper ABI encoding with ABIMethod
        const createOptionMethod = new algosdk.ABIMethod({
          name: "create_option",
          args: [
            { type: "bool", name: "is_call" },
            { type: "uint64", name: "strike_price" },
            { type: "uint64", name: "expiry" },
            { type: "uint64", name: "size" },
          ],
          returns: { type: "uint64" },
        });

        const boolType = algosdk.ABIType.from("bool");
        const uint64Type = algosdk.ABIType.from("uint64");
        const appArgs = [
          createOptionMethod.getSelector(),
          boolType.encode(isCall),
          uint64Type.encode(strikePriceMicroUsd),
          uint64Type.encode(BigInt(params.expiryTimestamp)),
          uint64Type.encode(sizeMicroAlgos),
        ];

        // Create app call with proper boxes for storing the option
        const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
          sender,
          appIndex: contracts.optionsMarket.appId,
          appArgs,
          foreignApps: [
            contracts.oracle.appId,
            contracts.optionsPool.appId,
            contracts.staking.appId,
          ],
          suggestedParams: appCallParams,
          note: new TextEncoder().encode("ChainStrike:CreateOption"),
          boxes: [
            {
              appIndex: contracts.optionsMarket.appId,
              name: getOptionBoxName(nextOptionId),
            },
          ],
        });

        // Group the transactions
        const txns = [paymentTxn, appCallTxn];
        const groupedTxns = algosdk.assignGroupID(txns);

        // Sign with wallet
        const encodedTxns = groupedTxns.map((txn) =>
          algosdk.encodeUnsignedTransaction(txn),
        );
        const signedTxns = await signTransactions(encodedTxns);

        // Send transactions
        const result = await sendSignedTransactions(signedTxns);

        let optionId: number | undefined;
        try {
          const pendingInfo = (await algodClient
            .pendingTransactionInformation(result.txId)
            .do()) as {
            logs?: Array<string | Uint8Array>;
          };
          const optionIdBigInt = decodeFirstAbiUint64Log(pendingInfo.logs);
          if (optionIdBigInt !== null) {
            optionId = Number(optionIdBigInt);
          }
        } catch {
          // Ignore log parsing failure; indexer will populate confirmed position shortly
        }

        // Save position immediately for instant portfolio update
        savePendingPosition({
          id: optionId ? `opt-${optionId}` : result.txId,
          txId: result.txId,
          type: "option",
          asset: "ALGO",
          side: "long",
          size: params.quantity / 1_000_000, // Convert back to ALGO
          entryPrice:
            Number(premiumMicroAlgos) /
            1_000_000 /
            (params.quantity / 1_000_000),
          currentPrice: params.strike / 1_000_000, // Convert microUSD to USD
          pnl: 0,
          pnlPercent: 0,
          strike: params.strike / 1_000_000, // Convert to USD
          optionType: params.optionType,
          expiryDate: new Date(params.expiryTimestamp * 1000),
          premium: Number(premiumMicroAlgos) / 1_000_000,
          quantity: params.quantity / 1_000_000,
          optionId,
          isSettled: false,
          status: "active",
          timestamp: Date.now(),
        });

        // Clear cache to force refresh
        if (typeof window !== "undefined") {
          localStorage.removeItem("chainstrike_option_positions");
        }

        return {
          success: true,
          txId: result.txId,
          optionId,
        };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Transaction failed";
        setError(errorMessage);
        return { success: false, error: errorMessage };
      } finally {
        setIsLoading(false);
      }
    },
    [activeAccount, signTransactions],
  );

  const settleOption = useCallback(
    async (optionId: number): Promise<TradeResult> => {
      if (!activeAccount || !signTransactions) {
        return { success: false, error: "Wallet not connected" };
      }

      if (!Number.isFinite(optionId) || optionId <= 0) {
        return { success: false, error: "Invalid option ID" };
      }

      setIsLoading(true);
      setError(null);

      try {
        const contracts = CONTRACTS.testnet;
        const algodClient = getAlgodClient();
        const sender = activeAccount.address.toString();

        const suggestedParams = await algodClient.getTransactionParams().do();
        const settleParams = {
          ...suggestedParams,
          flatFee: true,
          fee: 5000,
        };

        const settleMethod = new algosdk.ABIMethod({
          name: "settle_option",
          args: [{ type: "uint64", name: "option_id" }],
          returns: { type: "uint64" },
        });

        const uint64Type = algosdk.ABIType.from("uint64");
        const appArgs = [
          settleMethod.getSelector(),
          uint64Type.encode(BigInt(optionId)),
        ];

        const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
          sender,
          appIndex: contracts.optionsMarket.appId,
          appArgs,
          accounts: [
            contracts.optionsPool.address.toString(),
            contracts.staking.address.toString(),
            sender,
          ],
          foreignApps: [
            contracts.optionsPool.appId,
            contracts.oracle.appId,
            contracts.staking.appId,
          ],
          suggestedParams: settleParams,
          note: new TextEncoder().encode("ChainStrike:SettleOption"),
          boxes: [
            {
              appIndex: contracts.optionsMarket.appId,
              name: getOptionBoxName(BigInt(optionId)),
            },
          ],
        });

        const encodedTxn = algosdk.encodeUnsignedTransaction(appCallTxn);
        const signedTxns = await signTransactions([encodedTxn]);
        const result = await sendSignedTransactions(signedTxns);

        let settlementPayout: number | undefined;
        try {
          const pendingInfo = (await algodClient
            .pendingTransactionInformation(result.txId)
            .do()) as {
            logs?: Array<string | Uint8Array>;
          };
          const payoutMicroAlgos = decodeFirstAbiUint64Log(pendingInfo.logs);
          if (payoutMicroAlgos !== null) {
            settlementPayout = Number(payoutMicroAlgos) / 1_000_000;
          }
        } catch {
          // Ignore payout parsing failures; UI can recompute from on-chain position state
        }

        if (typeof window !== "undefined") {
          localStorage.removeItem("chainstrike_option_positions");
        }

        return {
          success: true,
          txId: result.txId,
          settlementPayout,
        };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Settlement transaction failed";
        setError(errorMessage);
        return { success: false, error: errorMessage };
      } finally {
        setIsLoading(false);
      }
    },
    [activeAccount, signTransactions],
  );

  return { buyOption, settleOption, isLoading, error };
}

/**
 * Hook for trading perpetuals
 */
export function usePerpsTrading() {
  const { activeAccount, signTransactions } = useSafeWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPosition = useCallback(
    async (params: {
      side: OrderSide;
      margin: number; // in ALGO
      leverage: number; // 1-20
    }): Promise<TradeResult> => {
      if (!activeAccount || !signTransactions) {
        return { success: false, error: "Wallet not connected" };
      }

      // Validate leverage
      if (params.leverage < 1 || params.leverage > 20) {
        return { success: false, error: "Leverage must be between 1x and 20x" };
      }

      setIsLoading(true);
      setError(null);

      try {
        const contracts = CONTRACTS.testnet;
        const algodClient = getAlgodClient();
        const sender = activeAccount.address.toString();

        // Pre-flight balance check - ensure user has enough available ALGO
        const accountInfo = await algodClient.accountInformation(sender).do();
        const balance = Number(accountInfo.amount);
        const minBalance = Number(accountInfo.minBalance);
        const availableBalance = balance - minBalance;

        // Required: margin + box MBR (0.05 ALGO) + transaction fees (~0.003 ALGO)
        const BOX_MBR = 50_000; // 0.05 ALGO
        const TX_FEES = 6_000; // ~0.006 ALGO for 2 txns with higher fees
        const requiredMicroAlgos =
          Math.floor(params.margin * 1_000_000) + BOX_MBR + TX_FEES;

        if (availableBalance < requiredMicroAlgos) {
          const availableAlgo = (availableBalance / 1_000_000).toFixed(4);
          const requiredAlgo = (requiredMicroAlgos / 1_000_000).toFixed(4);
          return {
            success: false,
            error: `Insufficient available balance. You have ${availableAlgo} ALGO available but need ${requiredAlgo} ALGO (margin + fees). Your account has a high minimum balance requirement.`,
          };
        }

        // Note: ARC4Contract doesn't require opt-in - positions are stored in boxes
        // Remove opt-in check as it will fail and is not needed

        const txns: algosdk.Transaction[] = [];

        // Get next position ID from contract state for box reference
        // We need to include the box that will be created for this position
        const appInfo = await algodClient
          .getApplicationByID(contracts.perpsMarket.appId)
          .do();
        const globalState = appInfo.params?.globalState || [];
        let nextPositionId = 1;
        for (const item of globalState) {
          // Decode base64 key - handle both string and Uint8Array types
          const keyStr =
            typeof item.key === "string"
              ? item.key
              : Buffer.from(item.key).toString("base64");
          const keyBytes = Uint8Array.from(atob(keyStr), (c) =>
            c.charCodeAt(0),
          );
          const key = new TextDecoder().decode(keyBytes);
          if (key === "next_position_id") {
            nextPositionId = Number(item.value?.uint || 1);
            break;
          }
        }

        // Transaction 0: Payment for margin to the perps MARKET (not pool!)
        // Contract checks: gtxn.PaymentTransaction(0).receiver == Global.current_application_address
        //
        // IMPORTANT: Payment must include BOTH:
        // 1. Margin amount (user's collateral)
        // 2. Box MBR for position storage (~0.05 ALGO)
        //
        // Box MBR calculation: 2500 + 400 * (key_size + value_size)
        // key_size = 4 ("pos_") + 8 (uint64) = 12 bytes
        // value_size = 106 bytes (Position struct)
        // MBR = 2500 + 400 * 118 = 49,700 microALGO
        // Using 50,000 (0.05 ALGO) with small buffer
        const POSITION_BOX_MBR = BigInt(50_000); // 0.05 ALGO for box storage

        const marginMicroAlgos = BigInt(Math.floor(params.margin * 1_000_000));
        const totalPayment = marginMicroAlgos + POSITION_BOX_MBR; // margin + box storage MBR

        const paymentTxn = await makePaymentTxn(
          sender,
          contracts.perpsMarket.address.toString(),
          totalPayment,
          new TextEncoder().encode("perp_margin"),
        );
        txns.push(paymentTxn);

        // Transaction 1: Application call to open position with proper ABI encoding
        // Method: open_position(bool,uint64,uint64)uint64
        // Selector: 0x7029d97a
        const methodSelector = new Uint8Array([0x70, 0x29, 0xd9, 0x7a]);

        // Arg 1: is_long (ARC4 bool: 0x80 for true, 0x00 for false)
        const isLong = params.side === "long";
        const isLongArg = new Uint8Array([isLong ? 0x80 : 0x00]);

        // Arg 2: size (position size in microALGO = margin * leverage)
        const positionSize = BigInt(
          Math.floor(params.margin * params.leverage * 1_000_000),
        );
        const sizeArg = new Uint8Array(8);
        new DataView(sizeArg.buffer).setBigUint64(0, positionSize, false);

        // Arg 3: leverage (scaled by 100: 5x = 500)
        const leverageArg = new Uint8Array(8);
        new DataView(leverageArg.buffer).setBigUint64(
          0,
          BigInt(params.leverage * PROTOCOL.LEVERAGE_SCALE),
          false,
        );

        // Build box reference for the new position: "pos_" + position_id (as uint64 big-endian)
        const boxPrefix = new TextEncoder().encode("pos_");
        const boxIdBytes = new Uint8Array(8);
        new DataView(boxIdBytes.buffer).setBigUint64(
          0,
          BigInt(nextPositionId),
          false,
        );
        const boxName = new Uint8Array([...boxPrefix, ...boxIdBytes]);

        const appCallTxn = await makeAppCallTxn(
          sender,
          contracts.perpsMarket.appId,
          [methodSelector, isLongArg, sizeArg, leverageArg],
          // accounts - pool for margin transfer, staking for fee routing inner txn
          [
            contracts.perpsPool.address.toString(),
            contracts.staking.address.toString(),
          ],
          [
            contracts.oracle.appId,
            contracts.perpsPool.appId,
            contracts.staking.appId,
          ],
          undefined,
          new TextEncoder().encode("ChainStrike:OpenPerp"),
          [{ appIndex: contracts.perpsMarket.appId, name: boxName }],
        );
        txns.push(appCallTxn);

        // Group the transactions
        const groupedTxns = assignGroupID(txns);

        // Sign with wallet
        const encodedTxns = groupedTxns.map((txn) =>
          algosdk.encodeUnsignedTransaction(txn),
        );
        const signedTxns = await signTransactions(encodedTxns);

        // Send transactions
        const result = await sendSignedTransactions(signedTxns);

        // Save position immediately for instant portfolio update
        savePendingPosition({
          id: result.txId,
          txId: result.txId,
          type: "perp",
          asset: "ALGO",
          side: params.side,
          size: params.margin,
          entryPrice: 0, // will be populated by current price
          currentPrice: 0,
          pnl: 0,
          pnlPercent: 0,
          timestamp: Date.now(),
        });

        // Clear cache to force refresh
        if (typeof window !== "undefined") {
          localStorage.removeItem("chainstrike_perp_positions");
          // Dispatch event to notify positions panel to refresh
          window.dispatchEvent(new CustomEvent("chainstrike:position-update"));
        }

        return {
          success: true,
          txId: result.txId,
        };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Transaction failed";
        setError(errorMessage);
        return { success: false, error: errorMessage };
      } finally {
        setIsLoading(false);
      }
    },
    [activeAccount, signTransactions],
  );

  const closePosition = useCallback(
    async (positionId: string): Promise<TradeResult> => {
      if (!activeAccount || !signTransactions) {
        return { success: false, error: "Wallet not connected" };
      }

      setIsLoading(true);
      setError(null);

      try {
        const contracts = CONTRACTS.testnet;
        const algodClient = getAlgodClient();
        const sender = activeAccount.address.toString();

        // Parse position ID as number
        const positionIdNum = parseInt(positionId, 10);
        if (!Number.isFinite(positionIdNum) || positionIdNum <= 0) {
          return { success: false, error: "Invalid position ID" };
        }

        // Method: close_position(uint64)uint64
        // Selector: 0x956e7e8f
        const methodSelector = new Uint8Array([0x95, 0x6e, 0x7e, 0x8f]);

        // Arg 1: position_id (uint64, 8 bytes big-endian)
        const positionIdArg = new Uint8Array(8);
        new DataView(positionIdArg.buffer).setBigUint64(
          0,
          BigInt(positionIdNum),
          false,
        );

        // Box reference for position storage: "pos_" + position_id (as uint64)
        const boxPrefix = new TextEncoder().encode("pos_");
        const boxIdBytes = new Uint8Array(8);
        new DataView(boxIdBytes.buffer).setBigUint64(
          0,
          BigInt(positionIdNum),
          false,
        );
        const boxName = new Uint8Array([...boxPrefix, ...boxIdBytes]);

        const appCallTxn = await makeAppCallTxn(
          sender,
          contracts.perpsMarket.appId,
          [methodSelector, positionIdArg],
          [contracts.perpsPool.address.toString()], // accounts - pool receives PnL transfers
          [contracts.oracle.appId, contracts.perpsPool.appId],
          undefined,
          new TextEncoder().encode("ChainStrike:ClosePerp"),
          [{ appIndex: contracts.perpsMarket.appId, name: boxName }],
        );

        const encodedTxn = algosdk.encodeUnsignedTransaction(appCallTxn);
        const signedTxns = await signTransactions([encodedTxn]);
        const result = await sendSignedTransactions(signedTxns);

        return { success: true, txId: result.txId };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Transaction failed";
        setError(errorMessage);
        return { success: false, error: errorMessage };
      } finally {
        setIsLoading(false);
      }
    },
    [activeAccount, signTransactions],
  );

  return { openPosition, closePosition, isLoading, error };
}

/**
 * Hook for liquidity pool operations
 */
export function usePoolOperations() {
  const { activeAccount, signTransactions } = useSafeWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deposit = useCallback(
    async (params: {
      pool: "options" | "perps";
      amount: number; // in ALGO
    }): Promise<TradeResult> => {
      if (!activeAccount || !signTransactions) {
        return { success: false, error: "Wallet not connected" };
      }

      setIsLoading(true);
      setError(null);

      try {
        const contracts = CONTRACTS.testnet;
        const assets = ASSETS.testnet;
        const poolContract =
          params.pool === "options"
            ? contracts.optionsPool
            : contracts.perpsPool;
        const lpTokenId =
          params.pool === "options" ? assets.optionsLP.id : assets.perpsLP.id;
        const algodClient = getAlgodClient();
        const sender = activeAccount.address.toString();

        // Check if user is opted in to LP token ASA
        const accountInfo = await algodClient.accountInformation(sender).do();
        const isOptedInToLP =
          accountInfo.assets?.some(
            (asset: { assetId: bigint }) => Number(asset.assetId) === lpTokenId,
          ) ?? false;

        const txns: algosdk.Transaction[] = [];
        const suggestedParams = await algodClient.getTransactionParams().do();

        // If not opted in to LP token, add opt-in transaction
        if (!isOptedInToLP) {
          const optInTxn =
            algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
              sender,
              receiver: sender,
              assetIndex: lpTokenId,
              amount: 0,
              suggestedParams,
            });
          txns.push(optInTxn);
        }

        // Payment to pool
        const amountMicroAlgos = BigInt(Math.floor(params.amount * 1_000_000));
        const paymentTxn = await makePaymentTxn(
          sender,
          poolContract.address.toString(),
          amountMicroAlgos,
          new TextEncoder().encode("pool_deposit"),
        );
        txns.push(paymentTxn);

        // Deposit call with proper ABI method selector
        // Method selector for "deposit()uint64" is 0xb8843568
        const methodSelector = new Uint8Array([0xb8, 0x84, 0x35, 0x68]);

        // Create box reference for LP position
        // Options pool uses "olp_" prefix, Perps pool uses "plp_" prefix
        const boxPrefix = params.pool === "options" ? "olp_" : "plp_";
        const senderBytes = algosdk.decodeAddress(sender).publicKey;
        const boxName = new Uint8Array([
          ...new TextEncoder().encode(boxPrefix),
          ...senderBytes,
        ]);

        // Staking contract receives deposit fees
        const stakingAddress = contracts.staking.address.toString();

        const appCallTxn = await makeAppCallTxn(
          sender,
          poolContract.appId,
          [methodSelector],
          [stakingAddress], // accounts - staking contract for fee transfer
          undefined, // foreignApps
          [lpTokenId], // foreignAssets - LP token must be here!
          new TextEncoder().encode("ChainStrike:Deposit"),
          [{ appIndex: poolContract.appId, name: boxName }], // boxes - LP position box
        );
        txns.push(appCallTxn);

        const groupedTxns = assignGroupID(txns);
        const encodedTxns = groupedTxns.map((txn) =>
          algosdk.encodeUnsignedTransaction(txn),
        );
        const signedTxns = await signTransactions(encodedTxns);
        const result = await sendSignedTransactions(signedTxns);

        return { success: true, txId: result.txId };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Transaction failed";
        setError(errorMessage);
        return { success: false, error: errorMessage };
      } finally {
        setIsLoading(false);
      }
    },
    [activeAccount, signTransactions],
  );

  const withdraw = useCallback(
    async (params: {
      pool: "options" | "perps";
      shares: number;
    }): Promise<TradeResult> => {
      if (!activeAccount || !signTransactions) {
        return { success: false, error: "Wallet not connected" };
      }

      setIsLoading(true);
      setError(null);

      try {
        const contracts = CONTRACTS.testnet;
        const assets = ASSETS.testnet;
        const poolContract =
          params.pool === "options"
            ? contracts.optionsPool
            : contracts.perpsPool;
        const lpTokenId =
          params.pool === "options" ? assets.optionsLP.id : assets.perpsLP.id;
        const algodClient = getAlgodClient();
        const sender = activeAccount.address.toString();

        // Method selector for "withdraw(uint64)uint64" is 0x31214176
        const methodSelector = new Uint8Array([0x31, 0x21, 0x41, 0x76]);
        const sharesArg = new Uint8Array(8);
        new DataView(sharesArg.buffer).setBigUint64(
          0,
          BigInt(Math.floor(params.shares * 1_000_000)),
          false,
        );

        // Create box reference for LP position
        const boxPrefix = params.pool === "options" ? "olp_" : "plp_";
        const senderBytes = algosdk.decodeAddress(sender).publicKey;
        const boxName = new Uint8Array([
          ...new TextEncoder().encode(boxPrefix),
          ...senderBytes,
        ]);

        // Staking contract receives withdrawal fees
        const stakingAddress = contracts.staking.address.toString();

        // Transfer LP tokens to the pool contract
        const suggestedParams = await algodClient.getTransactionParams().do();
        const sharesMicro = Math.floor(params.shares * 1_000_000);
        const transferTxn =
          algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
            sender,
            receiver: poolContract.address.toString(),
            assetIndex: lpTokenId,
            amount: sharesMicro,
            suggestedParams,
          });

        const appCallTxn = await makeAppCallTxn(
          sender,
          poolContract.appId,
          [methodSelector, sharesArg],
          [stakingAddress], // accounts - staking contract for fee transfer
          undefined, // foreignApps
          [lpTokenId], // foreignAssets - LP token for verification
          new TextEncoder().encode("ChainStrike:Withdraw"),
          [{ appIndex: poolContract.appId, name: boxName }], // boxes - LP position box
        );

        const groupedTxns = assignGroupID([transferTxn, appCallTxn]);
        const encodedTxns = groupedTxns.map((txn) =>
          algosdk.encodeUnsignedTransaction(txn),
        );
        const signedTxns = await signTransactions(encodedTxns);
        const result = await sendSignedTransactions(signedTxns);

        return { success: true, txId: result.txId };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Transaction failed";
        setError(errorMessage);
        return { success: false, error: errorMessage };
      } finally {
        setIsLoading(false);
      }
    },
    [activeAccount, signTransactions],
  );

  return { deposit, withdraw, isLoading, error };
}

/**
 * Hook for staking operations
 */
export function useStaking() {
  const { activeAccount, signTransactions } = useSafeWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stake = useCallback(
    async (params: {
      amount: number; // in STRIKE tokens
      lockPeriodDays: number;
    }): Promise<TradeResult> => {
      if (!activeAccount || !signTransactions) {
        return { success: false, error: "Wallet not connected" };
      }

      setIsLoading(true);
      setError(null);

      try {
        const contracts = CONTRACTS.testnet;
        const algodClient = getAlgodClient();
        const sender = activeAccount.address.toString();

        // Check if opted in
        const isOptedIn = await isOptedIntoApp(sender, contracts.staking.appId);

        const txns: algosdk.Transaction[] = [];

        if (!isOptedIn) {
          const suggestedParams = await algodClient.getTransactionParams().do();
          const optInTxn = algosdk.makeApplicationOptInTxnFromObject({
            sender,
            appIndex: contracts.staking.appId,
            suggestedParams,
          });
          txns.push(optInTxn);
        }

        // Stake call
        const methodArg = new TextEncoder().encode("stake");
        const amountArg = new Uint8Array(8);
        new DataView(amountArg.buffer).setBigUint64(
          0,
          BigInt(Math.floor(params.amount * 1_000_000)),
          false,
        );
        const lockArg = new Uint8Array(8);
        new DataView(lockArg.buffer).setBigUint64(
          0,
          BigInt(params.lockPeriodDays),
          false,
        );

        const appCallTxn = await makeAppCallTxn(
          sender,
          contracts.staking.appId,
          [methodArg, amountArg, lockArg],
          undefined,
          undefined,
          undefined,
          new TextEncoder().encode("ChainStrike:Stake"),
        );
        txns.push(appCallTxn);

        const groupedTxns = txns.length > 1 ? assignGroupID(txns) : txns;
        const encodedTxns = groupedTxns.map((txn) =>
          algosdk.encodeUnsignedTransaction(txn),
        );
        const signedTxns = await signTransactions(encodedTxns);
        const result = await sendSignedTransactions(signedTxns);

        return { success: true, txId: result.txId };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Transaction failed";
        setError(errorMessage);
        return { success: false, error: errorMessage };
      } finally {
        setIsLoading(false);
      }
    },
    [activeAccount, signTransactions],
  );

  const unstake = useCallback(async (): Promise<TradeResult> => {
    if (!activeAccount || !signTransactions) {
      return { success: false, error: "Wallet not connected" };
    }

    setIsLoading(true);
    setError(null);

    try {
      const contracts = CONTRACTS.testnet;
      const sender = activeAccount.address.toString();

      const methodArg = new TextEncoder().encode("unstake");
      const appCallTxn = await makeAppCallTxn(
        sender,
        contracts.staking.appId,
        [methodArg],
        undefined,
        undefined,
        undefined,
        new TextEncoder().encode("ChainStrike:Unstake"),
      );

      const encodedTxn = algosdk.encodeUnsignedTransaction(appCallTxn);
      const signedTxns = await signTransactions([encodedTxn]);
      const result = await sendSignedTransactions(signedTxns);

      return { success: true, txId: result.txId };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Transaction failed";
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [activeAccount, signTransactions]);

  const claimRewards = useCallback(async (): Promise<TradeResult> => {
    if (!activeAccount || !signTransactions) {
      return { success: false, error: "Wallet not connected" };
    }

    setIsLoading(true);
    setError(null);

    try {
      const contracts = CONTRACTS.testnet;
      const sender = activeAccount.address.toString();

      const methodArg = new TextEncoder().encode("claim_rewards");
      const appCallTxn = await makeAppCallTxn(
        sender,
        contracts.staking.appId,
        [methodArg],
        undefined,
        undefined,
        undefined,
        new TextEncoder().encode("ChainStrike:ClaimRewards"),
      );

      const encodedTxn = algosdk.encodeUnsignedTransaction(appCallTxn);
      const signedTxns = await signTransactions([encodedTxn]);
      const result = await sendSignedTransactions(signedTxns);

      return { success: true, txId: result.txId };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Transaction failed";
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [activeAccount, signTransactions]);

  return { stake, unstake, claimRewards, isLoading, error };
}
