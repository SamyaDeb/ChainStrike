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
    return config;
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3003',
    NEXT_PUBLIC_ALGORAND_NETWORK: process.env.NEXT_PUBLIC_ALGORAND_NETWORK ?? 'testnet',
    NEXT_PUBLIC_WC_PROJECT_ID: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '',
    NEXT_PUBLIC_DEV_SKIP_ESCROW: process.env.NEXT_PUBLIC_DEV_SKIP_ESCROW ?? '',
  },
};

export default nextConfig;
