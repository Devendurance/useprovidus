import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { CANONICAL_CELO_USDC_ADDRESS } from "@/lib/celo/usdc";
import { CELO_MAINNET } from "@/lib/wallet/celo";
import { erc20Abi } from "@/lib/wallet/erc20";

export interface VerifyDepositParams {
  txHash: Hash;
  expectedSender: Address;
  expectedRecipient: Address;
  expectedAmountBaseUnits: bigint;
}

/**
 * Asset-agnostic deposit verification: the expected token contract is supplied
 * by the caller, so the same rules cover every supported Celo payment asset.
 */
export interface VerifyCeloAssetDepositParams extends VerifyDepositParams {
  /** Canonical ERC-20 contract the deposit must have moved. */
  expectedTokenAddress: Address;
}

export interface VerifyDepositResult {
  valid: boolean;
  code?: string;
  reason?: string;
  transferredAmountBaseUnits?: bigint;
  from?: Address;
  to?: Address;
}

// Allow mock injection for unit tests
type ReceiptFetcher = (hash: Hash) => Promise<TransactionReceipt | null>;
let mockReceiptFetcher: ReceiptFetcher | null = null;

export function setMockReceiptFetcherForTesting(
  fetcher: ReceiptFetcher | null,
): void {
  mockReceiptFetcher = fetcher;
}

/**
 * Authoritative server-side verification of a Celo deposit transaction for one
 * expected ERC-20 token.
 *
 * Checks:
 * 1. Transaction exists on Celo mainnet and status === 'success'
 * 2. Emits an ERC-20 Transfer event on the expected token's contract
 * 3. Transfer recipient ('to') matches expected Paycrest deposit address
 * 4. Transfer sender ('from') matches expected user wallet
 * 5. Transferred value matches or exceeds required amount
 */
export async function verifyCeloAssetDepositReceipt(
  params: VerifyCeloAssetDepositParams,
): Promise<VerifyDepositResult> {
  const {
    txHash,
    expectedSender,
    expectedRecipient,
    expectedAmountBaseUnits,
    expectedTokenAddress,
  } = params;

  if (!isAddress(expectedSender) || !isAddress(expectedRecipient)) {
    return {
      valid: false,
      code: "INVALID_ADDRESS",
      reason: "Sender or recipient address is invalid",
    };
  }

  // A token contract that is not an address can never be matched, and guessing
  // one would verify a deposit against the wrong asset.
  if (!isAddress(expectedTokenAddress)) {
    return {
      valid: false,
      code: "INVALID_TOKEN_ADDRESS",
      reason: "Expected token address is invalid",
    };
  }

  const checksummedSender = getAddress(expectedSender);
  const checksummedRecipient = getAddress(expectedRecipient);
  const checksummedToken = getAddress(expectedTokenAddress);

  let receipt: TransactionReceipt | null = null;

  try {
    if (mockReceiptFetcher) {
      receipt = await mockReceiptFetcher(txHash);
    } else {
      const rpcUrl = process.env.CELO_RPC_URL || "https://forno.celo.org";
      const publicClient = createPublicClient({
        chain: CELO_MAINNET,
        transport: http(rpcUrl, { timeout: 10_000 }),
      });
      receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      code: "RPC_ERROR",
      reason: `Could not fetch transaction receipt from Celo mainnet: ${msg}`,
    };
  }

  if (!receipt) {
    return {
      valid: false,
      code: "RECEIPT_NOT_FOUND",
      reason: "Transaction receipt not found on Celo mainnet",
    };
  }

  if (receipt.status !== "success") {
    return {
      valid: false,
      code: "TRANSACTION_REVERTED",
      reason: "Transaction reverted on Celo mainnet",
    };
  }

  // Scan logs for a Transfer event on the expected token contract
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== checksummedToken) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        eventName: "Transfer",
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === "Transfer") {
        const from = getAddress(decoded.args.from);
        const to = getAddress(decoded.args.to);
        const value = decoded.args.value;

        // Check recipient
        if (to !== checksummedRecipient) {
          continue;
        }

        // Check sender
        if (from !== checksummedSender) {
          continue;
        }

        // Check value
        if (value < expectedAmountBaseUnits) {
          return {
            valid: false,
            code: "INSUFFICIENT_TRANSFER_AMOUNT",
            reason: `Transferred amount ${value.toString()} is less than required ${expectedAmountBaseUnits.toString()}`,
            transferredAmountBaseUnits: value,
            from,
            to,
          };
        }

        return {
          valid: true,
          transferredAmountBaseUnits: value,
          from,
          to,
        };
      }
    } catch {
      // Non-matching event log in contract, continue scanning
    }
  }

  return {
    valid: false,
    code: "NO_MATCHING_TRANSFER",
    reason: `No matching Transfer(from, to, value) found in receipt to the expected Paycrest deposit address on the expected Celo token contract ${checksummedToken}`,
  };
}

/**
 * The historical USDC refusal wording. The generic verifier names the expected
 * token contract, but this wrapper's callers have always been told by name that
 * the deposit must land on the canonical Celo USDC contract, so its result is
 * kept byte-identical.
 */
const LEGACY_USDC_NO_MATCHING_TRANSFER_REASON =
  "No matching Transfer(from, to, value) found in receipt to the expected Paycrest deposit address on canonical Celo USDC contract";

/**
 * USDC deposit verification: Circle's canonical Celo USDC contract is the only
 * accepted token, and every other rule is the shared asset rule above.
 */
export async function verifyCeloUsdcDepositReceipt(
  params: VerifyDepositParams,
): Promise<VerifyDepositResult> {
  const result = await verifyCeloAssetDepositReceipt({
    ...params,
    expectedTokenAddress: CANONICAL_CELO_USDC_ADDRESS,
  });
  if (result.code === "NO_MATCHING_TRANSFER") {
    return { ...result, reason: LEGACY_USDC_NO_MATCHING_TRANSFER_REASON };
  }
  return result;
}
