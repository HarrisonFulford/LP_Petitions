import { createPublicClient, http } from "viem";

import { runtimeConfig } from "@/lib/runtime-config";
import { baseSepoliaChain } from "./chains";

let publicClient: ReturnType<typeof createPublicClient> | null = null;

export function getBaseSepoliaPublicClient() {
  publicClient ??= createPublicClient({
    chain: baseSepoliaChain,
    transport: http(
      process.env.BASE_SEPOLIA_RPC_URL ||
        process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ||
        runtimeConfig.rpc.fallbackUrl,
    ),
  });
  return publicClient;
}
