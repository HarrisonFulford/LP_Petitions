import { getAddress, isAddress, type Address } from "viem";

export type RuntimeConfig = {
  appName: string;
  environment: "base-sepolia";
  chainId: 84532;
  chainName: "Base Sepolia";
  rpc: {
    envVar: "NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL";
    fallbackUrl: "https://sepolia.base.org";
  };
  explorerUrl: "https://sepolia.basescan.org";
  pair: {
    label: "SPCX/WETH";
    token0Symbol: "SPCX";
    token1Symbol: "WETH";
  };
  defaultFeeTier: {
    value: 3000;
    label: "0.30%";
    basisPoints: 30;
  };
  contracts: {
    permit2: Address;
    weth9: Address;
    chainlinkEthUsd: Address;
    uniswapV4: {
      poolManager: Address;
      positionManager: Address;
      universalRouter: Address;
      stateView: Address;
    };
  };
  pendingContracts: {
    lpPetition: Address | null;
    mockSpcx: Address | null;
    mockSpcxUsdAggregator: Address | null;
  };
  notes: string[];
};

function optionalPublicAddress(value: string | undefined): Address | null {
  if (!value || !isAddress(value)) return null;
  return getAddress(value);
}

export const runtimeConfig = {
  appName: "LP Petitions",
  environment: "base-sepolia",
  chainId: 84532,
  chainName: "Base Sepolia",
  rpc: {
    envVar: "NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL",
    fallbackUrl: "https://sepolia.base.org",
  },
  explorerUrl: "https://sepolia.basescan.org",
  pair: {
    label: "SPCX/WETH",
    token0Symbol: "SPCX",
    token1Symbol: "WETH",
  },
  defaultFeeTier: {
    value: 3000,
    label: "0.30%",
    basisPoints: 30,
  },
  contracts: {
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    weth9: "0x4200000000000000000000000000000000000006",
    chainlinkEthUsd: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
    uniswapV4: {
      poolManager: "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",
      positionManager: "0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80",
      universalRouter: "0x492E6456D9528771018DeB9E87ef7750EF184104",
      stateView: "0x571291b572ed32ce6751a2cb2486ebee8defb9b4",
    },
  },
  pendingContracts: {
    lpPetition: optionalPublicAddress(process.env.NEXT_PUBLIC_LP_PETITION_ADDRESS),
    mockSpcx: optionalPublicAddress(process.env.NEXT_PUBLIC_MOCK_SPCX_ADDRESS),
    mockSpcxUsdAggregator: optionalPublicAddress(
      process.env.NEXT_PUBLIC_MOCK_SPCX_USD_AGGREGATOR_ADDRESS,
    ),
  },
  notes: [
    "Public-safe config only: no private RPC URLs, API keys, or executor secrets.",
    "Mock SPCX, mock SPCX/USD aggregator, and LPPetition addresses come from NEXT_PUBLIC_* deployment env vars.",
    "Address source of truth: implementation_plan.md Reference Addresses & Endpoints section.",
  ],
} as const satisfies RuntimeConfig;

export function getPublicRuntimeConfig(): RuntimeConfig {
  return runtimeConfig;
}
