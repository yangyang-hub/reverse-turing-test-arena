import { defineChain } from "viem";
import * as chains from "viem/chains";

export type BaseConfig = {
  targetNetworks: readonly chains.Chain[];
  pollingInterval: number;
  alchemyApiKey: string;
  rpcOverrides?: Record<number, string>;
  walletConnectProjectId: string;
  onlyLocalBurnerWallet: boolean;
};

export type ScaffoldConfig = BaseConfig;

export const DEFAULT_ALCHEMY_API_KEY = "cR4WnXePioePZ5fFrnSiR";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: {
    name: "MON",
    symbol: "MON",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://testnet-rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: "https://testnet.monadexplorer.com",
    },
  },
  testnet: true,
});

const isDev = process.env.NEXT_PUBLIC_NETWORK_ENV !== "production";

const localMonad = defineChain({
  ...chains.foundry,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
});

const devNetworks = [localMonad] as const;
const prodNetworks = [monadTestnet] as const;

// Allow LAN devices to reach Anvil via NEXT_PUBLIC_ANVIL_RPC_URL (e.g. http://192.168.31.5:8545)
const rpcOverrides: Record<number, string> = {};
if (isDev && process.env.NEXT_PUBLIC_ANVIL_RPC_URL) {
  rpcOverrides[chains.foundry.id] = process.env.NEXT_PUBLIC_ANVIL_RPC_URL;
}

const scaffoldConfig = {
  targetNetworks: isDev ? devNetworks : prodNetworks,
  pollingInterval: isDev ? 1000 : 3000,
  alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || DEFAULT_ALCHEMY_API_KEY,
  rpcOverrides,
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "3a8170812b534d0ff9d794f19a901d64",
  onlyLocalBurnerWallet: false,
} as const satisfies ScaffoldConfig;

export default scaffoldConfig;
