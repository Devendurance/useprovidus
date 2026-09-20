/**
 * Self-check for the P5 payment-preparation boundary (BUILDER B).
 *
 * Proves, against a mocked Paycrest provider, the in-memory preview and
 * transaction repositories, and the real route handler:
 *   1. the operating settlement loader fails closed on any missing or invalid
 *      `PROVIDUS_SETTLEMENT_*` value and never repeats a value in its error;
 *   2. malformed requests and invalid wallet context are rejected before any
 *      repository or provider work;
 *   3. a consumed, expired, or foreign preview can never create a transaction
 *      or a Paycrest order;
 *   4. a successful preparation creates exactly one pending airtime transaction
 *      with the frozen idempotency key and binds exactly one Paycrest order
 *      before returning the deposit instructions;
 *   5. a pre-order insert that fails — whether refused or thrown — releases the
 *      consumed preview, so a database failure never permanently burns a quote;
 *   6. a timeout or network failure records ORDER_CREATION_OUTCOME_UNKNOWN and
 *      is never retried;
 *   7. a definitive provider rejection, an unusable success body, and an
 *      under-priced provider total all fail closed without instructions;
 *   8. a repeated request for the same consumed preview cannot create a second
 *      Paycrest order.
 *
 * No live Paycrest orders, no ClubKonnect purchases, no blockchain transactions.
 * Run: npx tsx --conditions=react-server lib/assistant/payment-service-self-check.ts
 */

import "server-only";

import assert from "node:assert/strict";

import { POST } from "@/app/api/assistant/orders/route";
import {
  getOperatingSettlementAccount,
  SETTLEMENT_CONFIG_MISSING_MESSAGE,
} from "@/lib/paycrest/server/operating-account";
import {
  InMemoryPreviewRepository,
  setPreviewRepositoryForTesting,
  type AirtimePreviewRecord,
  type AirtimePreviewRecordInput,
  type PreviewRepository,
  type Result as PreviewResult,
} from "@/lib/assistant/preview-repository";
import {
  prepareAirtimePaymentOrder,
  type AirtimePaymentError,
  type AirtimePaymentResult,
  type PaymentInstructions,
} from "@/lib/assistant/payment-service";
import {
  InMemoryTransactionRepository,
  setTransactionRepositoryForTesting,
  type TransactionRepository,
} from "@/lib/transactions";

const WALLET = "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa";
const OTHER_WALLET = "0x1111111111111111111111111111111111111111";
const RECEIVE_ADDRESS = "0x2222222222222222222222222222222222222222";

const AMOUNT_NGN = "500";
const PHONE = "08031234567";
const NETWORK = "mtn";
const RATE = "1500";
const AMOUNT_USDC = "0.333334";
const TOTAL_USDC = "0.333334";

const INSTITUTION_CODE = "PROVIDUS";
const ACCOUNT_NUMBER = "0123456789";
const ACCOUNT_NAME = "PROVIDUS SETTLEMENT";
const MEMO = "Providus utility settlement";

const VALID_SETTLEMENT_ENV = {
  PROVIDUS_SETTLEMENT_INSTITUTION_CODE: INSTITUTION_CODE,
  PROVIDUS_SETTLEMENT_ACCOUNT_NUMBER: ACCOUNT_NUMBER,
  PROVIDUS_SETTLEMENT_ACCOUNT_NAME: ACCOUNT_NAME,
  PROVIDUS_SETTLEMENT_MEMO: MEMO,
} as const;

type SettlementEnv = {
  institutionCode?: string;
  accountNumber?: string;
  accountName?: string;
  memo?: string;
};

function applySettlementEnv(values: SettlementEnv): void {
  if (values.institutionCode === undefined) {
    delete process.env.PROVIDUS_SETTLEMENT_INSTITUTION_CODE;
  } else {
    process.env.PROVIDUS_SETTLEMENT_INSTITUTION_CODE = values.institutionCode;
  }
  if (values.accountNumber === undefined) {
    delete process.env.PROVIDUS_SETTLEMENT_ACCOUNT_NUMBER;
  } else {
    process.env.PROVIDUS_SETTLEMENT_ACCOUNT_NUMBER = values.accountNumber;
  }
  if (values.accountName === undefined) {
    delete process.env.PROVIDUS_SETTLEMENT_ACCOUNT_NAME;
  } else {
    process.env.PROVIDUS_SETTLEMENT_ACCOUNT_NAME = values.accountName;
  }
  if (values.memo === undefined) {
    delete process.env.PROVIDUS_SETTLEMENT_MEMO;
  } else {
    process.env.PROVIDUS_SETTLEMENT_MEMO = values.memo;
  }
}

/** Restores the canonical, fully valid settlement configuration. */
function applyValidSettlementEnv(): void {
  applySettlementEnv({
    institutionCode: VALID_SETTLEMENT_ENV.PROVIDUS_SETTLEMENT_INSTITUTION_CODE,
    accountNumber: VALID_SETTLEMENT_ENV.PROVIDUS_SETTLEMENT_ACCOUNT_NUMBER,
    accountName: VALID_SETTLEMENT_ENV.PROVIDUS_SETTLEMENT_ACCOUNT_NAME,
    memo: VALID_SETTLEMENT_ENV.PROVIDUS_SETTLEMENT_MEMO,
  });
}

type FetchCall = {
  url: string;
  method: string;
  apiKey: string | null;
  body: Record<string, unknown>;
};

type OutgoingOrderBody = {
  amount: string;
  reference: string;
  source: {
    type: string;
    currency: string;
    network: string;
    refundAddress: string;
  };
  destination: {
    type: string;
    currency: string;
    recipient: {
      institution: string;
      accountIdentifier: string;
      accountName: string;
      memo: string;
    };
  };
};

let fetchCalls: FetchCall[] = [];

/** Replaces global fetch for one scenario and records every outgoing call. */
function stubFetch(respond: (call: FetchCall) => Response): void {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    let body: Record<string, unknown> = {};
    if (typeof init?.body === "string" && init.body !== "") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    const call: FetchCall = {
      url,
      method: init?.method ?? "GET",
      apiKey: new Headers(init?.headers).get("api-key"),
      body,
    };
    fetchCalls.push(call);
    return respond(call);
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function paycrestOrderPayload(overrides?: {
  amount?: string;
  senderFee?: string;
  orderId?: string;
  validUntil?: string;
}): unknown {
  return {
    status: "success",
    data: {
      id: overrides?.orderId ?? "pc_ord_selfcheck_1",
      status: "initiated",
      amount: overrides?.amount ?? AMOUNT_USDC,
      senderFee: overrides?.senderFee ?? "0",
      transactionFee: "0",
      rate: RATE,
      token: "USDC",
      providerAccount: {
        network: "celo",
        receiveAddress: RECEIVE_ADDRESS,
        validUntil:
          overrides?.validUntil ?? new Date(Date.now() + 600_000).toISOString(),
      },
    },
  };
}

type Sandbox = {
  previews: InMemoryPreviewRepository;
  transactions: InMemoryTransactionRepository;
};

function newSandbox(): Sandbox {
  return {
    previews: new InMemoryPreviewRepository(),
    transactions: new InMemoryTransactionRepository(),
  };
}

async function seedPreview(
  sandbox: Sandbox,
  overrides?: Partial<AirtimePreviewRecordInput>,
): Promise<AirtimePreviewRecord> {
  const result = await sandbox.previews.createPreview({
    walletAddress: WALLET,
    intentFingerprint: "a".repeat(64),
    amountNgn: AMOUNT_NGN,
    phone: PHONE,
    network: NETWORK,
    rate: RATE,
    amountUsdc: AMOUNT_USDC,
    feeUsdc: "0",
    totalUsdc: TOTAL_USDC,
    quotedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  });
  assert.equal(result.ok, true, "preview seed must succeed");
  if (!result.ok) throw new Error("unreachable");
  return result.preview;
}

function prepare(
  sandbox: Sandbox,
  previewId: string,
  walletAddress: string = WALLET,
): Promise<AirtimePaymentResult> {
  return prepareAirtimePaymentOrder({
    previewId,
    walletAddress,
    options: {
      previewRepository: sandbox.previews,
      transactionRepository: sandbox.transactions,
    },
  });
}

function expectError(result: AirtimePaymentResult): AirtimePaymentError {
  if (result.ok) {
    assert.fail("expected payment preparation to fail");
  }
  return result.error;
}

function expectInstructions(result: AirtimePaymentResult): PaymentInstructions {
  if (!result.ok) {
    assert.fail(`expected payment instructions, got ${result.error.code}`);
  }
  return result.data;
}

/** Always-consumable fake: simulates a second caller reaching the pre-order step. */
class ReplayPreviewRepository implements PreviewRepository {
  constructor(private readonly preview: AirtimePreviewRecord) {}

  async createPreview(): Promise<PreviewResult<AirtimePreviewRecord>> {
    return { ok: true, preview: this.preview };
  }

  async findById(): Promise<AirtimePreviewRecord | null> {
    return this.preview;
  }

  async consumePreview(
    _previewId: string,
    _walletAddress: string,
    transactionId: string,
  ): Promise<PreviewResult<AirtimePreviewRecord>> {
    return {
      ok: true,
      preview: {
        ...this.preview,
        consumedAt: new Date().toISOString(),
        transactionId,
      },
    };
  }

  /** The fake binds no state, so there is never a consumption to roll back. */
  async releasePreview(): Promise<boolean> {
    return false;
  }
}

async function run() {
  console.info("Starting P5 payment-service self-check...");

  // Isolate the provider and settlement environment before any call reads it.
  process.env.PAYCREST_API_KEY = "test-key-not-real";
  process.env.PAYCREST_BASE_URL = "https://api.paycrest.io/v2";
  const originalFetch = globalThis.fetch;

  try {
    /* ------------------------------------------------------------------ */
    /* 1. Settlement account loader fails closed and never leaks values    */
    /* ------------------------------------------------------------------ */

    applyValidSettlementEnv();
    const loaded = getOperatingSettlementAccount();
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.deepEqual(loaded.data, {
      institutionCode: INSTITUTION_CODE,
      accountNumber: ACCOUNT_NUMBER,
      accountName: ACCOUNT_NAME,
      memo: MEMO,
    });

    // Unset memo falls back to the documented default; surrounding blanks trim.
    applySettlementEnv({
      institutionCode: `  ${INSTITUTION_CODE}  `,
      accountNumber: ` ${ACCOUNT_NUMBER} `,
      accountName: ` ${ACCOUNT_NAME} `,
      memo: "",
    });
    const defaulted = getOperatingSettlementAccount();
    assert.equal(defaulted.ok, true);
    if (!defaulted.ok) return;
    assert.equal(defaulted.data.memo, MEMO);
    assert.equal(defaulted.data.accountNumber, ACCOUNT_NUMBER);

    const missingCases: SettlementEnv[] = [
      {}, // nothing configured
      {
        accountNumber: ACCOUNT_NUMBER,
        accountName: ACCOUNT_NAME,
        memo: MEMO,
      }, // blank institution code
      {
        institutionCode: INSTITUTION_CODE,
        accountName: ACCOUNT_NAME,
        memo: MEMO,
      }, // blank account number
      {
        institutionCode: INSTITUTION_CODE,
        accountNumber: "012345678",
        accountName: ACCOUNT_NAME,
        memo: MEMO,
      }, // 9 digits
      {
        institutionCode: INSTITUTION_CODE,
        accountNumber: "0123456789x",
        accountName: ACCOUNT_NAME,
        memo: MEMO,
      }, // non-digits
      {
        institutionCode: INSTITUTION_CODE,
        accountNumber: ACCOUNT_NUMBER,
        memo: MEMO,
      }, // blank account name
    ];

    for (const environment of missingCases) {
      applySettlementEnv(environment);
      const failed = getOperatingSettlementAccount();
      assert.equal(failed.ok, false);
      if (failed.ok) return;
      assert.equal(failed.code, "SETTLEMENT_CONFIG_MISSING");
      assert.equal(failed.message, SETTLEMENT_CONFIG_MISSING_MESSAGE);
      // No configured value may ever appear in the public failure message.
      assert.equal(failed.message.includes(ACCOUNT_NUMBER), false);
      assert.equal(failed.message.includes(INSTITUTION_CODE), false);
      assert.equal(failed.message.includes(ACCOUNT_NAME), false);
    }

    /* ------------------------------------------------------------------ */
    /* 2. Request shape and wallet context                                 */
    /* ------------------------------------------------------------------ */

    applyValidSettlementEnv();
    const requestSandbox = newSandbox();
    stubFetch(() => jsonResponse(201, paycrestOrderPayload()));

    const blankPreviewId = expectError(
      await prepare(requestSandbox, ""),
    );
    assert.equal(blankPreviewId.code, "ORDER_REQUEST_INVALID");
    assert.equal(blankPreviewId.retryable, false);

    const malformedPreviewId = expectError(
      await prepare(requestSandbox, "not-a-preview-id"),
    );
    assert.equal(malformedPreviewId.code, "ORDER_REQUEST_INVALID");

    const seededForWalletCheck = await seedPreview(requestSandbox);
    const badWallet = expectError(
      await prepare(requestSandbox, seededForWalletCheck.id, "0xnot-an-address"),
    );
    assert.equal(badWallet.code, "WALLET_CONTEXT_INVALID");

    assert.equal(fetchCalls.length, 0, "no provider call may precede validation");
    const untouched = await requestSandbox.transactions.findByIdempotencyKey(
      `idem_airtime_${seededForWalletCheck.id}`,
    );
    assert.equal(untouched, null, "a rejected request must create no transaction");

    /* ------------------------------------------------------------------ */
    /* 3. Preview authority: consumed, expired, foreign, store down        */
    /* ------------------------------------------------------------------ */

    // Consumer one succeeds; the same preview can never be used again.
    const consumeSandbox = newSandbox();
    stubFetch(() => jsonResponse(201, paycrestOrderPayload()));
    const consumable = await seedPreview(consumeSandbox);
    const firstUse = expectInstructions(
      await prepare(consumeSandbox, consumable.id),
    );
    assert.equal(firstUse.totalUsdcToSend, TOTAL_USDC);
    assert.equal(fetchCalls.length, 1);

    const replay = expectError(await prepare(consumeSandbox, consumable.id));
    assert.equal(replay.code, "PREVIEW_NOT_USABLE");
    assert.equal(fetchCalls.length, 1, "a consumed preview must not call Paycrest");

    // Expired preview.
    const expiredSandbox = newSandbox();
    stubFetch(() => jsonResponse(201, paycrestOrderPayload()));
    const expired = await seedPreview(expiredSandbox, {
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const expiredResult = expectError(await prepare(expiredSandbox, expired.id));
    assert.equal(expiredResult.code, "PREVIEW_NOT_USABLE");
    assert.equal(fetchCalls.length, 0);

    // Another wallet's preview.
    const foreignSandbox = newSandbox();
    stubFetch(() => jsonResponse(201, paycrestOrderPayload()));
    const foreign = await seedPreview(foreignSandbox, {
      walletAddress: OTHER_WALLET,
    });
    const foreignResult = expectError(await prepare(foreignSandbox, foreign.id));
    assert.equal(foreignResult.code, "PREVIEW_NOT_USABLE");
    assert.equal(fetchCalls.length, 0);
    assert.equal(
      await foreignSandbox.transactions.findByIdempotencyKey(
        `idem_airtime_${foreign.id}`,
      ),
      null,
    );

    // Persistence unavailable: fail closed, retryable, and call nothing.
    const storeDownSandbox = newSandbox();
    stubFetch(() => jsonResponse(201, paycrestOrderPayload()));
    const storeDown = await seedPreview(storeDownSandbox);
    const downRepository: PreviewRepository = {
      createPreview: () => storeDownSandbox.previews.createPreview({} as never),
      findById: () => storeDownSandbox.previews.findById(storeDown.id),
      consumePreview: async () => ({
        ok: false,
        code: "PREVIEW_STORE_UNAVAILABLE",
        message: "Preview persistence is unavailable; no payment can be prepared",
      }),
      releasePreview: async () => false,
    };
    const storeDownResult = expectError(
      await prepareAirtimePaymentOrder({
        previewId: storeDown.id,
        walletAddress: WALLET,
        options: {
          previewRepository: downRepository,
          transactionRepository: storeDownSandbox.transactions,
        },
      }),
    );
    assert.equal(storeDownResult.code, "PREVIEW_STORE_UNAVAILABLE");
    assert.equal(storeDownResult.retryable, true);
    assert.equal(fetchCalls.length, 0, "no provider call without consumption");

    // Consumption succeeded but the pre-order insert failed: nothing may reach
    // Paycrest, the caller gets a safe failure, and the consumption is rolled
    // back so a database failure can never permanently burn the quote.
    const insertFailSandbox = newSandbox();
    stubFetch(() => jsonResponse(201, paycrestOrderPayload()));
    const insertFailPreview = await seedPreview(insertFailSandbox);
    const failingTransactions: TransactionRepository = {
      create: async () => ({
        ok: false,
        code: "DATABASE_INSERT_ERROR",
        message: "database unavailable",
      }),
      findById: () => insertFailSandbox.transactions.findById("missing"),
      findByIdempotencyKey: () =>
        insertFailSandbox.transactions.findByIdempotencyKey("missing"),
      findByPaycrestReference: () =>
        insertFailSandbox.transactions.findByPaycrestReference("missing"),
      findByPaycrestOrderId: () =>
        insertFailSandbox.transactions.findByPaycrestOrderId("missing"),
      bindPaycrestOrder: async () => ({
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: "not found",
      }),
      bindCeloTxHash: async () => ({
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: "not found",
      }),
      updateStatus: async () => ({
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: "not found",
      }),
      acquireAirtimeFulfilmentReservation: async () => ({
        ok: false,
        error: "DATABASE_UNAVAILABLE",
        code: "DATABASE_UNAVAILABLE",
        message: "database unavailable",
      }),
      claimAirtimeFulfilmentAttempt: async () => ({
        ok: false,
        error: "DATABASE_UNAVAILABLE",
        code: "DATABASE_UNAVAILABLE",
        message: "database unavailable",
      }),
      recordAirtimeFulfilmentOutcome: async () => ({
        ok: false,
        error: "DATABASE_UNAVAILABLE",
        code: "DATABASE_UNAVAILABLE",
        message: "database unavailable",
      }),
      recordAirtimeFulfilmentPreflightFailure: async () => ({
        ok: false,
        error: "DATABASE_UNAVAILABLE",
        code: "DATABASE_UNAVAILABLE",
        message: "database unavailable",
      }),
    };
    const insertFailResult = expectError(
      await prepareAirtimePaymentOrder({
        previewId: insertFailPreview.id,
        walletAddress: WALLET,
        options: {
          previewRepository: insertFailSandbox.previews,
          transactionRepository: failingTransactions,
        },
      }),
    );
    assert.equal(insertFailResult.code, "TRANSACTION_CREATION_FAILED");
    assert.equal(insertFailResult.retryable, false);
    assert.equal(fetchCalls.length, 0, "no Paycrest order without a pre-order row");

    // The rollback is observable: the row is back to its pre-consumption state.
    const releasedPreview = await insertFailSandbox.previews.findById(
      insertFailPreview.id,
    );
    assert.equal(releasedPreview?.consumedAt, null);
    assert.equal(releasedPreview?.transactionId, null);

    // ...and it is genuinely usable again: a retry against a healthy repository
    // completes and creates the first (and only) Paycrest order.
    const retryAfterInsertFailure = expectInstructions(
      await prepare(insertFailSandbox, insertFailPreview.id),
    );
    assert.equal(retryAfterInsertFailure.totalUsdcToSend, TOTAL_USDC);
    assert.equal(fetchCalls.length, 1, "the retry creates exactly one order");
    const retriedTransaction =
      await insertFailSandbox.transactions.findByIdempotencyKey(
        `idem_airtime_${insertFailPreview.id}`,
      );
    assert.equal(retriedTransaction?.id, retryAfterInsertFailure.transactionId);
    assert.equal(retriedTransaction?.failureCode, null);

    // A `create` that throws is the same failure class: the consumption is
    // released and the caller still gets the structured, non-retryable error.
    const throwSandbox = newSandbox();
    stubFetch(() => jsonResponse(201, paycrestOrderPayload()));
    const throwPreview = await seedPreview(throwSandbox);
    const throwingTransactions: TransactionRepository = {
      ...failingTransactions,
      create: async () => {
        throw new Error("connection reset");
      },
    };
    const throwResult = expectError(
      await prepareAirtimePaymentOrder({
        previewId: throwPreview.id,
        walletAddress: WALLET,
        options: {
          previewRepository: throwSandbox.previews,
          transactionRepository: throwingTransactions,
        },
      }),
    );
    assert.equal(throwResult.code, "TRANSACTION_CREATION_FAILED");
    assert.equal(fetchCalls.length, 0, "no Paycrest order after a thrown insert");
    const releasedThrowPreview = await throwSandbox.previews.findById(throwPreview.id);
    assert.equal(releasedThrowPreview?.consumedAt, null);
    assert.equal(releasedThrowPreview?.transactionId, null);
    const retryAfterThrow = expectInstructions(
      await prepare(throwSandbox, throwPreview.id),
    );
    assert.equal(retryAfterThrow.totalUsdcToSend, TOTAL_USDC);
    assert.equal(fetchCalls.length, 1, "the retry creates exactly one order");

    /* ------------------------------------------------------------------ */
    /* 4. Successful preparation: transaction, Paycrest order, binding     */
    /* ------------------------------------------------------------------ */

    const successSandbox = newSandbox();
    const validUntil = new Date(Date.now() + 600_000).toISOString();
    stubFetch(() =>
      jsonResponse(201, paycrestOrderPayload({ orderId: "pc_ord_ok_1", validUntil })),
    );
    const preview = await seedPreview(successSandbox);

    const success = expectInstructions(await prepare(successSandbox, preview.id));
    assert.equal(/^tx_[0-9a-f-]{36}$/.test(success.transactionId), true);
    assert.equal(success.receiveAddress, RECEIVE_ADDRESS);
    assert.equal(success.totalUsdcToSend, TOTAL_USDC);
    assert.equal(success.validUntil, validUntil);
    assert.equal(fetchCalls.length, 1);

    const outgoing = fetchCalls[0];
    assert.equal(outgoing.url, "https://api.paycrest.io/v2/sender/orders");
    assert.equal(outgoing.method, "POST");
    assert.equal(outgoing.apiKey, "test-key-not-real");
    const outgoingBody = outgoing.body as unknown as OutgoingOrderBody;
    assert.equal(outgoingBody.amount, AMOUNT_USDC);
    assert.equal(outgoingBody.source.type, "crypto");
    assert.equal(outgoingBody.source.currency, "USDC");
    assert.equal(outgoingBody.source.network, "celo");
    assert.equal(outgoingBody.source.refundAddress, WALLET.toLowerCase());
    assert.equal(outgoingBody.destination.type, "fiat");
    assert.equal(outgoingBody.destination.currency, "NGN");
    assert.equal(outgoingBody.destination.recipient.institution, INSTITUTION_CODE);
    assert.equal(outgoingBody.destination.recipient.accountIdentifier, ACCOUNT_NUMBER);
    assert.equal(outgoingBody.destination.recipient.accountName, ACCOUNT_NAME);
    assert.equal(outgoingBody.destination.recipient.memo, MEMO);
    assert.equal(/^p4b_[0-9a-f]{24}$/.test(outgoingBody.reference), true);

    const stored = await successSandbox.transactions.findById(success.transactionId);
    assert.notEqual(stored, null);
    if (!stored) return;
    assert.equal(stored.idempotencyKey, `idem_airtime_${preview.id}`);
    assert.equal(stored.type, "airtime");
    assert.equal(stored.status, "pending");
    assert.equal(stored.walletAddress, WALLET.toLowerCase());
    assert.equal(stored.amountUsdc, AMOUNT_USDC);
    assert.equal(stored.amountNgn, AMOUNT_NGN);
    assert.equal(stored.paycrestReference, outgoingBody.reference);
    assert.equal(stored.paycrestOrderId, "pc_ord_ok_1");
    assert.equal(stored.paycrestStatus, "initiated");
    assert.equal(stored.receiveAddress, RECEIVE_ADDRESS);
    assert.equal(stored.validUntil, validUntil);
    assert.equal(stored.failureCode, null);
    assert.equal(stored.metadata?.phone, PHONE);
    assert.equal(stored.metadata?.network, NETWORK);
    assert.equal(stored.metadata?.rate, RATE);
    assert.equal(stored.metadata?.totalUsdcToSend, TOTAL_USDC);
    // The settlement account itself must never be persisted on the transaction.
    assert.equal(JSON.stringify(stored.metadata).includes(ACCOUNT_NUMBER), false);

    /* ------------------------------------------------------------------ */
    /* 5. Unknown provider outcome: recorded, never retried               */
    /* ------------------------------------------------------------------ */

    const timeoutSandbox = newSandbox();
    stubFetch(() => {
      throw abortError();
    });
    const timeoutPreview = await seedPreview(timeoutSandbox);
    const timeout = expectError(await prepare(timeoutSandbox, timeoutPreview.id));
    assert.equal(timeout.code, "ORDER_CREATION_OUTCOME_UNKNOWN");
    assert.equal(timeout.retryable, false);
    assert.equal(fetchCalls.length, 1, "an ambiguous outcome must not be retried");
    const timeoutTx = await timeoutSandbox.transactions.findByIdempotencyKey(
      `idem_airtime_${timeoutPreview.id}`,
    );
    assert.notEqual(timeoutTx, null);
    if (!timeoutTx) return;
    assert.equal(timeoutTx.status, "failed");
    assert.equal(timeoutTx.failureCode, "ORDER_CREATION_OUTCOME_UNKNOWN");
    assert.equal(timeoutTx.receiveAddress, null, "no address may be exposed");
    assert.equal(timeoutTx.paycrestOrderId, null);

    // A network-level failure is ambiguous for the same reason.
    const networkSandbox = newSandbox();
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const networkPreview = await seedPreview(networkSandbox);
    const network = expectError(await prepare(networkSandbox, networkPreview.id));
    assert.equal(network.code, "ORDER_CREATION_OUTCOME_UNKNOWN");
    assert.equal(fetchCalls.length, 1);
    const networkTx = await networkSandbox.transactions.findByIdempotencyKey(
      `idem_airtime_${networkPreview.id}`,
    );
    assert.equal(networkTx?.status, "failed");
    assert.equal(networkTx?.failureCode, "ORDER_CREATION_OUTCOME_UNKNOWN");

    // A provider "temporarily unavailable" answer may still hide a live order,
    // so it is treated as unknown rather than as a safe rejection.
    const unavailableSandbox = newSandbox();
    stubFetch(() => jsonResponse(503, { status: "error", message: "unavailable" }));
    const unavailablePreview = await seedPreview(unavailableSandbox);
    const unavailable = expectError(
      await prepare(unavailableSandbox, unavailablePreview.id),
    );
    assert.equal(unavailable.code, "ORDER_CREATION_OUTCOME_UNKNOWN");
    assert.equal(fetchCalls.length, 1);
    const unavailableTx = await unavailableSandbox.transactions.findByIdempotencyKey(
      `idem_airtime_${unavailablePreview.id}`,
    );
    assert.equal(unavailableTx?.failureCode, "ORDER_CREATION_OUTCOME_UNKNOWN");

    /* ------------------------------------------------------------------ */
    /* 6. Definitive rejection and unusable success bodies                */
    /* ------------------------------------------------------------------ */

    const rejectedSandbox = newSandbox();
    stubFetch(() =>
      jsonResponse(400, {
        status: "error",
        message: "Failed to validate payload",
        data: [
          {
            field: "destination.recipient.accountIdentifier",
            message: "Invalid account",
          },
        ],
      }),
    );
    const rejectedPreview = await seedPreview(rejectedSandbox);
    const rejected = expectError(await prepare(rejectedSandbox, rejectedPreview.id));
    assert.equal(rejected.code, "PAYCREST_ORDER_REJECTED");
    assert.equal(fetchCalls.length, 1);
    const rejectedTx = await rejectedSandbox.transactions.findByIdempotencyKey(
      `idem_airtime_${rejectedPreview.id}`,
    );
    assert.equal(rejectedTx?.status, "failed");
    assert.equal(rejectedTx?.failureCode, "PAYCREST_VALIDATION_FAILED");
    assert.equal(rejectedTx?.receiveAddress, null);

    // 2xx that cannot be parsed: the order exists upstream but is unreadable.
    const unreadableSandbox = newSandbox();
    stubFetch(
      () =>
        new Response("not json", {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    const unreadablePreview = await seedPreview(unreadableSandbox);
    const unreadable = expectError(
      await prepare(unreadableSandbox, unreadablePreview.id),
    );
    assert.equal(unreadable.code, "PAYCREST_BIND_FAILED");
    const unreadableTx = await unreadableSandbox.transactions.findByIdempotencyKey(
      `idem_airtime_${unreadablePreview.id}`,
    );
    assert.equal(unreadableTx?.failureCode, "ORDER_RESPONSE_UNSAFE");
    assert.equal(unreadableTx?.receiveAddress, null);

    // Provider echoes a different amount: never bind a mismatched order.
    const amountMismatchSandbox = newSandbox();
    stubFetch(() => jsonResponse(201, paycrestOrderPayload({ amount: "1" })));
    const amountMismatchPreview = await seedPreview(amountMismatchSandbox);
    const amountMismatch = expectError(
      await prepare(amountMismatchSandbox, amountMismatchPreview.id),
    );
    assert.equal(amountMismatch.code, "PAYCREST_BIND_FAILED");
    const amountMismatchTx =
      await amountMismatchSandbox.transactions.findByIdempotencyKey(
        `idem_airtime_${amountMismatchPreview.id}`,
      );
    assert.equal(amountMismatchTx?.failureCode, "ORDER_RESPONSE_UNSAFE");

    // Provider fees would push the required total above the frozen quote: the
    // client must not be told to send an under-funding amount.
    const underfundedSandbox = newSandbox();
    stubFetch(() => jsonResponse(201, paycrestOrderPayload({ senderFee: "0.01" })));
    const underfundedPreview = await seedPreview(underfundedSandbox);
    const underfunded = expectError(
      await prepare(underfundedSandbox, underfundedPreview.id),
    );
    assert.equal(underfunded.code, "PAYCREST_BIND_FAILED");
    const underfundedTx = await underfundedSandbox.transactions.findByIdempotencyKey(
      `idem_airtime_${underfundedPreview.id}`,
    );
    assert.equal(underfundedTx?.failureCode, "ORDER_TOTAL_MISMATCH");
    assert.equal(underfundedTx?.receiveAddress, null);

    /* ------------------------------------------------------------------ */
    /* 7. HTTP boundary: flat instructions, no-store, injected fields      */
    /* ------------------------------------------------------------------ */

    const routeSandbox = newSandbox();
    setPreviewRepositoryForTesting(routeSandbox.previews);
    setTransactionRepositoryForTesting(routeSandbox.transactions);
    stubFetch(() =>
      jsonResponse(201, paycrestOrderPayload({ orderId: "pc_ord_route_1" })),
    );
    const routePreview = await seedPreview(routeSandbox);

    const okResponse = await POST(
      new Request("http://localhost/api/assistant/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          previewId: routePreview.id,
          walletAddress: WALLET,
          // Client-supplied authority must be ignored, never forwarded.
          amountUsdc: "999",
          totalUsdcToSend: "999",
          receiveAddress: OTHER_WALLET,
          destination: { recipient: { accountIdentifier: "9999999999" } },
        }),
      }),
    );
    assert.equal(okResponse.status, 200);
    assert.equal(okResponse.headers.get("cache-control"), "no-store");
    const okBody = (await okResponse.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(okBody).sort(), [
      "ok",
      "receiveAddress",
      "totalUsdcToSend",
      "transactionId",
      "validUntil",
    ]);
    assert.equal(okBody.ok, true);
    assert.equal(okBody.receiveAddress, RECEIVE_ADDRESS);
    assert.equal(okBody.totalUsdcToSend, TOTAL_USDC);
    assert.equal(fetchCalls.length, 1);
    const routeBody = fetchCalls[0].body as unknown as OutgoingOrderBody;
    assert.equal(routeBody.amount, AMOUNT_USDC);
    assert.equal(routeBody.destination.recipient.accountIdentifier, ACCOUNT_NUMBER);
    assert.equal(routeBody.source.refundAddress, WALLET.toLowerCase());

    const repeatedResponse = await POST(
      new Request("http://localhost/api/assistant/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ previewId: routePreview.id, walletAddress: WALLET }),
      }),
    );
    assert.equal(repeatedResponse.status, 400);
    assert.equal(repeatedResponse.headers.get("cache-control"), "no-store");
    const repeatedBody = (await repeatedResponse.json()) as {
      ok: boolean;
      error: { code: string };
    };
    assert.equal(repeatedBody.ok, false);
    assert.equal(repeatedBody.error.code, "PREVIEW_NOT_USABLE");
    assert.equal(fetchCalls.length, 1, "a repeat click must not create a second order");

    const malformedResponse = await POST(
      new Request("http://localhost/api/assistant/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    assert.equal(malformedResponse.status, 400);
    const malformedBody = (await malformedResponse.json()) as {
      error: { code: string };
    };
    assert.equal(malformedBody.error.code, "ORDER_REQUEST_INVALID");
    assert.equal(fetchCalls.length, 1);

    // Missing settlement configuration is a 503 and never reaches Paycrest.
    const missingConfigSandbox = newSandbox();
    setPreviewRepositoryForTesting(missingConfigSandbox.previews);
    setTransactionRepositoryForTesting(missingConfigSandbox.transactions);
    stubFetch(() => jsonResponse(201, paycrestOrderPayload()));
    const missingConfigPreview = await seedPreview(missingConfigSandbox);
    applySettlementEnv({});
    const configResponse = await POST(
      new Request("http://localhost/api/assistant/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          previewId: missingConfigPreview.id,
          walletAddress: WALLET,
        }),
      }),
    );
    assert.equal(configResponse.status, 503);
    const configBody = (await configResponse.json()) as {
      ok: boolean;
      error: { code: string; message: string };
      receiveAddress?: string;
    };
    assert.equal(configBody.ok, false);
    assert.equal(configBody.error.code, "SETTLEMENT_CONFIG_MISSING");
    assert.equal(configBody.error.message, SETTLEMENT_CONFIG_MISSING_MESSAGE);
    assert.equal("receiveAddress" in configBody, false);
    assert.equal(fetchCalls.length, 0, "no provider call without configuration");

    /* ------------------------------------------------------------------ */
    /* 8. Idempotent replay never creates a second Paycrest order          */
    /* ------------------------------------------------------------------ */

    applyValidSettlementEnv();
    const replaySandbox = newSandbox();
    stubFetch(() => jsonResponse(201, paycrestOrderPayload({ orderId: "pc_ord_replay_1" })));
    const replayPreview = await seedPreview(replaySandbox);
    const replayRepository = new ReplayPreviewRepository(replayPreview);

    const replayOptions = {
      previewRepository: replayRepository,
      transactionRepository: replaySandbox.transactions,
    };
    const firstAttempt = await prepareAirtimePaymentOrder({
      previewId: replayPreview.id,
      walletAddress: WALLET,
      options: replayOptions,
    });
    const secondAttempt = await prepareAirtimePaymentOrder({
      previewId: replayPreview.id,
      walletAddress: WALLET,
      options: replayOptions,
    });
    const firstInstructions = expectInstructions(firstAttempt);
    const secondInstructions = expectInstructions(secondAttempt);
    assert.deepEqual(secondInstructions, firstInstructions);
    assert.equal(fetchCalls.length, 1, "replay must not create a second order");

    // A pre-existing pre-order row with no Paycrest binding is an unresolved
    // attempt: it is recorded as recovery-required and never re-sent upstream.
    const unboundSandbox = newSandbox();
    stubFetch(() => jsonResponse(201, paycrestOrderPayload()));
    const unboundPreview = await seedPreview(unboundSandbox);
    await unboundSandbox.transactions.create({
      idempotencyKey: `idem_airtime_${unboundPreview.id}`,
      type: "airtime",
      walletAddress: WALLET,
      amountUsdc: AMOUNT_USDC,
      amountNgn: AMOUNT_NGN,
      paycrestReference: "p4b_preexisting_unbound",
    });
    const unboundResult = expectError(
      await prepareAirtimePaymentOrder({
        previewId: unboundPreview.id,
        walletAddress: WALLET,
        options: {
          previewRepository: new ReplayPreviewRepository(unboundPreview),
          transactionRepository: unboundSandbox.transactions,
        },
      }),
    );
    assert.equal(unboundResult.code, "ORDER_CREATION_OUTCOME_UNKNOWN");
    assert.equal(fetchCalls.length, 0, "an unresolved row must not reach Paycrest");
    const markedUnbound = await unboundSandbox.transactions.findByIdempotencyKey(
      `idem_airtime_${unboundPreview.id}`,
    );
    assert.equal(markedUnbound?.status, "failed");
    assert.equal(markedUnbound?.failureCode, "ORDER_CREATION_OUTCOME_UNKNOWN");

    console.log("payment-service self-check: all assertions passed");
  } finally {
    globalThis.fetch = originalFetch;
    setPreviewRepositoryForTesting(null);
    setTransactionRepositoryForTesting(null);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
