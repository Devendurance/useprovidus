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
 * Authoritative server-side verification of a Celo USDC deposit transaction.
 *
 * Checks:
 * 1. Transaction exists on Celo mainnet and status === 'success'
 * 2. Emits an ERC-20 Transfer event on Circle's canonical USDC contract
 * 3. Transfer recipient ('to') matches expected Paycrest deposit address
 * 4. Transfer sender ('from') matches expected user wallet
 * 5. Transferred value matches or exceeds required amount
 */
export async function verifyCeloUsdcDepositReceipt(
  params: VerifyDepositParams,
): Promise<VerifyDepositResult> {
  const {
    txHash,
    expectedSender,
    expectedRecipient,
    expectedAmountBaseUnits,
  } = params;

  if (!isAddress(expectedSender) || !isAddress(expectedRecipient)) {
    return {
      valid: false,
      code: "INVALID_ADDRESS",
      reason: "Sender or recipient address is invalid",
    };
  }

  const checksummedSender = getAddress(expectedSender);
  const checksummedRecipient = getAddress(expectedRecipient);

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

  // Scan logs for Transfer event on Canonical USDC contract
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== CANONICAL_CELO_USDC_ADDRESS) {
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
    reason:
      "No matching Transfer(from, to, value) found in receipt to the expected Paycrest deposit address on canonical Celo USDC contract",
  };
}
