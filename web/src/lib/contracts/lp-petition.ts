export const lpPetitionAbi = [
  {
    type: "function",
    name: "sign",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getCommitment",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "signer", type: "address" },
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getPetition",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "thresholdUsdE18", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "hypotheticalTvlUsdE18",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isThresholdMet",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "calls", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Signed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "signer", type: "address", indexed: true },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Executed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "totalUsdE18", type: "uint256", indexed: false },
      { name: "poolId", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PositionMinted",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "signer", type: "address", indexed: true },
      { name: "positionTokenId", type: "uint256", indexed: false },
    ],
  },
] as const;
