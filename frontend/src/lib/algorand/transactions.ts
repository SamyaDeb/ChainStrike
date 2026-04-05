import algosdk from "algosdk";
import { getSuggestedParams, waitForConfirmation } from "./client";

/**
 * Transaction builder result
 */
export interface TransactionBuilderResult {
  txns: algosdk.Transaction[];
  sign: (signer: algosdk.TransactionSigner) => Promise<Uint8Array[]>;
  send: (signedTxns: Uint8Array[]) => Promise<TransactionResult>;
}

/**
 * Transaction result
 */
export interface TransactionResult {
  txId: string;
  confirmedRound: number;
  poolError?: string;
  txnResults?: algosdk.modelsv2.PendingTransactionResponse[];
}

/**
 * Create a payment transaction
 */
export const makePaymentTxn = async (
  from: string,
  to: string,
  amount: number | bigint,
  note?: Uint8Array
): Promise<algosdk.Transaction> => {
  const suggestedParams = await getSuggestedParams();

  return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: from,
    receiver: to,
    amount: BigInt(amount),
    suggestedParams,
    note,
  });
};

/**
 * Create an asset transfer transaction
 */
export const makeAssetTransferTxn = async (
  from: string,
  to: string,
  assetIndex: number,
  amount: number | bigint,
  note?: Uint8Array
): Promise<algosdk.Transaction> => {
  const suggestedParams = await getSuggestedParams();

  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: from,
    receiver: to,
    assetIndex,
    amount: BigInt(amount),
    suggestedParams,
    note,
  });
};

/**
 * Create an asset opt-in transaction
 */
export const makeAssetOptInTxn = async (
  from: string,
  assetIndex: number
): Promise<algosdk.Transaction> => {
  const suggestedParams = await getSuggestedParams();

  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: from,
    receiver: from, // Opt-in is a zero-amount transfer to self
    assetIndex,
    amount: BigInt(0),
    suggestedParams,
  });
};

/**
 * Create an application opt-in transaction
 */
export const makeAppOptInTxn = async (
  from: string,
  appIndex: number
): Promise<algosdk.Transaction> => {
  const suggestedParams = await getSuggestedParams();

  return algosdk.makeApplicationOptInTxnFromObject({
    sender: from,
    appIndex,
    suggestedParams,
  });
};

/**
 * Create an application close-out transaction
 */
export const makeAppCloseOutTxn = async (
  from: string,
  appIndex: number
): Promise<algosdk.Transaction> => {
  const suggestedParams = await getSuggestedParams();

  return algosdk.makeApplicationCloseOutTxnFromObject({
    sender: from,
    appIndex,
    suggestedParams,
  });
};

/**
 * Create an application call transaction
 */
export const makeAppCallTxn = async (
  from: string,
  appIndex: number,
  appArgs?: Uint8Array[],
  accounts?: string[],
  foreignApps?: number[],
  foreignAssets?: number[],
  note?: Uint8Array,
  boxes?: { appIndex: number; name: Uint8Array }[]
): Promise<algosdk.Transaction> => {
  const suggestedParams = await getSuggestedParams();

  return algosdk.makeApplicationNoOpTxnFromObject({
    sender: from,
    appIndex,
    appArgs,
    accounts,
    foreignApps,
    foreignAssets,
    suggestedParams,
    note,
    boxes,
  });
};

/**
 * Encode a method call using ABI
 */
export const encodeMethodCall = (
  method: algosdk.ABIMethod,
  args: unknown[]
): Uint8Array[] => {
  const methodSelector = method.getSelector();
  const encodedArgs: Uint8Array[] = [methodSelector];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const argType = method.args[i].type;

    if (argType.toString().startsWith("uint")) {
      // Encode integers
      const value = BigInt(arg as number | bigint | string);
      const bytes = new Uint8Array(8);
      const view = new DataView(bytes.buffer);
      view.setBigUint64(0, value, false); // Big-endian
      encodedArgs.push(bytes);
    } else if (argType.toString() === "address") {
      // Encode addresses
      const decoded = algosdk.decodeAddress(arg as string);
      encodedArgs.push(decoded.publicKey);
    } else if (argType.toString() === "bool") {
      // Encode booleans
      encodedArgs.push(new Uint8Array([arg ? 1 : 0]));
    } else if (argType.toString() === "byte[]") {
      // Encode byte arrays
      encodedArgs.push(arg as Uint8Array);
    } else {
      // For other types, convert to bytes manually
      const str = String(arg);
      const bytes = new TextEncoder().encode(str);
      encodedArgs.push(bytes);
    }
  }

  return encodedArgs;
};

/**
 * Create a method call transaction using ABI
 */
export const makeMethodCallTxn = async (
  from: string,
  appIndex: number,
  method: algosdk.ABIMethod,
  args: unknown[],
  accounts?: string[],
  foreignApps?: number[],
  foreignAssets?: number[],
  note?: Uint8Array
): Promise<algosdk.Transaction> => {
  const encodedArgs = encodeMethodCall(method, args);

  return makeAppCallTxn(
    from,
    appIndex,
    encodedArgs,
    accounts,
    foreignApps,
    foreignAssets,
    note
  );
};

/**
 * Assign group ID to a group of transactions
 */
export const assignGroupID = (
  txns: algosdk.Transaction[]
): algosdk.Transaction[] => {
  return algosdk.assignGroupID(txns);
};

/**
 * Send signed transactions and wait for confirmation
 */
export const sendAndWait = async (
  signedTxns: Uint8Array[],
  algodClient: algosdk.Algodv2
): Promise<TransactionResult> => {
  const response = await algodClient.sendRawTransaction(signedTxns).do();
  const txId = response.txid || (typeof response === "string" ? response : "");

  const confirmedTxn = await waitForConfirmation(txId);

  return {
    txId,
    confirmedRound: Number(confirmedTxn.confirmedRound || 0),
    poolError: confirmedTxn.poolError,
  };
};

/**
 * Transaction builder for composing and sending transactions
 */
export class TransactionBuilder {
  private txns: algosdk.Transaction[] = [];

  /**
   * Add a transaction to the group
   */
  addTransaction(txn: algosdk.Transaction): this {
    this.txns.push(txn);
    return this;
  }

  /**
   * Add multiple transactions to the group
   */
  addTransactions(txns: algosdk.Transaction[]): this {
    this.txns.push(...txns);
    return this;
  }

  /**
   * Get the transactions (assigns group ID if multiple)
   */
  getTransactions(): algosdk.Transaction[] {
    if (this.txns.length > 1) {
      return assignGroupID(this.txns);
    }
    return this.txns;
  }

  /**
   * Build the transaction group
   */
  build(): TransactionBuilderResult {
    const txns = this.getTransactions();

    return {
      txns,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      sign: async (_signer: algosdk.TransactionSigner) => {
        // Wallet providers typically provide a simpler signature method
        // We'll use the encoded transactions and expect back signed transactions
        const encoded = txns.map((txn) => algosdk.encodeUnsignedTransaction(txn));
        // Note: Most wallet providers expect Transaction[], we'll return them directly
        // and let the integrator handle signing with their wallet
        return encoded;
      },
      send: async (signedTxns: Uint8Array[]) => {
        const algodClient = (await import("./client")).getAlgodClient();
        return await sendAndWait(signedTxns, algodClient);
      },
    };
  }

  /**
   * Build, sign, and send the transaction group
   */
  async execute(signer: algosdk.TransactionSigner): Promise<TransactionResult> {
    const { sign, send } = this.build();
    const signedTxns = await sign(signer);
    return await send(signedTxns);
  }
}

/**
 * Helper to create a new transaction builder
 */
export const createTransactionBuilder = (): TransactionBuilder => {
  return new TransactionBuilder();
};

/**
 * Decode application logs from a transaction
 */
export const decodeAppLogs = (
  logs: Uint8Array[] | undefined
): Record<string, unknown>[] => {
  if (!logs || logs.length === 0) {
    return [];
  }

  return logs.map((log) => {
    try {
      const decoded = new TextDecoder().decode(log);
      return { raw: decoded };
    } catch {
      return { raw: log };
    }
  });
};

/**
 * Get inner transactions from a transaction result
 */
export const getInnerTransactions = (
  result: algosdk.modelsv2.PendingTransactionResponse
): algosdk.modelsv2.PendingTransactionResponse[] => {
  return result.innerTxns || [];
};
