import type { Address, Hex } from "viem";

export type BalancingSwapParams = {
  contractPetitionId: string;
  token0: Address;
  token1: Address;
  fee: number;
};

/// Whether a Uniswap Developer Platform API key is configured.
export function hasUniswapApiKey() {
  return Boolean(process.env.UNISWAP_API_KEY);
}

/**
 * Optional Uniswap Swap-API (UniversalRouter) calldata to balance the contract's
 * pulled holdings toward the pool ratio before minting. The contract executes each
 * returned blob against the UniversalRouter, bounded by its Chainlink
 * value-conservation guard (`maxSwapSlippageBps`), so a bad swap simply reverts.
 *
 * Demo/MVP path: the pool is created at the Chainlink-derived ratio, so proportional
 * commitments need no rebalance and we return `[]` (the contract mints directly).
 * The Uniswap Swap API integration (fetch `/quote` + `/swap`, encode UniversalRouter
 * calldata) plugs in here and activates only when `UNISWAP_API_KEY` is set AND a
 * rebalance is actually needed; until that calldata path is validated against the
 * deployed UniversalRouter it stays disabled so `execute()` cannot be bricked by an
 * unverified swap blob.
 */
export async function buildBalancingSwapCalls(params: BalancingSwapParams): Promise<Hex[]> {
  // Integration point: when UNISWAP_API_KEY is set, fetch /quote + /swap for
  // params.token0 / params.token1 / params.fee and return UniversalRouter calldata.
  // Kept disabled until that calldata is validated against the deployed router.
  void params;
  return [];
}
