/**
 * B1 — Read-only BOT Chain clients on the existing viem stack.
 *
 * No signing, no transfers. Runtime chain-ID verification and token metadata
 * reads are graceful: they return error shapes, never throw on RPC failure.
 * Client-safe — no secrets.
 */

import {
  createPublicClient,
  http,
  isAddress,
  type Address,
  type PublicClient,
} from "viem";
import {
  BOT_MAINNET,
  BOT_MAINNET_RPC_URL,
  BOT_TESTNET,
  BOT_TESTNET_RPC_URL,
} from "@/lib/chains/registry";

const RPC_TIMEOUT_MS = 10_000;

const erc20MetadataAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

export function getBotTestnetClient(rpcUrl: string = BOT_TESTNET_RPC_URL) {
  return createPublicClient({
    chain: BOT_TESTNET,
    transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS }),
  });
}

export function getBotMainnetClient(rpcUrl: string = BOT_MAINNET_RPC_URL) {
  return createPublicClient({
    chain: BOT_MAINNET,
    transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS }),
  });
}

export type RpcChainIdVerification =
  | { ok: true; expectedChainId: number; actualChainId: number }
  | { ok: false; expectedChainId: number; actualChainId: number | null; error: string };

/** Runtime check that the RPC endpoint serves the expected chain. */
export async function verifyRpcChainId(
  client: Pick<PublicClient, "getChainId">,
  expectedChainId: number,
): Promise<RpcChainIdVerification> {
  let actualChainId: number | null = null;
  try {
    actualChainId = await client.getChainId();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, expectedChainId, actualChainId, error: `RPC_ERROR: ${msg}` };
  }
  if (actualChainId !== expectedChainId) {
    return {
      ok: false,
      expectedChainId,
      actualChainId,
      error: `CHAIN_ID_MISMATCH: expected ${expectedChainId}, got ${actualChainId}`,
    };
  }
  return { ok: true, expectedChainId, actualChainId };
}

export type Erc20MetadataResult =
  | {
      hasCode: boolean;
      decimals: number | null;
      symbol: string | null;
      name: string | null;
      error: null;
    }
  | {
      hasCode: boolean;
      decimals: null;
      symbol: null;
      name: null;
      error: string;
    };

/**
 * Reads contract code + token metadata where public RPC access permits.
 * `hasCode === false` or `error !== null` means unverified — callers must
 * not assume decimals in that case.
 */
export async function fetchErc20Metadata(
  client: Pick<PublicClient, "getBytecode" | "readContract">,
  address: string,
): Promise<Erc20MetadataResult> {
  if (!isAddress(address)) {
    return {
      hasCode: false,
      decimals: null,
      symbol: null,
      name: null,
      error: "INVALID_ADDRESS",
    };
  }
  const token = address as Address;
  try {
    const code = await client.getBytecode({ address: token });
    if (code === undefined || code === "0x") {
      return {
        hasCode: false,
        decimals: null,
        symbol: null,
        name: null,
        error: "NO_CONTRACT_CODE",
      };
    }
    const [decimals, symbol, name] = await Promise.all([
      client.readContract({ address: token, abi: erc20MetadataAbi, functionName: "decimals" }),
      client.readContract({ address: token, abi: erc20MetadataAbi, functionName: "symbol" }),
      client.readContract({ address: token, abi: erc20MetadataAbi, functionName: "name" }),
    ]);
    return {
      hasCode: true,
      decimals: Number(decimals),
      symbol: String(symbol),
      name: String(name),
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      hasCode: false,
      decimals: null,
      symbol: null,
      name: null,
      error: `RPC_ERROR: ${msg}`,
    };
  }
}
