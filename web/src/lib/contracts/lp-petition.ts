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
    type: "event",
    name: "Signed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "signer", type: "address", indexed: true },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
    ],
  },
] as const;
