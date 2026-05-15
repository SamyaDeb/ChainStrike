'use client';

import { useState } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import algosdk from 'algosdk';

interface Props {
  asaId: number;
  walletAddress: string;
}

const ALGOD_SERVER = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
const ALGOD_PORT = Number(process.env.NEXT_PUBLIC_ALGORAND_ALGOD_PORT ?? '443');
const ALGOD_TOKEN = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_TOKEN ?? '';

export function AssetOptIn({ asaId, walletAddress }: Props) {
  const { signTransactions, algodClient } = useWallet();
  const [isOptingIn, setIsOptingIn] = useState(false);
  const [hasOptedIn, setHasOptedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOptIn = async () => {
    if (!signTransactions) {
      setError('Wallet signer not available');
      return;
    }

    setIsOptingIn(true);
    setError(null);

    try {
      const client = algodClient ?? new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
      const suggestedParams = await client.getTransactionParams().do();

      const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: walletAddress,
        to: walletAddress,
        assetIndex: asaId,
        amount: 0,
        suggestedParams,
      });

      const signed = await signTransactions([optInTxn.toByte()]);
      const { txId } = await client.sendRawTransaction(signed).do();
      await algosdk.waitForConfirmation(client, txId, 4);

      setHasOptedIn(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsOptingIn(false);
    }
  };

  if (hasOptedIn) {
    return (
      <div className="text-xs text-green-400 bg-green-400/10 rounded px-3 py-2">
        You have opted in to this asset.
      </div>
    );
  }

  return (
    <div className="bg-yellow-400/10 border border-yellow-400/20 rounded-lg p-4 space-y-2">
      <p className="text-sm text-yellow-400">
        You must opt-in to this asset before trading.
      </p>
      <p className="text-xs text-gray-400">
        This reserves 0.1 ALGO in your wallet as minimum balance.
      </p>
      <button
        onClick={handleOptIn}
        disabled={isOptingIn}
        className="w-full py-2 text-sm font-semibold bg-yellow-500 hover:bg-yellow-600 text-black rounded-lg transition-colors disabled:opacity-50"
      >
        {isOptingIn ? 'Opting in…' : 'Opt In to Asset'}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
