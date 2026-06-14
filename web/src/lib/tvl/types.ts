import type { Address } from "viem";

import type { PriceQuote } from "@/lib/prices/types";

export type TvlCommitmentContribution = {
  signer: Address;
  amount0: string;
  amount1: string;
  token0UsdE18: string;
  token1UsdE18: string;
  totalUsdE18: string;
  orderIndex: number;
};

export type PetitionTvl = {
  petitionId: string;
  contractPetitionId: string | null;
  pair: string;
  token0Symbol: string;
  token1Symbol: string;
  tokenDecimals: {
    token0: 18;
    token1: 18;
  };
  thresholdUsdE18: string;
  totalUsdE18: string;
  totalUsdFormatted: string;
  progressBps: number;
  rawProgressBps: string;
  isThresholdMet: boolean;
  commitmentCount: number;
  prices: {
    token0: PriceQuote;
    token1: PriceQuote;
  };
  commitments: TvlCommitmentContribution[];
  notes: string[];
};
