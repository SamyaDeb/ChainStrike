'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWallet } from '@txnlab/use-wallet-react';
import algosdk from 'algosdk';

interface Props {
  assetId: string;
  asaId?: number;
  referencePriceUsdc?: string;
  bestAskUsdc?: string;  // pre-fill from orderbook depth
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
const IS_TESTNET = (process.env.NEXT_PUBLIC_ALGORAND_NETWORK ?? 'testnet') !== 'mainnet';

function parseAlgorandError(err: unknown): string {
  const msg = (err as any)?.response?.data?.message
    ?? (err as any)?.message
    ?? String(err);
  if (msg.includes('underflow on subtracting')) {
    const match = msg.match(/subtracting (\d+) from sender amount (\d+)/);
    if (match) {
      const needed = (Number(match[1]) / 1_000_000).toFixed(2);
      const have = (Number(match[2]) / 1_000_000).toFixed(2);
      return `Insufficient USDC: you need ${needed} USDC but your wallet only has ${have} USDC. Click "Get Test USDC" to top up.`;
    }
    return 'Insufficient USDC balance. Click "Get Test USDC" to top up your wallet.';
  }
  if (msg.includes('must optin')) {
    return 'Wallet must opt in to USDC first. Try placing the order again.';
  }
  if (msg.includes('overspend')) {
    return 'Insufficient ALGO for transaction fees. Add ALGO to your wallet.';
  }
  return msg;
}

export function OrderForm({ assetId, asaId, referencePriceUsdc, bestAskUsdc }: Props) {
  const { activeAddress, signTransactions, algodClient } = useWallet();
  const queryClient = useQueryClient();

  const [side, setSide] = useState<Side>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const [tif, setTif] = useState<TimeInForce>('GTC');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');

  // Pre-fill price from best ask when switching to BUY / when component receives live ask
  useEffect(() => {
    if (side === 'BUY' && !price && bestAskUsdc) {
      setPrice((Number(bestAskUsdc) / 1_000_000).toFixed(6).replace(/\.?0+$/, ''));
    }
  }, [side, bestAskUsdc]);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [dispensing, setDispensing] = useState(false);
  const [dispenseMsg, setDispenseMsg] = useState<string | null>(null);

  const client = algodClient ?? new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);

  const fetchUsdcBalance = useCallback(async () => {
    if (!activeAddress) { setUsdcBalance(null); return; }
    try {
      const info = await client.accountAssetInformation(activeAddress, USDC_ASA_ID).do();
      const holding = info.assetHolding ?? (info as any)['asset-holding'];
      setUsdcBalance(holding ? Number(holding.amount) / 1_000_000 : 0);
    } catch {
      setUsdcBalance(0);
    }
  }, [activeAddress]);

  useEffect(() => { fetchUsdcBalance(); }, [fetchUsdcBalance]);

  const priceNum = parseFloat(price) || (referencePriceUsdc ? Number(referencePriceUsdc) / 1_000_000 : 0);
  const refNum = referencePriceUsdc ? Number(referencePriceUsdc) / 1_000_000 : null;
  const priceBandViolation = orderType === 'LIMIT' && price && refNum !== null
    && (priceNum < refNum * 0.80 || priceNum > refNum * 1.20);
  const estimatedTotal = price && quantity
    ? parseFloat(price) * parseFloat(quantity)
    : null;

  const maxAffordableQty = usdcBalance !== null && priceNum > 0
    ? Math.floor((usdcBalance / priceNum) * 1_000_000) / 1_000_000
    : null;

  const insufficientUsdc = side === 'BUY' && !DEV_SKIP_ESCROW && usdcBalance !== null
    && estimatedTotal !== null && usdcBalance < estimatedTotal;

  const handleDispenseUsdc = async () => {
    if (!activeAddress) return;
    setDispensing(true);
    setDispenseMsg(null);
    try {
      // First opt wallet into USDC if needed
      const sp = await client.getTransactionParams().do();
      const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: activeAddress,
        assetIndex: USDC_ASA_ID,
        amount: 0n,
        suggestedParams: sp,
        note: new TextEncoder().encode('USDC opt-in'),
      });
      try {
        if (signTransactions) {
          const signed = (await signTransactions([algosdk.encodeUnsignedTransaction(optInTxn)])).filter((s): s is Uint8Array => s !== null);
          const { txid } = await client.sendRawTransaction(signed).do();
          await algosdk.waitForConfirmation(client, txid, 4);
        }
      } catch {
        // Already opted in — continue
      }

      const res = await api.post('/assets/dispense-usdc', { walletAddress: activeAddress });
      setDispenseMsg(`Sent ${res.data.amount ?? 50} USDC to your wallet (txId: ${res.data.txId?.slice(0, 12)}…)`);
      setTimeout(() => fetchUsdcBalance(), 3000);
    } catch (err: any) {
      setDispenseMsg(`Failed: ${err.response?.data?.message ?? err.message}`);
    } finally {
      setDispensing(false);
    }
  };

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

        if (totalUsdc <= 0n) throw new Error('Invalid order total');

        // ─── Pre-flight balance check ─────────────────────────────────────────
        const needed = Number(totalUsdc) / 1_000_000;
        if (usdcBalance !== null && usdcBalance < needed) {
          throw new Error(
            `Insufficient USDC: you need ${needed.toFixed(2)} USDC but your wallet has ${usdcBalance.toFixed(2)} USDC.` +
            (IS_TESTNET ? ' Click "Get Test USDC" to top up.' : '')
          );
        }

        // ─── Ensure escrow has opted into USDC ────────────────────────────────
        await api.post('/assets/setup-escrow');

        // ─── Ensure investor wallet has opted into USDC ───────────────────────
        let investorOptedIn = false;
        try {
          const assetInfo = await client.accountAssetInformation(activeAddress, USDC_ASA_ID).do();
          investorOptedIn = !!(assetInfo.assetHolding ?? (assetInfo as any)['asset-holding']);
        } catch { investorOptedIn = false; }

        const suggestedParams = await client.getTransactionParams().do();

        if (!investorOptedIn) {
          const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
            sender: activeAddress,
            receiver: activeAddress,
            assetIndex: USDC_ASA_ID,
            amount: 0n,
            suggestedParams,
            note: new TextEncoder().encode('USDC opt-in'),
          });
          const signedOptIn = (await signTransactions([algosdk.encodeUnsignedTransaction(optInTxn)])).filter((s): s is Uint8Array => s !== null);
          const { txid: optInTxId } = await client.sendRawTransaction(signedOptIn).do();
          await algosdk.waitForConfirmation(client, optInTxId, 4);
        }

        // ─── Ensure investor wallet has opted into the RWA token ─────────────
        // Required: settlement sends tokens via clawback to buyer — buyer must be opted in
        if (asaId) {
          let asaOptedIn = false;
          try {
            const asaInfo = await client.accountAssetInformation(activeAddress, asaId).do();
            asaOptedIn = !!(asaInfo.assetHolding ?? (asaInfo as any)['asset-holding']);
          } catch { asaOptedIn = false; }

          if (!asaOptedIn) {
            const asaOptInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
              sender: activeAddress,
              receiver: activeAddress,
              assetIndex: asaId,
              amount: 0n,
              suggestedParams,
              note: new TextEncoder().encode('RWA token opt-in'),
            });
            const signedAsaOptIn = (await signTransactions([algosdk.encodeUnsignedTransaction(asaOptInTxn)])).filter((s): s is Uint8Array => s !== null);
            const { txid: asaOptInTxId } = await client.sendRawTransaction(signedAsaOptIn).do();
            await algosdk.waitForConfirmation(client, asaOptInTxId, 4);
          }
        }

        // ─── Send USDC to escrow ──────────────────────────────────────────────
        const usdcTransfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: activeAddress,
          receiver: ESCROW_ADDRESS,
          assetIndex: USDC_ASA_ID,
          amount: totalUsdc,
          suggestedParams,
          note: new TextEncoder().encode(JSON.stringify({ action: 'escrow_lock', assetId })),
        });

        const signed = (await signTransactions([algosdk.encodeUnsignedTransaction(usdcTransfer)])).filter((s): s is Uint8Array => s !== null);
        const { txid } = await client.sendRawTransaction(signed).do();
        await algosdk.waitForConfirmation(client, txid, 4);
        escrowTxId = txid;
      }

      // ─── Place order in orderbook ─────────────────────────────────────────────
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
      queryClient.invalidateQueries({ queryKey: ['orderbook', assetId] });
      setPrice('');
      setQuantity('');
      fetchUsdcBalance();
    },
  });

  const errorMessage = mutation.isError
    ? parseAlgorandError(mutation.error)
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

      {/* USDC balance row */}
      {activeAddress && side === 'BUY' && !DEV_SKIP_ESCROW && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            USDC balance:&nbsp;
            <span className={`font-medium ${insufficientUsdc ? 'text-red-400' : 'text-white'}`}>
              {usdcBalance !== null ? `$${usdcBalance.toFixed(2)}` : '—'}
            </span>
          </span>
          {IS_TESTNET && (
            <button
              onClick={handleDispenseUsdc}
              disabled={dispensing}
              className="text-xs px-2 py-0.5 rounded border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
            >
              {dispensing ? 'Sending…' : 'Get Test USDC'}
            </button>
          )}
        </div>
      )}
      {dispenseMsg && (
        <p className={`text-xs ${dispenseMsg.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>
          {dispenseMsg}
        </p>
      )}

      {/* Price input (LIMIT only) */}
      {orderType === 'LIMIT' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Price (USDC per token)</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={referencePriceUsdc ? (Number(referencePriceUsdc) / 1_000_000).toFixed(2) : '0.00'}
            step="0.01"
            min="0"
            className="w-full bg-[#0F1117] border border-[#2A2D3A] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* Quantity */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-500">Quantity (tokens)</label>
          {side === 'BUY' && maxAffordableQty !== null && maxAffordableQty > 0 && (
            <button
              onClick={() => setQuantity(maxAffordableQty.toFixed(6))}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Max: {maxAffordableQty.toFixed(4)}
            </button>
          )}
        </div>
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0"
          step="0.000001"
          min="0"
          className="w-full bg-[#0F1117] border border-[#2A2D3A] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Total estimate + balance warning */}
      {estimatedTotal !== null && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Total cost</span>
            <span className={`font-medium ${insufficientUsdc ? 'text-red-400' : 'text-white'}`}>
              ${estimatedTotal.toFixed(2)} USDC
            </span>
          </div>
          {insufficientUsdc && (
            <p className="text-xs text-red-400">
              Insufficient balance. Need ${estimatedTotal.toFixed(2)}, have ${usdcBalance!.toFixed(2)}.
              {IS_TESTNET && ' Click "Get Test USDC" above.'}
            </p>
          )}
        </div>
      )}

      {/* Price band hint — show valid range */}
      {referencePriceUsdc && orderType === 'LIMIT' && (() => {
        const ref = Number(referencePriceUsdc) / 1_000_000;
        const lo = (ref * 0.80).toFixed(4);
        const hi = (ref * 1.20).toFixed(4);
        const enteredPrice = parseFloat(price);
        const outOfBand = price && (enteredPrice < ref * 0.80 || enteredPrice > ref * 1.20);
        return (
          <div className={`text-xs ${outOfBand ? 'text-red-400' : 'text-gray-500'}`}>
            Valid price range: ${lo} – ${hi} USDC (±20% of ${ref.toFixed(4)})
            {outOfBand && <span className="block mt-0.5 font-medium">⚠ Price out of range — order will be rejected</span>}
          </div>
        );
      })()}

      {/* Submit button */}
      {!activeAddress ? (
        <p className="text-xs text-yellow-500 text-center">Connect your Algorand wallet to trade</p>
      ) : (
        <button
          onClick={() => mutation.mutate()}
          disabled={
            mutation.isPending ||
            !quantity ||
            (orderType === 'LIMIT' && !price) ||
            insufficientUsdc ||
            !!priceBandViolation
          }
          className={`w-full py-2.5 text-sm font-semibold rounded-lg transition-colors disabled:opacity-40 ${
            side === 'BUY'
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-red-600 hover:bg-red-700 text-white'
          }`}
        >
          {mutation.isPending
            ? 'Processing…'
            : insufficientUsdc
              ? 'Insufficient USDC'
              : `${side} ${assetId.slice(0, 4).toUpperCase()}`}
        </button>
      )}

      {errorMessage && (
        <p className="text-xs text-red-400 text-center leading-relaxed">{errorMessage}</p>
      )}

      {mutation.isSuccess && (
        <p className="text-xs text-green-400 text-center">Order placed and live in orderbook!</p>
      )}
    </div>
  );
}
