import { getAddress, parseEventLogs, type Address, type Hex } from "viem";

import { lpPetitionAbi } from "@/lib/contracts/lp-petition";
import { runtimeConfig } from "@/lib/runtime-config";
import { getBaseSepoliaPublicClient } from "@/lib/web3/public-client";
import { ValidationError } from "./validation";

export type VerifySignedEventInput = {
  contractPetitionId: string;
  signer: Address;
  amount0: string;
  amount1: string;
  txHash: Hex;
};

export async function verifySignedEvent(input: VerifySignedEventInput) {
  const lpPetitionAddress = runtimeConfig.pendingContracts.lpPetition;
  if (!lpPetitionAddress) {
    throw new ValidationError("LP Petition contract address is not configured");
  }

  const client = getBaseSepoliaPublicClient();
  let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;

  try {
    receipt = await client.getTransactionReceipt({ hash: input.txHash });
  } catch {
    throw new ValidationError("transaction receipt was not found; wait for confirmation and retry");
  }

  if (receipt.status !== "success") {
    throw new ValidationError("transaction did not succeed");
  }

  const expectedContract = getAddress(lpPetitionAddress);
  const expectedSigner = getAddress(input.signer);
  const expectedPetitionId = BigInt(input.contractPetitionId);
  const expectedAmount0 = BigInt(input.amount0);
  const expectedAmount1 = BigInt(input.amount1);

  const signedLogs = parseEventLogs({
    abi: lpPetitionAbi,
    eventName: "Signed",
    logs: receipt.logs,
  });

  const matchingLog = signedLogs.find((log) => {
    const args = log.args;
    return (
      getAddress(log.address) === expectedContract &&
      args.id === expectedPetitionId &&
      getAddress(args.signer) === expectedSigner &&
      args.amount0 === expectedAmount0 &&
      args.amount1 === expectedAmount1
    );
  });

  if (!matchingLog) {
    throw new ValidationError("transaction receipt does not contain the expected Signed event");
  }

  return {
    blockNumber: receipt.blockNumber.toString(),
    transactionHash: receipt.transactionHash,
  };
}
