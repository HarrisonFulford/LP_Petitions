import type { Address, Hex } from "viem";

export type PetitionStatus = "open" | "executed";

export type PetitionRecord = {
  id: string;
  contractPetitionId: string | null;
  title: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Address: Address | null;
  token1Address: Address | null;
  fee: number;
  thresholdUsdE18: string;
  status: PetitionStatus;
  commitmentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CommitmentRecord = {
  id: string;
  petitionId: string;
  signer: Address;
  amount0: string;
  amount1: string;
  txHash: Hex | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type PetitionDetail = {
  petition: PetitionRecord;
  commitments: CommitmentRecord[];
};

export type CreatePetitionInput = {
  contractPetitionId?: string | null;
  title: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Address?: Address | null;
  token1Address?: Address | null;
  fee: number;
  thresholdUsdE18: string;
};

export type UpsertCommitmentInput = {
  signer: Address;
  amount0: string;
  amount1: string;
  txHash?: Hex | null;
};

export type ConfirmCommitmentInput = {
  contractPetitionId: string;
  signer: Address;
  amount0: string;
  amount1: string;
  txHash: Hex;
};

export type PetitionStore = {
  listPetitions(): Promise<PetitionRecord[]>;
  createPetition(input: CreatePetitionInput): Promise<PetitionRecord>;
  getPetition(id: string): Promise<PetitionDetail | null>;
  upsertCommitment(
    petitionId: string,
    input: UpsertCommitmentInput,
  ): Promise<PetitionDetail | null>;
};
