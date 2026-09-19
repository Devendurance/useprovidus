/**
 * Self-check suite for Providus P1 recovery & security guarantees.
 * Run: npx tsx lib/transactions/recovery-security-self-check.ts
 */

import assert from "node:assert/strict";
import { getAddress, pad, toHex, type Hash, type TransactionReceipt } from "viem";
import {
  setMockReceiptFetcherForTesting,
  verifyCeloUsdcDepositReceipt,
} from "@/lib/celo/verify-deposit";
import { CANONICAL_CELO_USDC_ADDRESS } from "@/lib/celo/usdc";
import {
  InMemoryTransactionRepository,
  setTransactionRepositoryForTesting,
  toPublicTransactionDto,
  type TransactionRecord,
} from "@/lib/transactions";
import { POST as orderRoutePost } from "@/app/api/paycrest/orders/route";

function createTransferLog(from: string, to: string, value: bigint) {
  return {
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hash,
      pad(from.toLowerCase() as `0x${string}`),
      pad(to.toLowerCase() as `0x${string}`),
    ],
    data: pad(toHex(value)),
  };
}

async function run() {
  console.info("Starting P1 recovery & security self-check...");

  const repo = new InMemoryTransactionRepository();
  setTransactionRepositoryForTesting(repo);

  const wallet = getAddress("0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa");
  const receiveAddress = getAddress("0x1111111111111111111111111111111111111111");

  // 1. Pre-order persistence before Paycrest creation
  const preOrder = await repo.create({
    idempotencyKey: "idem_sec_1",
    walletAddress: wallet,
    amountUsdc: "10.000000",
    paycrestReference: "ref_sec_1",
  });
  assert.equal(preOrder.ok, true);
  if (!preOrder.ok) return;

  assert.equal(preOrder.record.paycrestOrderId, null, "Pre-order row has null order ID initially");
  assert.equal(preOrder.record.status, "pending");

  // 2. Unknown outcome handling & idempotency protection:
  // If request retries with same idempotency key when orderId is still null,
  // the repository returns the existing row and prevents creating a duplicate.
  const retryCreate = await repo.create({
    idempotencyKey: "idem_sec_1",
    walletAddress: wallet,
    amountUsdc: "10.000000",
    paycrestReference: "ref_sec_2", // Even with different reference
  });
  assert.equal(retryCreate.ok, true);
  if (!retryCreate.ok) return;
  assert.equal(retryCreate.reused, true, "Must reuse existing row on idempotency match");
  assert.equal(retryCreate.record.id, preOrder.record.id);

  // 3. Secrets absent from public DTO
  const recordWithSecrets: TransactionRecord = {
    ...preOrder.record,
    metadata: {
      institutionName: "Access Bank",
      accountIdentifierMasked: "******1234",
      rate: "1500",
      totalUsdcToSend: "10.000000",
      internalSecretKey: "SHOULD_NOT_LEAK_123",
      apiKey: "SECRET_KEY_XYZ",
    },
  };

  const publicDto = toPublicTransactionDto(recordWithSecrets);
  assert.equal("internalSecretKey" in (publicDto.metadata ?? {}), false, "Internal secret must not leak");
  assert.equal("apiKey" in (publicDto.metadata ?? {}), false, "API key must not leak");
  assert.equal(publicDto.metadata?.institutionName, "Access Bank");
  assert.equal(publicDto.metadata?.accountIdentifierMasked, "******1234");

  // 4. Server-Side Celo Deposit Verification:
  // Tests that verifyCeloUsdcDepositReceipt rejects fake, reverted, or wrong-contract transfers.
  const fakeTxHash = ("0x" + "c".repeat(64)) as Hash;
  const expectedAmount = BigInt(10_000_000); // 10 USDC (6 decimals)

  // Case A: Receipt not found
  setMockReceiptFetcherForTesting(async () => null);
  const vNotFound = await verifyCeloUsdcDepositReceipt({
    txHash: fakeTxHash,
    expectedSender: wallet,
    expectedRecipient: receiveAddress,
    expectedAmountBaseUnits: expectedAmount,
  });
  assert.equal(vNotFound.valid, false);
  assert.equal(vNotFound.code, "RECEIPT_NOT_FOUND");

  // Case B: Transaction reverted on-chain
  setMockReceiptFetcherForTesting(async () => ({
    status: "reverted",
    logs: [],
  } as unknown as TransactionReceipt));
  const vReverted = await verifyCeloUsdcDepositReceipt({
    txHash: fakeTxHash,
    expectedSender: wallet,
    expectedRecipient: receiveAddress,
    expectedAmountBaseUnits: expectedAmount,
  });
  assert.equal(vReverted.valid, false);
  assert.equal(vReverted.code, "TRANSACTION_REVERTED");

  // Case C: Wrong token contract (not Circle canonical USDC)
  const fakeTokenContract = "0x9999999999999999999999999999999999999999";
  const transferLog = createTransferLog(wallet, receiveAddress, expectedAmount);

  setMockReceiptFetcherForTesting(async () => ({
    status: "success",
    logs: [
      {
        address: fakeTokenContract,
        topics: transferLog.topics,
        data: transferLog.data,
      },
    ],
  } as unknown as TransactionReceipt));

  const vWrongToken = await verifyCeloUsdcDepositReceipt({
    txHash: fakeTxHash,
    expectedSender: wallet,
    expectedRecipient: receiveAddress,
    expectedAmountBaseUnits: expectedAmount,
  });
  assert.equal(vWrongToken.valid, false);
  assert.equal(vWrongToken.code, "NO_MATCHING_TRANSFER", "Wrong token contract must be rejected");

  // Case D: Wrong recipient address
  const wrongRecipient = "0x2222222222222222222222222222222222222222";
  const wrongRecipientLog = createTransferLog(wallet, wrongRecipient, expectedAmount);

  setMockReceiptFetcherForTesting(async () => ({
    status: "success",
    logs: [
      {
        address: CANONICAL_CELO_USDC_ADDRESS,
        topics: wrongRecipientLog.topics,
        data: wrongRecipientLog.data,
      },
    ],
  } as unknown as TransactionReceipt));

  const vWrongRecipient = await verifyCeloUsdcDepositReceipt({
    txHash: fakeTxHash,
    expectedSender: wallet,
    expectedRecipient: receiveAddress,
    expectedAmountBaseUnits: expectedAmount,
  });
  assert.equal(vWrongRecipient.valid, false);
  assert.equal(vWrongRecipient.code, "NO_MATCHING_TRANSFER", "Wrong recipient must be rejected");

  // Case E: Insufficient amount transferred
  const partialAmountLog = createTransferLog(wallet, receiveAddress, BigInt(5_000_000));

  setMockReceiptFetcherForTesting(async () => ({
    status: "success",
    logs: [
      {
        address: CANONICAL_CELO_USDC_ADDRESS,
        topics: partialAmountLog.topics,
        data: partialAmountLog.data,
      },
    ],
  } as unknown as TransactionReceipt));

  const vInsufficient = await verifyCeloUsdcDepositReceipt({
    txHash: fakeTxHash,
    expectedSender: wallet,
    expectedRecipient: receiveAddress,
    expectedAmountBaseUnits: expectedAmount,
  });
  assert.equal(vInsufficient.valid, false);
  assert.equal(vInsufficient.code, "INSUFFICIENT_TRANSFER_AMOUNT", "Underfunded transfer must be rejected");

  // Case F: Valid transfer on Canonical Celo USDC contract to expected recipient
  const validLog = createTransferLog(wallet, receiveAddress, expectedAmount);

  setMockReceiptFetcherForTesting(async () => ({
    status: "success",
    logs: [
      {
        address: CANONICAL_CELO_USDC_ADDRESS,
        topics: validLog.topics,
        data: validLog.data,
      },
    ],
  } as unknown as TransactionReceipt));

  const vValid = await verifyCeloUsdcDepositReceipt({
    txHash: fakeTxHash,
    expectedSender: wallet,
    expectedRecipient: receiveAddress,
    expectedAmountBaseUnits: expectedAmount,
  });
  assert.equal(vValid.valid, true, "Valid canonical USDC transfer must pass verification");
  assert.equal(vValid.transferredAmountBaseUnits, expectedAmount);
  assert.equal(vValid.from, wallet);
  assert.equal(vValid.to, receiveAddress);


  // 5. Route seam: Unknown outcome retry MUST NOT issue a second Paycrest POST
  const unknownKey = "idem_route_unknown_outcome_retry";
  await repo.create({
    idempotencyKey: unknownKey,
    walletAddress: wallet,
    amountUsdc: "1.000000",
    paycrestReference: "p4b_unknown_ref",
  });

  let routeFetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    routeFetchCalls += 1;
    return new Response(JSON.stringify({}), { status: 200 });
  };

  try {
    const routeReq = new Request("https://useprovidus.com/api/paycrest/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: "1",
        institution: "GTBINGLA",
        accountIdentifier: "0123456789",
        refundAddress: wallet,
        reviewedAccountName: "TEST RECIPIENT",
        idempotencyKey: unknownKey,
      }),
    });

    const routeRes = await orderRoutePost(routeReq);
    assert.equal(routeRes.status, 504, "Unknown outcome retry must return 504");
    const routeJson = await routeRes.json();
    assert.equal(
      routeJson?.error?.code,
      "ORDER_CREATION_OUTCOME_UNKNOWN",
      "Must return ORDER_CREATION_OUTCOME_UNKNOWN",
    );
    assert.equal(
      routeFetchCalls,
      0,
      "CRITICAL: Upstream Paycrest POST was NEVER called on unknown outcome retry!",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  // Clean up mock
  setMockReceiptFetcherForTesting(null);
  setTransactionRepositoryForTesting(null);

  console.info("recovery-security self-check: all assertions passed");
}

run().catch((err) => {
  console.error("recovery-security self-check failed:", err);
  process.exit(1);
});
