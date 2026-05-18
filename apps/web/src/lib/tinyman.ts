'use client';

// Tinyman SDK v4 is built against algosdk v2; passing it a v3 client breaks its
// pool/account-state decoders. `algosdk-v2` is aliased (next.config.mjs +
// tsconfig paths) to the algosdk v2 bundled inside the Tinyman SDK so the swap
// path uses a matching client. Wallet/opt-in code elsewhere keeps root v3.
import algosdk from 'algosdk-v2';
import { poolUtils, Swap, AddLiquidity, RemoveLiquidity, type InitiatorSigner, type SwapQuote } from '@tinymanorg/tinyman-js-sdk';

const USDC_ASA_ID = Number(process.env.NEXT_PUBLIC_USDC_ASA_ID ?? '10458941');
export const TINYMAN_NETWORK = (
  process.env.NEXT_PUBLIC_ALGORAND_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
) as 'testnet' | 'mainnet';

export function getAlgodClient(): algosdk.Algodv2 {
  return new algosdk.Algodv2(
    process.env.NEXT_PUBLIC_ALGORAND_ALGOD_TOKEN ?? '',
    process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud',
    Number(process.env.NEXT_PUBLIC_ALGORAND_ALGOD_PORT ?? '443'),
  );
}

// ─── Pool info ────────────────────────────────────────────────────────────────

export async function getPool(asaId: number) {
  const client = getAlgodClient() as any;
  const asset1ID = Math.min(asaId, USDC_ASA_ID);
  const asset2ID = Math.max(asaId, USDC_ASA_ID);
  return poolUtils.v2.getPoolInfo({ client, network: TINYMAN_NETWORK, asset1ID, asset2ID });
}

// ─── Pool reserves → current spot price ──────────────────────────────────────

export async function getPoolPrice(asaId: number): Promise<number | null> {
  try {
    const pool = await getPool(asaId);
    const reserves = await poolUtils.v2.getPoolReserves(getAlgodClient() as any, pool);
    if (!reserves.asset1 || !reserves.asset2) return null;
    // Use pool.asset1ID (actual SDK-returned ordering) rather than numeric comparison.
    // Tinyman may store assets in a different order than Math.min/max predicts.
    const poolAsset1IsUsdc = (pool as any).asset1ID === USDC_ASA_ID;
    const usdcReserve = poolAsset1IsUsdc ? reserves.asset1 : reserves.asset2;
    const tokenReserve = poolAsset1IsUsdc ? reserves.asset2 : reserves.asset1;
    return tokenReserve === 0n ? null : Number(usdcReserve) / Number(tokenReserve);
  } catch {
    return null;
  }
}

// ─── Swap quote ───────────────────────────────────────────────────────────────

export type SwapSide = 'buy' | 'sell';

/** Parsed, display-ready quote data returned alongside the raw SDK quote. */
export interface SwapQuoteData {
  /** Exact output amount in micro-units of the receive asset. */
  assetOutAmount: bigint;
  /** Minimum received after slippage, in micro-units. */
  assetOutMin: bigint;
  /** Price impact as a 0–1 fraction (0.01 = 1%). */
  priceImpact: number;
  /** Swap fee in micro-units of the input asset. */
  swapFee: number;
  /** Effective exchange rate: how many receive-asset display units per 1 spend-asset display unit. */
  rate: number;
  /** Raw SDK quote — pass to executeSwap. */
  _rawQuote: SwapQuote;
}

export async function getSwapQuote(params: {
  asaId: number;
  asaDecimals: number;
  side: SwapSide;
  amount: bigint;
  slippage?: number;
}): Promise<{ data: SwapQuoteData; pool: Awaited<ReturnType<typeof getPool>> }> {
  const { asaId, asaDecimals, side, amount, slippage = 0.005 } = params;
  const pool = await getPool(asaId);

  const assetIn =
    side === 'buy'
      ? { id: USDC_ASA_ID, decimals: 6 }
      : { id: asaId, decimals: asaDecimals };
  const assetOut =
    side === 'buy'
      ? { id: asaId, decimals: asaDecimals }
      : { id: USDC_ASA_ID, decimals: 6 };

  const rawQuote = await Swap.v2.getQuote({
    type: 'fixed-input' as any,
    amount,
    assetIn,
    assetOut,
    pool,
    network: TINYMAN_NETWORK,
    slippage,
  });

  // Extract fields from the SDK's DirectSwapQuote (type === 'direct')
  const directData = (rawQuote as any).data as { quote: any; pool: any };
  const q = directData?.quote;

  const assetOutAmount: bigint = BigInt(q?.assetOutAmount ?? 0n);
  // Minimum received = exact output minus slippage tolerance
  const slippageBps = BigInt(Math.round(slippage * 10_000));
  const assetOutMin = assetOutAmount - (assetOutAmount * slippageBps) / 10_000n;

  return {
    data: {
      assetOutAmount,
      assetOutMin,
      priceImpact: Number(q?.priceImpact ?? 0),
      swapFee: Number(q?.swapFee ?? 0),
      rate: Number(q?.rate ?? 0),
      _rawQuote: rawQuote,
    },
    pool,
  };
}

// ─── Execute swap ─────────────────────────────────────────────────────────────

export async function executeSwap(params: {
  asaId: number;
  asaDecimals: number;
  side: SwapSide;
  amount: bigint;
  slippage?: number;
  initiatorAddr: string;
  signTransactions: (txns: Uint8Array[]) => Promise<(Uint8Array | null)[]>;
}) {
  const { asaId, asaDecimals, side, amount, slippage = 0.005, initiatorAddr, signTransactions } = params;

  const { data: quoteData, pool } = await getSwapQuote({ asaId, asaDecimals, side, amount, slippage });
  const rawQuote = quoteData._rawQuote;
  const client = getAlgodClient();

  const txGroup = await Swap.v2.generateTxns({
    client: client as any,
    network: TINYMAN_NETWORK,
    quote: rawQuote,
    swapType: 'fixed-input' as any,
    slippage,
    initiatorAddr,
  });

  const initiatorSigner: InitiatorSigner = async (txGroupList) => {
    const flat = txGroupList.flat();
    const encoded = flat.map(({ txn }) => (txn as any).toByte() as Uint8Array);
    const walletSigned = await signTransactions(encoded);
    if (walletSigned.some((s) => !s)) throw new Error('Wallet declined to sign.');
    return walletSigned.map((s) => s as Uint8Array);
  };

  const signedTxns = await Swap.v2.signTxns({ txGroup, initiatorSigner });
  await client.sendRawTransaction(signedTxns).do();

  const result = await Swap.v2.execute({
    client: client as any,
    quote: rawQuote,
    txGroup,
    signedTxns,
  });

  return { result, quoteData, pool };
}

// ─── Liquidity provider helpers (USDC-only single-asset mode) ────────────────
//
// Investors supply only USDC. Tinyman internally swaps ~half to RWA tokens so
// the pool receives both sides, keeping k = x*y intact. LP tokens go to the
// investor proportional to their share of the post-add pool.
// On removal, LP tokens are burned and the output is single-asset USDC
// (Tinyman swaps the RWA portion back internally).

export interface UsdcAddQuoteData {
  usdcIn: bigint;
  lpOut: bigint;
  poolSharePct: number;
  priceImpact: number;
  minLpOut: bigint;
}

export async function getUsdcAddLiquidityQuote(params: {
  asaId: number;
  asaDecimals: number;
  usdcAmount: bigint;
  slippage?: number;
}): Promise<UsdcAddQuoteData> {
  const { asaId, asaDecimals, usdcAmount, slippage = 0.005 } = params;
  const pool = await getPool(asaId);
  const poolAsset1IsUsdc = (pool as any).asset1ID === USDC_ASA_ID;

  const decimals = poolAsset1IsUsdc
    ? { asset1: 6, asset2: asaDecimals }
    : { asset1: asaDecimals, asset2: 6 };

  const quote = AddLiquidity.v2.withSingleAsset.getQuote({
    pool,
    assetIn: { id: USDC_ASA_ID, amount: usdcAmount },
    slippage,
    decimals,
  } as any) as any;

  const lpOut: bigint = BigInt(quote?.poolTokenOut?.amount ?? 0n);
  const minLpOut: bigint = BigInt(quote?.minPoolTokenAssetAmountWithSlippage ?? 0n);
  const priceImpact: number = Number(quote?.internalSwapQuote?.priceImpact ?? 0);
  const poolSharePct: number = Number(quote?.share ?? 0) * 100;

  return { usdcIn: usdcAmount, lpOut, minLpOut, priceImpact, poolSharePct };
}

export async function addLiquidityUsdc(params: {
  asaId: number;
  asaDecimals: number;
  usdcAmount: bigint;
  slippage?: number;
  initiatorAddr: string;
  signTransactions: (txns: Uint8Array[]) => Promise<(Uint8Array | null)[]>;
}): Promise<{ lpReceived: bigint }> {
  const { asaId, asaDecimals, usdcAmount, slippage = 0.005, initiatorAddr, signTransactions } = params;
  const pool = await getPool(asaId);
  const client = getAlgodClient();
  const poolAsset1IsUsdc = (pool as any).asset1ID === USDC_ASA_ID;

  const decimals = poolAsset1IsUsdc
    ? { asset1: 6, asset2: asaDecimals }
    : { asset1: asaDecimals, asset2: 6 };

  const quote = AddLiquidity.v2.withSingleAsset.getQuote({
    pool,
    assetIn: { id: USDC_ASA_ID, amount: usdcAmount },
    slippage,
    decimals,
  } as any) as any;

  const minLpOut: bigint = BigInt(quote?.minPoolTokenAssetAmountWithSlippage ?? 0n);
  const poolAddress: string = (pool as any).account.address();
  const poolTokenId: number = Number((pool as any).poolTokenID);

  const txGroup = await AddLiquidity.v2.withSingleAsset.generateTxns({
    client: client as any,
    network: TINYMAN_NETWORK,
    poolAddress,
    assetIn: { id: USDC_ASA_ID, amount: usdcAmount },
    poolTokenId,
    initiatorAddr,
    minPoolTokenAssetAmount: minLpOut,
  } as any);

  const initiatorSigner: InitiatorSigner = async (txGroupList) => {
    const flat = txGroupList.flat();
    const encoded = flat.map(({ txn }) => (txn as any).toByte() as Uint8Array);
    const walletSigned = await signTransactions(encoded);
    if (walletSigned.some((s) => !s)) throw new Error('Wallet declined to sign.');
    return walletSigned.map((s) => s as Uint8Array);
  };

  const signedTxns = await AddLiquidity.v2.withSingleAsset.signTxns({ txGroup, initiatorSigner } as any);
  const result = await AddLiquidity.v2.withSingleAsset.execute({
    client: client as any,
    pool,
    txGroup,
    signedTxns,
  } as any) as any;

  const lpReceived: bigint = BigInt(result?.assetOut?.amount ?? minLpOut);
  return { lpReceived };
}

export interface UsdcRemoveQuoteData {
  usdcOut: bigint;
  priceImpact: number;
}

export async function getUsdcRemoveLiquidityQuote(params: {
  asaId: number;
  asaDecimals: number;
  lpAmount: bigint;
}): Promise<UsdcRemoveQuoteData> {
  const { asaId, asaDecimals, lpAmount } = params;
  const pool = await getPool(asaId);
  const client = getAlgodClient();
  const reserves = await poolUtils.v2.getPoolReserves(client as any, pool);
  const poolAsset1IsUsdc = (pool as any).asset1ID === USDC_ASA_ID;

  // decimals: { assetIn: LP decimals (6), assetOut: USDC decimals (6) }
  const decimals = poolAsset1IsUsdc
    ? { assetIn: 6, assetOut: 6 }
    : { assetIn: asaDecimals, assetOut: 6 };

  const quote = RemoveLiquidity.v2.getSingleAssetRemoveLiquidityQuote({
    pool,
    reserves,
    poolTokenIn: lpAmount,
    assetOutID: USDC_ASA_ID,
    decimals,
  } as any) as any;

  return {
    usdcOut: BigInt(quote?.assetOut?.amount ?? 0n),
    priceImpact: Number(quote?.internalSwapQuote?.priceImpact ?? 0),
  };
}

export async function removeLiquidityToUsdc(params: {
  asaId: number;
  asaDecimals: number;
  lpAmount: bigint;
  slippage?: number;
  initiatorAddr: string;
  signTransactions: (txns: Uint8Array[]) => Promise<(Uint8Array | null)[]>;
}): Promise<{ usdcReceived: bigint }> {
  const { asaId, asaDecimals, lpAmount, slippage = 0.005, initiatorAddr, signTransactions } = params;
  const pool = await getPool(asaId);
  const client = getAlgodClient();
  const reserves = await poolUtils.v2.getPoolReserves(client as any, pool);
  const poolAsset1IsUsdc = (pool as any).asset1ID === USDC_ASA_ID;

  const decimals = poolAsset1IsUsdc
    ? { assetIn: 6, assetOut: 6 }
    : { assetIn: asaDecimals, assetOut: 6 };

  const quote = RemoveLiquidity.v2.getSingleAssetRemoveLiquidityQuote({
    pool,
    reserves,
    poolTokenIn: lpAmount,
    assetOutID: USDC_ASA_ID,
    decimals,
  } as any) as any;

  const minUsdcOut: bigint = BigInt(quote?.assetOut?.amount ?? 0n);

  const txGroup = await RemoveLiquidity.v2.generateSingleAssetOutTxns({
    client: client as any,
    pool,
    initiatorAddr,
    poolTokenIn: lpAmount,
    outputAssetId: USDC_ASA_ID,
    minOutputAssetAmount: minUsdcOut,
    slippage,
  } as any);

  const initiatorSigner: InitiatorSigner = async (txGroupList) => {
    const flat = txGroupList.flat();
    const encoded = flat.map(({ txn }) => (txn as any).toByte() as Uint8Array);
    const walletSigned = await signTransactions(encoded);
    if (walletSigned.some((s) => !s)) throw new Error('Wallet declined to sign.');
    return walletSigned.map((s) => s as Uint8Array);
  };

  const signedTxns = await RemoveLiquidity.v2.signTxns({ txGroup, initiatorSigner } as any);
  const result = await RemoveLiquidity.v2.execute({ client: client as any, txGroup, signedTxns } as any) as any;

  const usdcReceived: bigint = BigInt(
    result?.outputAssets?.find((a: any) => Number(a.id) === USDC_ASA_ID)?.amount ?? minUsdcOut
  );
  return { usdcReceived };
}
