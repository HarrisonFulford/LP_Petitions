import { defineChain } from "viem";

import { runtimeConfig } from "@/lib/runtime-config";

export const baseSepoliaChain = defineChain({
  id: runtimeConfig.chainId,
  name: runtimeConfig.chainName,
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || runtimeConfig.rpc.fallbackUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "BaseScan",
      url: runtimeConfig.explorerUrl,
    },
  },
  testnet: true,
});
