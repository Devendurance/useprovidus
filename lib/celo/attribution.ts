import { concat, encodeFunctionData, type Address, type Hex } from "viem";
import { fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { erc20TransferAbi } from "@/lib/wallet/erc20";

/**
 * Active on-chain attribution tag for Celo Agents at Work hackathon.
 * Derived from GitHub slug Devendurance/useprovidus.
 */
export const ACTIVE_CELO_ATTRIBUTION_TAG = "celo_8190b99392a2" as const;

/**
 * Obsolete tag from previous hackathon (Agentic Payments and DeFAI).
 * MUST NOT be used for new Agents at Work transactions.
 */
export const OBSOLETE_CELO_ATTRIBUTION_TAG = "celo_91fed90b97fc" as const;

const TAG_REGEX = /^celo_[0-9a-f]{12}$/;

/**
 * Resolves and validates the active hackathon attribution tag.
 * Rejects missing tags, obsolete tags, and invalid formats.
 */
export function resolveActiveAttributionTag(): string {
  const envTag = process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG?.trim();
  const candidate = envTag && envTag !== "" ? envTag : ACTIVE_CELO_ATTRIBUTION_TAG;

  if (candidate === OBSOLETE_CELO_ATTRIBUTION_TAG) {
    throw new Error(
      `Obsolete attribution tag "${candidate}" detected. Must use active tag "${ACTIVE_CELO_ATTRIBUTION_TAG}".`,
    );
  }

  if (!TAG_REGEX.test(candidate)) {
    throw new Error(
      `Invalid Celo attribution tag format: "${candidate}". Must match celo_ + 12 hex characters.`,
    );
  }

  if (candidate !== ACTIVE_CELO_ATTRIBUTION_TAG) {
    throw new Error(
      `Attribution tag mismatch: got "${candidate}", expected active hackathon tag "${ACTIVE_CELO_ATTRIBUTION_TAG}".`,
    );
  }

  return candidate;
}

/**
 * Encodes standard ERC-20 transfer calldata and appends the ERC-8021 attribution suffix.
 */
export function buildTaggedTransferCalldata(
  recipient: Address,
  value: bigint,
  tagOverride?: string,
): Hex {
  const tag = tagOverride ? tagOverride.trim() : resolveActiveAttributionTag();

  if (tag === OBSOLETE_CELO_ATTRIBUTION_TAG) {
    throw new Error(
      `Obsolete attribution tag "${tag}" detected. Must use active tag "${ACTIVE_CELO_ATTRIBUTION_TAG}".`,
    );
  }

  if (!TAG_REGEX.test(tag)) {
    throw new Error(`Invalid attribution tag format: "${tag}"`);
  }

  const baseCalldata = encodeFunctionData({
    abi: erc20TransferAbi,
    functionName: "transfer",
    args: [recipient, value],
  });

  const suffix = toDataSuffix(tag);
  return concat([baseCalldata, suffix]);
}

/**
 * Inspects calldata and extracts any ERC-8021 attribution tags.
 */
export function extractAttributionTags(calldata: Hex): string[] {
  try {
    const result = fromDataSuffix(calldata);
    return result?.codes ?? [];
  } catch {
    return [];
  }
}
