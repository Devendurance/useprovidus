/** Minimal ERC-20 ABI: balanceOf + transfer only. No approve / transferFrom. */

export const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

/** Direct ERC-20 transfer — user wallet is msg.sender (no approval). */
export const erc20TransferAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** ERC-20 Transfer event ABI for server-side deposit verification. */
export const erc20TransferEventAbi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
] as const;

export const erc20Abi = [
  ...erc20BalanceOfAbi,
  ...erc20TransferAbi,
  ...erc20TransferEventAbi,
] as const;
