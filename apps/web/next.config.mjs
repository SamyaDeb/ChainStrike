import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tinyman SDK v4 is built against algosdk v2 and decodes pool/account state
// assuming the v2 `.do()` response shape. The repo's root algosdk is v3, whose
// responses break Tinyman's decoders ("Cannot read properties of undefined").
// Point `algosdk-v2` at the algosdk v2 bundled inside the Tinyman SDK so the
// swap path constructs a client matching what Tinyman expects.
const ALGOSDK_V2 = path.resolve(
  __dirname,
  '../../node_modules/@tinymanorg/tinyman-js-sdk/node_modules/algosdk',
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@chainstrike/types'],
  webpack: (config) => {
    // @txnlab/use-wallet dynamically imports web3auth packages as optional adapters.
    // We don't use Web3Auth — stub them so webpack doesn't crash on resolution.
    config.resolve.alias['@web3auth/modal'] = false;
    config.resolve.alias['@web3auth/base'] = false;
    config.resolve.alias['@web3auth/base-provider'] = false;
    config.resolve.alias['@web3auth/single-factor-auth'] = false;
    config.resolve.alias['algosdk-v2'] = ALGOSDK_V2;
    return config;
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3003',
    NEXT_PUBLIC_ALGORAND_NETWORK: process.env.NEXT_PUBLIC_ALGORAND_NETWORK ?? 'testnet',
    NEXT_PUBLIC_WC_PROJECT_ID: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '',
    NEXT_PUBLIC_DEV_SKIP_ESCROW: process.env.NEXT_PUBLIC_DEV_SKIP_ESCROW ?? 'true',
    NEXT_PUBLIC_ESCROW_ADDRESS: process.env.NEXT_PUBLIC_ESCROW_ADDRESS ?? 'HMPG7YLTESN4FQXIGCAHQOXDEIDUIFBOINJDGQ7WUFBTYMOIKDIN6CITPM',
    NEXT_PUBLIC_USDC_ASA_ID: process.env.NEXT_PUBLIC_USDC_ASA_ID ?? '10458941',
    NEXT_PUBLIC_ALGORAND_ALGOD_SERVER: process.env.NEXT_PUBLIC_ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud',
    NEXT_PUBLIC_ALGORAND_ALGOD_PORT: process.env.NEXT_PUBLIC_ALGORAND_ALGOD_PORT ?? '443',
    NEXT_PUBLIC_ALGORAND_ALGOD_TOKEN: process.env.NEXT_PUBLIC_ALGORAND_ALGOD_TOKEN ?? '',
  },
};

export default nextConfig;
