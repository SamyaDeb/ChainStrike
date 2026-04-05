/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile wallet-related packages for proper ESM/CJS handling
  transpilePackages: [
    '@txnlab/use-wallet-react',
    '@txnlab/use-wallet',
    '@perawallet/connect',
    '@blockshake/defly-connect',
    '@walletconnect/modal',
    '@walletconnect/sign-client',
    '@web3auth/modal',
    'lute-connect',
  ],

  // Experimental optimizations
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-dialog',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      'date-fns',
    ],
  },

  // Compiler optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },

  // Bundle optimization - fix webpack fallbacks
  webpack: (config, { isServer }) => {
    // Webpack fallbacks for Node.js polyfills (browser builds only)
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        stream: false,
        buffer: false,
        util: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        net: false,
        tls: false,
        child_process: false,
        readline: false,
        'pino-pretty': false, // pino-pretty is optional, not needed in browser
      };

      // Fix for ESM modules that don't properly declare exports
      config.resolve.extensionAlias = {
        '.js': ['.ts', '.tsx', '.js', '.jsx'],
        '.mjs': ['.mts', '.mjs'],
        '.cjs': ['.cts', '.cjs'],
      };
    }

    // Ignore specific modules that cause build warnings
    config.ignoreWarnings = [
      { module: /@react-native-async-storage/ },
      { module: /@metamask\/sdk/ },
      { message: /Can't resolve 'pino-pretty'/ },
      { module: /pino-pretty/ },
      { module: /@walletconnect/ },
      { module: /@web3auth/ },
    ];

    return config;
  },

  // Image optimization
  images: {
    formats: ['image/webp'],
    minimumCacheTTL: 60,
    dangerouslyAllowSVG: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },

  // Enable static optimization
  trailingSlash: false,
  generateEtags: true,
  compress: true,

  // Production optimizations
  poweredByHeader: false,

  // Logging
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
};

export default nextConfig;
