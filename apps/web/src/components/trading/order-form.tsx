'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWallet } from '@txnlab/use-wallet-react';
import algosdk from 'algosdk';

interface Props {
  assetId: string;
  asaId?: number;
  referencePriceUsdc?: string;
}

type Side = 'BUY' | 'SELL';
type OrderType = 'LIMIT' | 'MARKET';
type TimeInForce = 'GTC' | 'IOC' | 'FOK';

const ESCROW_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_ADDRESS ?? '';
const USDC_ASA_ID = Number(process.env.NEXT_PUBLIC_USDC_ASA_ID ?? '10458941');
const ALGOD_SERVER = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
const ALGOD_PORT = Number(process.env.NEXT_PUBLIC_ALGORAND_ALGOD_PORT ?? '443');
const ALGOD_TOKEN = process.env.NEXT_PUBLIC_ALGORAND_ALGOD_TOKEN ?? '';
const DEV_SKIP_ESCROW = process.env.NEXT_PUBLIC_DEV_SKIP_ESCROW === 'true';

export function OrderForm({ assetId, asaId, referencePriceUsdc }: Props) {
  const { activeAddress, signTransactions, algodClient } = useWallet();
  const queryClient = useQueryClient();

  const [side, setSide] = useState<Side>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const [tif, setTif] = useState<TimeInForce>('GTC');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      if (!activeAddress) throw new Error('Connect wallet first');
      if (!signTransactions) throw new Error('Wallet signer not available');

      let escrowTxId: string | undefined;

      // ─── BUY orders: lock USDC in escrow (skipped in dev mode) ───────────────
      if (side === 'BUY' && !DEV_SKIP_ESCROW) {
        if (!ESCROW_ADDRESS) {
          throw new Error('Escrow address not configured — set NEXT_PUBLIC_ESCROW_ADDRESS or enable DEV_SKIP_ESCROW');
        }

        const totalUsdc = BigInt(Math.floor(
          (orderType === 'LIMIT' ? parseFloat(price) : parseFloat(referencePriceUsdc ?? '0')) *
          parseFloat(quantity) *
          1_000_000
        ));

        if (totalUsdc <= 0n) {
          throw new Error('Invalid order total');
        }

        const client = algodClient ?? new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
        const suggestedParams = await client.getTransactionParams().do();

        const usdcTransfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: activeAddress,
          to: ESCROW_ADDRESS,
          assetIndex: USDC_ASA_ID,
          amount: Number(totalUsdc),
          suggestedParams,
          note: new TextEncoder().encode(JSON.stringify({ action: 'escrow_lock', assetId })),
        });

        const signed = await signTransactions([usdcTransfer.toByte()]);
        const { txId } = await client.sendRawTransaction(signed).do();
        await algosdk.waitForConfirmation(client, txId, 4);
        escrowTxId = txId;
      }

      // ─── Place order ─────────────────────────────────────────────────────────
      const { data } = await api.post('/orders', {
        assetId,
        side,
        orderType,
        timeInForce: tif,
        price: orderType === 'LIMIT' ? BigInt(Math.floor(parseFloat(price) * 1_000_000)).toString() : undefined,
        quantity: BigInt(Math.floor(parseFloat(quantity) * 1_000_000)).toString(),
        walletAddress: activeAddress,
        escrowTxId,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      setPrice('');
      setQuantity('');
    },
  });

  const estimatedTotal = price && quantity
    ? (parseFloat(price) * parseFloat(quantity)).toFixed(2)
    : null;

  return (
    <div className="bg-[#1A1D27] rounded-xl border border-[#2A2D3A] p-4 space-y-4">
      {/* BUY / SELL toggle */}
      <div className="grid grid-cols-2 bg-[#0F1117] rounded-lg p-0.5">
        {(['BUY', 'SELL'] as Side[]).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`py-1.5 text-sm font-semibold rounded-md transition-colors ${
              side === s
                ? s === 'BUY' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Order type */}
      <div className="flex gap-2">
        {(['LIMIT', 'MARKET'] as OrderType[]).map((t) => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              orderType === t
                ? 'border-blue-500 text-blue-400 bg-blue-500/10'
                : 'border-[#2A2D3A] text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
        <select
          value={tif}
          onChange={(e) => setTif(e.target.value as TimeInForce)}
          className="ml-auto text-xs bg-[#0F1117] border border-[#2A2D3A] text-gray-400 rounded px-2 py-1"
        >
          <option value="GTC">GTC</option>
          <option value="IOC">IOC</option>
          <option value="FOK">FOK</option>
        </select>
      </div>

      {/* Price input (LIMIT only) */}
      {orderType === 'LIMIT' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Price (USDC)</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={referencePriceUsdc ? (Number(referencePriceUsdc) / 1_000_000).toFixed(2) : '0.00'}
            step="0.000001"
            className="w-full bg-[#0F1117] border border-[#2A2D3A] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* Quantity */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Quantity (tokens)</label>
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0"
          step="0.000001"
          className="w-full bg-[#0F1117] border border-[#2A2D3A] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Total estimate */}
      {estimatedTotal && (
        <div className="flex justify-between text-xs text-gray-500">
          <span>Estimated total</span>
          <span className="text-white font-medium">${estimatedTotal} USDC</span>
        </div>
      )}

      {/* Escrow info for buys */}
      {side === 'BUY' && (
        <div className="text-xs bg-blue-400/10 rounded px-3 py-2 text-blue-400">
          {DEV_SKIP_ESCROW
            ? 'Dev mode: escrow skipped — order placed directly.'
            : 'USDC will be locked in escrow when you place this order.'}
        </div>
      )}

      {/* Price band hint */}
      {referencePriceUsdc && orderType === 'LIMIT' && (
        <div className="text-xs text-gray-500">
          Reference: {(Number(referencePriceUsdc) / 1_000_000).toFixed(4)} USDC — orders must be within ±20%
          ({(Number(referencePriceUsdc) * 0.8 / 1_000_000).toFixed(4)}–{(Number(referencePriceUsdc) * 1.2 / 1_000_000).toFixed(4)})
        </div>
      )}

      {/* Wallet connection guard */}
      {!activeAddress ? (
        <p className="text-xs text-yellow-500 text-center">Connect your Algorand wallet to trade</p>
      ) : (
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !quantity || (orderType === 'LIMIT' && !price)}
          className={`w-full py-2.5 text-sm font-semibold rounded-lg transition-colors disabled:opacity-40 ${
            side === 'BUY'
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-red-600 hover:bg-red-700 text-white'
          }`}
        >
          {mutation.isPending ? 'Placing order…' : `${side} ${assetId.slice(0, 4).toUpperCase()}`}
        </button>
      )}

      {mutation.isError && (
        <p className="text-xs text-red-500 text-center">
          {(mutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
