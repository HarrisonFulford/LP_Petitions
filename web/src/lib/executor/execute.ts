import { parseEventLogs, type Hex } from "viem";

import { lpPetitionAbi } from "@/lib/contracts/lp-petition";
import { getPetitionStore } from "@/lib/petitions/store";
import type { PetitionDetail } from "@/lib/petitions/types";
import { computePetitionTvl } from "@/lib/tvl/service";
import { runtimeConfig } from "@/lib/runtime-config";
import { buildBalancingSwapCalls } from "@/lib/uniswap/swap-api";
import { getExecutorWalletClient } from "@/lib/web3/executor-client";
import { getBaseSepoliaPublicClient } from "@/lib/web3/public-client";

export type ExecuteOutcome =
  | { status: "executed"; txHash: Hex; poolId?: string; totalUsdE18?: string }
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string };

type GlobalWithExec = typeof globalThis & { __lpExecLocks?: Set<string> };

/// In-process idempotency lock. Best-effort within one serverless instance; the
/// contract's single-execution guard is the authoritative cross-instance guarantee
/// (a concurrent/duplicate execute() simply reverts PetitionNotOpen).
function getLockSet() {
  const g = globalThis as GlobalWithExec;
  g.__lpExecLocks ??= new Set();
  return g.__lpExecLocks;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Attempt to execute a petition if it has crossed threshold. Safe to call from the
 * reactive path (after commit) and the cron sweep concurrently — duplicate attempts
 * are de-duped by the in-process lock and ultimately by the on-chain single-exec
 * guard. The backend TVL is only a trigger heuristic; the contract re-verifies TVL
 * on-chain via Chainlink inside execute().
 */
export async function maybeExecutePetition(detail: PetitionDetail): Promise<ExecuteOutcome> {
  const { petition } = detail;

  if (petition.status !== "open") return { status: "skipped", reason: "petition not open" };
  if (!petition.contractPetitionId) return { status: "skipped", reason: "no contractPetitionId" };

  const lpAddress = runtimeConfig.pendingContracts.lpPetition;
  if (!lpAddress) return { status: "skipped", reason: "LPPetition address not configured" };

  // Backend TVL heuristic (avoids spending gas on an obviously-early attempt).
  try {
    const tvl = await computePetitionTvl(detail);
    if (!tvl.isThresholdMet) return { status: "skipped", reason: "below threshold (backend)" };
  } catch (error) {
    return { status: "skipped", reason: `tvl unavailable: ${errorMessage(error)}` };
  }

  const wallet = getExecutorWalletClient();
  if (!wallet) return { status: "skipped", reason: "EXECUTOR_PRIVATE_KEY not set" };

  const lock = getLockSet();
  const lockKey = `${lpAddress.toLowerCase()}:${petition.contractPetitionId}`;
  if (lock.has(lockKey)) return { status: "skipped", reason: "execute already in flight" };
  lock.add(lockKey);

  try {
    const id = BigInt(petition.contractPetitionId);
    const calls = await buildBalancingSwapCalls({
      contractPetitionId: petition.contractPetitionId,
      token0: petition.token0Address ?? (`0x${"0".repeat(40)}` as const),
      token1: petition.token1Address ?? (`0x${"0".repeat(40)}` as const),
      fee: petition.fee,
    });

    const publicClient = getBaseSepoliaPublicClient();

    // Simulate first so on-chain reverts (below threshold, already executed) become
    // clean skips instead of wasted gas.
    const { request } = await publicClient.simulateContract({
      address: lpAddress,
      abi: lpPetitionAbi,
      functionName: "execute",
      args: [id, calls],
      account: wallet.account,
    });

    const txHash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return { status: "error", error: `execute reverted (${txHash})` };
    }

    await getPetitionStore().markExecuted(petition.id).catch(() => undefined);

    let poolId: string | undefined;
    let totalUsdE18: string | undefined;
    const executedLogs = parseEventLogs({
      abi: lpPetitionAbi,
      eventName: "Executed",
      logs: receipt.logs,
    });
    if (executedLogs[0]) {
      poolId = executedLogs[0].args.poolId as string;
      totalUsdE18 = (executedLogs[0].args.totalUsdE18 as bigint).toString();
    }

    return { status: "executed", txHash, poolId, totalUsdE18 };
  } catch (error) {
    const message = errorMessage(error);
    if (message.includes("BelowThreshold")) {
      return { status: "skipped", reason: "below threshold (on-chain)" };
    }
    if (message.includes("PetitionNotOpen")) {
      return { status: "skipped", reason: "already executed on-chain" };
    }
    return { status: "error", error: message };
  } finally {
    lock.delete(lockKey);
  }
}

export type SweepResult = {
  checked: number;
  results: Array<{ petitionId: string; contractPetitionId: string | null } & ExecuteOutcome>;
};

/// Re-check all open petitions and execute any that have crossed threshold. Backs the
/// Vercel Cron safety net for price-driven crossings the reactive path misses.
export async function runSweep(): Promise<SweepResult> {
  const store = getPetitionStore();
  const petitions = await store.listPetitions();
  const open = petitions.filter((p) => p.status === "open" && p.contractPetitionId);

  const results: SweepResult["results"] = [];
  for (const petition of open) {
    const detail = await store.getPetition(petition.id);
    if (!detail) continue;
    const outcome = await maybeExecutePetition(detail);
    results.push({
      petitionId: petition.id,
      contractPetitionId: petition.contractPetitionId,
      ...outcome,
    });
  }

  return { checked: open.length, results };
}
