import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { runtimeConfig } from "@/lib/runtime-config";
import { baseSepoliaChain } from "./chains";

/// Server-only RPC for the executor (private key path). Prefer the non-public RPC
/// so an authenticated provider URL is never shipped to the browser.
function serverRpcUrl() {
  return (
    process.env.BASE_SEPOLIA_RPC_URL ||
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ||
    runtimeConfig.rpc.fallbackUrl
  );
}

/// The executor account derived from EXECUTOR_PRIVATE_KEY (server-only). Returns
/// null when unset so callers can cleanly skip rather than crash.
export function getExecutorAccount() {
  const key = process.env.EXECUTOR_PRIVATE_KEY;
  if (!key) return null;
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  return privateKeyToAccount(normalized as `0x${string}`);
}

/// Wallet client used to submit `execute()`. Null when no executor key is configured.
export function getExecutorWalletClient() {
  const account = getExecutorAccount();
  if (!account) return null;
  return createWalletClient({
    account,
    chain: baseSepoliaChain,
    transport: http(serverRpcUrl()),
  });
}
