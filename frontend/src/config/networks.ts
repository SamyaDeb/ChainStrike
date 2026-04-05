// Network configurations
export const NETWORKS = {
  testnet: {
    name: "TestNet",
    algodServer: "https://testnet-api.algonode.cloud",
    indexerServer: "https://testnet-idx.algonode.cloud",
    algodPort: 443,
    algodToken: "",
  },
  mainnet: {
    name: "MainNet",
    algodServer: "https://mainnet-api.algonode.cloud",
    indexerServer: "https://mainnet-idx.algonode.cloud",
    algodPort: 443,
    algodToken: "",
  },
  localnet: {
    name: "LocalNet",
    algodServer: "http://localhost",
    indexerServer: "http://localhost",
    algodPort: 4001,
    indexerPort: 8980,
    algodToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
} as const;

export type NetworkName = keyof typeof NETWORKS;

// Current active network
export const ACTIVE_NETWORK: NetworkName = 
  (process.env.NEXT_PUBLIC_ALGORAND_NETWORK as NetworkName) || "testnet";

export const CURRENT_NETWORK = NETWORKS[ACTIVE_NETWORK];

// Explorer URLs
export const EXPLORER_URLS = {
  testnet: {
    address: (addr: string) => `https://testnet.explorer.perawallet.app/address/${addr}`,
    transaction: (txId: string) => `https://testnet.explorer.perawallet.app/tx/${txId}`,
    tx: (txId: string) => `https://testnet.explorer.perawallet.app/tx/${txId}`,
    asset: (id: number) => `https://testnet.explorer.perawallet.app/asset/${id}`,
    application: (id: number) => `https://testnet.explorer.perawallet.app/application/${id}`,
  },
  mainnet: {
    address: (addr: string) => `https://explorer.perawallet.app/address/${addr}`,
    transaction: (txId: string) => `https://explorer.perawallet.app/tx/${txId}`,
    tx: (txId: string) => `https://explorer.perawallet.app/tx/${txId}`,
    asset: (id: number) => `https://explorer.perawallet.app/asset/${id}`,
    application: (id: number) => `https://explorer.perawallet.app/application/${id}`,
  },
  localnet: {
    address: (addr: string) => `http://localhost:4001/address/${addr}`,
    transaction: (txId: string) => `http://localhost:4001/tx/${txId}`,
    tx: (txId: string) => `http://localhost:4001/tx/${txId}`,
    asset: (id: number) => `http://localhost:4001/asset/${id}`,
    application: (id: number) => `http://localhost:4001/application/${id}`,
  },
} as const;

export const EXPLORER = EXPLORER_URLS[ACTIVE_NETWORK];
