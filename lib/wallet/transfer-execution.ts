import { erc20Abi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import type { ExecutionPlan } from "@/lib/transfers/execution";
import { BOT_MAINNET, BOT_TESTNET } from "@/lib/chains/registry";

export type ApprovalState = "checking_allowance" | "approval_required" | "awaiting_token_approval" | "approval_confirming" | "payment_ready";

export async function prepareTokenAllowance(args: {
  plan: ExecutionPlan;
  readAllowance: (chainId: number, token: Address, owner: Address, spender: Address) => Promise<bigint>;
  approveExact?: (chainId: number, token: Address, spender: Address, amount: bigint) => Promise<Hex>;
  wait: (hash: Hex) => Promise<{ status: string }>;
  revalidate: () => Promise<void>;
  onState: (state: ApprovalState) => void;
}) {
  const { plan } = args;
  if (!plan.token) return;
  args.onState("checking_allowance");
  const amount = BigInt(plan.amountBaseUnits);
  if (await args.readAllowance(plan.chainId, plan.token, plan.payer, plan.to) < amount) {
    args.onState("approval_required");
    if (!args.approveExact) return;
    args.onState("awaiting_token_approval");
    const hash = await args.approveExact(plan.chainId, plan.token, plan.to, amount);
    args.onState("approval_confirming");
    if ((await args.wait(hash)).status !== "success") throw new Error("Token approval failed. No payment was submitted.");
  }
  await args.revalidate();
  args.onState("payment_ready");
}

export function createTokenApprovalControls(plan: ExecutionPlan, client: PublicClient, wallet: WalletClient, revalidate: () => Promise<void>) {
  const check = async (chainId: number) => {
    if (chainId !== plan.chainId || await client.getChainId() !== chainId || await wallet.getChainId() !== chainId || (await wallet.getAddresses())[0]?.toLowerCase() !== plan.payer.toLowerCase()) throw new Error("Wallet, token network or owner changed. Review again.");
  };
  return {
    plan,
    readAllowance: async (chainId: number, token: Address, owner: Address, spender: Address) => {
      await check(chainId);
      return client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
    },
    approveExact: async (chainId: number, token: Address, spender: Address, amount: bigint) => {
      await check(chainId);
      await revalidate();
      if (chainId !== 677 && chainId !== 968) throw new Error("Unsupported token network.");
      return wallet.writeContract({ account: plan.payer, chain: chainId === 677 ? BOT_MAINNET : BOT_TESTNET, address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
    },
    wait: (hash: Hex) => client.waitForTransactionReceipt({ hash, timeout: 120_000 }),
    revalidate,
  };
}
