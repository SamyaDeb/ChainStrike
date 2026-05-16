/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@chainstrike/types'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3003',
    NEXT_PUBLIC_USDC_ASA_ID: process.env.NEXT_PUBLIC_USDC_ASA_ID ?? '10458941',
    NEXT_PUBLIC_ALGOD_SERVER: process.env.NEXT_PUBLIC_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud',
    NEXT_PUBLIC_ALGOD_PORT: process.env.NEXT_PUBLIC_ALGOD_PORT ?? '443',
    NEXT_PUBLIC_PLATFORM_ADDRESS: process.env.NEXT_PUBLIC_PLATFORM_ADDRESS ?? '',
  },
  async rewrites() {
    const IDENTITY = 'http://localhost:3001';
    const ASSET = 'http://localhost:3002';
    return [
      { source: '/api/v1/auth/:path*',      destination: `${IDENTITY}/auth/:path*` },
      { source: '/api/v1/users/:path*',     destination: `${IDENTITY}/users/:path*` },
      { source: '/api/v1/kyc/:path*',       destination: `${IDENTITY}/kyc/:path*` },
      { source: '/api/v1/kyb/:path*',       destination: `${IDENTITY}/kyb/:path*` },
      { source: '/api/v1/wallets/:path*',   destination: `${IDENTITY}/wallets/:path*` },
      { source: '/api/v1/assets/:path*',    destination: `${ASSET}/assets/:path*` },
      { source: '/api/v1/documents/:path*', destination: `${ASSET}/documents/:path*` },
    ];
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Pera Wallet uses browser APIs — stub on server
      config.resolve.alias['@perawallet/connect'] = false;
    }
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default nextConfig;
