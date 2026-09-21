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
 *   7. a definitive provider rejection, an unusable success body, a mismatched
 *      provider base amount, and malformed or missing provider fees all fail
 *      closed without instructions;
 *   8. the provider-authoritative total (base plus Paycrest fees) is what the
 *      instructions and the persisted transaction carry, including a non-zero
 *      sender fee the preview never priced, and a bound row without a usable
 *      total is refused rather than falling back to the un-fee'd base amount;
 *   9. a repeated request for the same consumed preview cannot create a second
 *      Paycrest order;
 *  10. deposit rehydration over `GET /api/transactions/[id]` is opt-in,
 *      id-addressed, and ownership-gated: an opt-in read always reports
 *      `paymentInstructions` explicitly — the instructions themselves only for
 *      an unexpired, unfunded, provider-bound `pending` airtime order read by
 *      its own id with the owning wallet and intact metadata, `null` for every
 *      other refusal, and `PAYMENT_ORDER_EXPIRED` only when that ownership and
 *      status context is already proven — and it stays a pure read that never
 *      reconciles or otherwise calls the provider;
 *  11. an owner-scoped read (`paymentInstructions=true` or `scope=receipt`) is
 *      gated server-side before reconciliation and before any DTO is built: the
 *      owning wallet is served, an absent wallet context is refused with 401, a
 *      malformed one with 400, and another wallet's address with one generic
 *      403 that carries no transaction field, instruction, or wallet echo —
 *      while plain status polling stays public.
 *
 * No live Paycrest orders, no ClubKonnect purchases, no blockchain transactions.
 * Run: npx tsx --conditions=react-server lib/assistant/payment-service-self-check.ts
 */

import "server-only";

import assert from "node:assert/strict";

import { POST } from "@/app/api/assistant/orders/route";
import { GET as getTransactionById } from "@/app/api/transactions/[id]/route";
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
import { divideDecimalStrings, usdcToBaseUnits } from "@/lib/money/decimal";
import {
  InMemoryTransactionRepository,
  setTransactionRepositoryForTesting,
  type CreateTransactionInput,
  type TransactionMetadata,
  type TransactionRecord,
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

/** Provider-fee scenario: the preview prices no fee, Paycrest adds one. */
const FEE_BASE_USDC = "0.732698";
const FEE_SENDER_USDC = "0.0037";
const FEE_TOTAL_USDC = "0.736398";

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

/** Sentinel: the field is absent from the provider response entirely. */
const ABSENT = Symbol("absent");

type FeeOverride = string | number | null | typeof ABSENT;

function paycrestOrderPayload(overrides?: {
  amount?: string;
  senderFee?: FeeOverride;
  transactionFee?: FeeOverride;
  orderId?: string;
  validUntil?: string;
  token?: string;
  rate?: string;
}): unknown {
  const data: Record<string, unknown> = {
    id: overrides?.orderId ?? "pc_ord_selfcheck_1",
    status: "initiated",
    amount: overrides?.amount ?? AMOUNT_USDC,
    rate: overrides?.rate ?? RATE,
    token: overrides?.token ?? "USDC",
    providerAccount: {
      network: "celo",
      receiveAddress: RECEIVE_ADDRESS,
      validUntil:
        overrides?.validUntil ?? new Date(Date.now() + 600_000).toISOString(),
    },
  };
  if (overrides?.senderFee !== ABSENT) {
    data.senderFee = overrides?.senderFee === undefined ? "0" : overrides.senderFee;
  }
  if (overrides?.transactionFee !== ABSENT) {
    data.transactionFee =
      overrides?.transactionFee === undefined ? "0" : overrides.transactionFee;
  }
  return { status: "success", data };
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
  const quotedAt = new Date().toISOString();
  const expiresAt = new Date(Date.parse(quotedAt) + 5 * 60_000).toISOString();
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
    quotedAt,
    expiresAt,
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

/** Per-sandbox uniqueness for seeded rows; the value itself is irrelevant. */
let boundRowSequence = 0;

/**
 * Seeds one airtime row in the exact shape the provider binding writes, with any
 * single field overridable to a crafted value for the fail-closed cases.
 */
async function seedAirtimeRow(
  sandbox: Sandbox,
  overrides?: Partial<CreateTransactionInput>,
): Promise<TransactionRecord> {
  boundRowSequence += 1;
  const suffix = String(boundRowSequence);
  const created = await sandbox.transactions.create({
    idempotencyKey: `idem_rehydrate_${suffix}`,
    type: "airtime",
    walletAddress: WALLET,
    amountUsdc: AMOUNT_USDC,
    amountNgn: AMOUNT_NGN,
    paycrestReference: `p4b_rehydrate_${suffix}`,
    paycrestOrderId: `pc_ord_rehydrate_${suffix}`,
    receiveAddress: RECEIVE_ADDRESS,
    validUntil: new Date(Date.now() + 600_000).toISOString(),
    metadata: {
      rate: RATE,
      senderFee: "0",
      transactionFee: "0",
      totalUsdcToSend: TOTAL_USDC,
    },
    ...overrides,
  });
  assert.equal(created.ok, true, "airtime row seed must succeed");
  if (!created.ok) throw new Error("unreachable");
  return created.record;
}

/** Calls the real recovery route against the sandbox's in-memory repository. */
function rehydrateTransaction(
  sandbox: Sandbox,
  transactionId: string,
  query: string,
): Promise<Response> {
  setTransactionRepositoryForTesting(sandbox.transactions);
  return getTransactionById(
    new Request(`http://localhost/api/transactions/${transactionId}${query}`),
    { params: Promise.resolve({ id: transactionId }) },
  );
}

/**
 * Reads one rehydration response, asserting the transaction DTO contract that
 * both the eligible and the ineligible cases must keep serving unchanged.
 */
async function readRehydratedBody(response: Response): Promise<{
  ok: boolean;
  transaction: { id: string; status: string; celoTxHash: string | null };
  paymentInstructions?: PaymentInstructions | null;
  paymentInstructionsError?: string;
}> {
  assert.equal(response.status, 200, "the transaction DTO must still be served");
  assert.equal(response.headers.get("cache-control"), "no-store");
  return (await response.json()) as {
    ok: boolean;
    transaction: { id: string; status: string; celoTxHash: string | null };
    paymentInstructions?: PaymentInstructions | null;
    paymentInstructionsError?: string;
  };
}

/**
 * Reads one owner-scope refusal. A refused read is a closed surface: the status
 * is the only signal, and the body carries no transaction DTO, instruction,
 * expiry code, or stage evidence.
 */
async function readRefusalBody(
  response: Response,
  expectedStatus: number,
  label: string,
): Promise<Record<string, unknown>> {
  assert.equal(response.status, expectedStatus, label);
  assert.equal(response.headers.get("cache-control"), "no-store", label);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.ok, false, label);
  assert.equal(typeof body.error, "string", label);
  assert.equal("transaction" in body, false, label);
  assert.equal("paymentInstructions" in body, false, label);
  assert.equal("paymentInstructionsError" in body, false, label);
  assert.equal("stage" in body, false, label);
  assert.equal("isFiatFinal" in body, false, label);
  return body;
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
    // The breakdown is the bound provider order, not a local estimate.
    assert.equal(success.baseUsdc, AMOUNT_USDC);
    assert.equal(success.senderFeeUsdc, "0");
    assert.equal(success.transactionFeeUsdc, "0");
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
    assert.equal(stored.metadata?.senderFee, "0");
    assert.equal(stored.metadata?.transactionFee, "0");
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
    assert.equal(amountMismatchTx?.paycrestOrderId, null);
    assert.equal(amountMismatchTx?.receiveAddress, null);

    /* ------------------------------------------------------------------ */
    /* 6b. Provider fees are the authority, never the preview estimate     */
    /* ------------------------------------------------------------------ */

    // The preview prices no provider fee; Paycrest finalizes one. The order must
    // still bind, and the caller must be told the fee-inclusive total instead of
    // the preview's under-priced estimate.
    const feeSandbox = newSandbox();
    stubFetch(() =>
      jsonResponse(
        201,
        paycrestOrderPayload({
          amount: FEE_BASE_USDC,
          senderFee: FEE_SENDER_USDC,
        }),
      ),
    );
    const feePreview = await seedPreview(feeSandbox, {
      amountUsdc: FEE_BASE_USDC,
      feeUsdc: "0",
      totalUsdc: FEE_BASE_USDC,
    });
    const feeInstructions = expectInstructions(
      await prepare(feeSandbox, feePreview.id),
    );
    assert.equal(fetchCalls.length, 1);
    assert.equal(feeInstructions.baseUsdc, FEE_BASE_USDC);
    assert.equal(feeInstructions.senderFeeUsdc, FEE_SENDER_USDC);
    assert.equal(feeInstructions.transactionFeeUsdc, "0");
    assert.equal(feeInstructions.totalUsdcToSend, FEE_TOTAL_USDC);
    // The announced total must stay exactly spendable at USDC's 6 decimals.
    assert.equal(
      usdcToBaseUnits(feeInstructions.totalUsdcToSend, 6),
      BigInt(736398),
    );

    const feeTx = await feeSandbox.transactions.findById(
      feeInstructions.transactionId,
    );
    assert.equal(feeTx?.paycrestOrderId, "pc_ord_selfcheck_1");
    assert.equal(feeTx?.receiveAddress, RECEIVE_ADDRESS);
    assert.equal(feeTx?.amountUsdc, FEE_BASE_USDC);
    // The binding replaces the preview estimate with the provider's total.
    assert.equal(feeTx?.metadata?.totalUsdcToSend, FEE_TOTAL_USDC);
    assert.equal(feeTx?.metadata?.senderFee, FEE_SENDER_USDC);
    assert.equal(feeTx?.metadata?.transactionFee, "0");

    // An unusable fee makes the whole order unusable: negative, non-numeric,
    // over-precise, exponent, null, and absent all fail closed with no binding.
    const unusableFeeResponses: Array<{ label: string; payload: unknown }> = [
      {
        label: "negative senderFee",
        payload: paycrestOrderPayload({ senderFee: "-0.01" }),
      },
      {
        label: "negative transactionFee",
        payload: paycrestOrderPayload({ transactionFee: "-1" }),
      },
      {
        label: "non-numeric senderFee",
        payload: paycrestOrderPayload({ senderFee: "abc" }),
      },
      {
        label: "exponent senderFee",
        payload: paycrestOrderPayload({ senderFee: "1e-3" }),
      },
      {
        label: "over-precise transactionFee",
        payload: paycrestOrderPayload({ transactionFee: "0.0000001" }),
      },
      {
        label: "null senderFee",
        payload: paycrestOrderPayload({ senderFee: null }),
      },
      {
        label: "absent senderFee",
        payload: paycrestOrderPayload({ senderFee: ABSENT }),
      },
      {
        label: "absent transactionFee",
        payload: paycrestOrderPayload({ transactionFee: ABSENT }),
      },
    ];

    for (const { label, payload } of unusableFeeResponses) {
      const badFeeSandbox = newSandbox();
      stubFetch(() => jsonResponse(201, payload));
      const badFeePreview = await seedPreview(badFeeSandbox);
      const badFee = expectError(await prepare(badFeeSandbox, badFeePreview.id));
      assert.equal(badFee.code, "PAYCREST_BIND_FAILED", label);
      assert.equal(fetchCalls.length, 1, `one provider call: ${label}`);
      const badFeeTx =
        await badFeeSandbox.transactions.findByIdempotencyKey(
          `idem_airtime_${badFeePreview.id}`,
        );
      assert.equal(badFeeTx?.failureCode, "ORDER_RESPONSE_UNSAFE", label);
      assert.equal(badFeeTx?.paycrestOrderId, null, `unbound: ${label}`);
      assert.equal(badFeeTx?.receiveAddress, null, `no address: ${label}`);
    }

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
      "baseUsdc",
      "ok",
      "receiveAddress",
      "senderFeeUsdc",
      "totalUsdcToSend",
      "transactionFeeUsdc",
      "transactionId",
      "validUntil",
    ]);
    assert.equal(okBody.ok, true);
    assert.equal(okBody.receiveAddress, RECEIVE_ADDRESS);
    assert.equal(okBody.totalUsdcToSend, TOTAL_USDC);
    assert.equal(okBody.baseUsdc, AMOUNT_USDC);
    assert.equal(okBody.senderFeeUsdc, "0");
    assert.equal(okBody.transactionFeeUsdc, "0");
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

    // The HTTP contract must carry the provider's fee-inclusive total, so a
    // client can never send the preview's under-priced estimate.
    const feeRouteSandbox = newSandbox();
    setPreviewRepositoryForTesting(feeRouteSandbox.previews);
    setTransactionRepositoryForTesting(feeRouteSandbox.transactions);
    stubFetch(() =>
      jsonResponse(
        201,
        paycrestOrderPayload({
          amount: FEE_BASE_USDC,
          senderFee: FEE_SENDER_USDC,
        }),
      ),
    );
    const feeRoutePreview = await seedPreview(feeRouteSandbox, {
      amountUsdc: FEE_BASE_USDC,
      feeUsdc: "0",
      totalUsdc: FEE_BASE_USDC,
    });
    const feeRouteResponse = await POST(
      new Request("http://localhost/api/assistant/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          previewId: feeRoutePreview.id,
          walletAddress: WALLET,
        }),
      }),
    );
    assert.equal(feeRouteResponse.status, 200);
    const feeRouteBody = (await feeRouteResponse.json()) as Record<string, unknown>;
    assert.equal(feeRouteBody.baseUsdc, FEE_BASE_USDC);
    assert.equal(feeRouteBody.senderFeeUsdc, FEE_SENDER_USDC);
    assert.equal(feeRouteBody.transactionFeeUsdc, "0");
    assert.equal(feeRouteBody.totalUsdcToSend, FEE_TOTAL_USDC);
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
    // The replay path re-derives the breakdown from the bound row.
    assert.equal(firstInstructions.baseUsdc, AMOUNT_USDC);
    assert.equal(firstInstructions.senderFeeUsdc, "0");
    assert.equal(firstInstructions.transactionFeeUsdc, "0");
    assert.equal(secondInstructions.totalUsdcToSend, TOTAL_USDC);

    // A bound row without a provider-authoritative total must fail closed. The
    // base amount is never a substitute: the fees finalized on order creation
    // would silently go unpaid, so the client must not be handed instructions.
    const unboundTotalSandbox = newSandbox();
    stubFetch(() => jsonResponse(201, paycrestOrderPayload()));
    const unboundTotalPreview = await seedPreview(unboundTotalSandbox);
    const unboundTotalRow = await unboundTotalSandbox.transactions.create({
      idempotencyKey: `idem_airtime_${unboundTotalPreview.id}`,
      type: "airtime",
      walletAddress: WALLET,
      amountUsdc: AMOUNT_USDC,
      amountNgn: AMOUNT_NGN,
      paycrestReference: "p4b_bound_without_total",
      paycrestOrderId: "pc_ord_legacy_1",
      receiveAddress: RECEIVE_ADDRESS,
      validUntil: new Date(Date.now() + 600_000).toISOString(),
      metadata: { rate: RATE },
    });
    assert.equal(unboundTotalRow.ok, true, "bound-row seed must succeed");
    if (!unboundTotalRow.ok) return;

    const unboundTotalResult = expectError(
      await prepareAirtimePaymentOrder({
        previewId: unboundTotalPreview.id,
        walletAddress: WALLET,
        options: {
          previewRepository: new ReplayPreviewRepository(unboundTotalPreview),
          transactionRepository: unboundTotalSandbox.transactions,
        },
      }),
    );
    assert.equal(unboundTotalResult.code, "ORDER_CREATION_OUTCOME_UNKNOWN");
    assert.equal(fetchCalls.length, 0, "an unusable bound row is never re-ordered");
    const unboundTotalTx = await unboundTotalSandbox.transactions.findById(
      unboundTotalRow.record.id,
    );
    assert.equal(unboundTotalTx?.status, "failed");
    assert.equal(unboundTotalTx?.failureCode, "ORDER_CREATION_OUTCOME_UNKNOWN");

    // The same refusal covers every unusable recorded binding — an untrustworthy
    // total or provider fee — while a padded but valid row is trimmed and
    // honored exactly as bound.
    const boundRowCases: Array<{
      label: string;
      metadata: TransactionMetadata;
      usable: boolean;
    }> = [
      {
        label: "non-string total",
        // A legacy row can persist any JSON the older provider path wrote, so
        // the fixture must reproduce an out-of-contract total to prove refusal.
        metadata: {
          rate: RATE,
          senderFee: "0",
          transactionFee: "0",
          totalUsdcToSend: 0.333334,
        } as unknown as TransactionMetadata,
        usable: false,
      },
      {
        label: "blank total",
        metadata: {
          rate: RATE,
          senderFee: "0",
          transactionFee: "0",
          totalUsdcToSend: "   ",
        },
        usable: false,
      },
      {
        label: "malformed total",
        metadata: {
          rate: RATE,
          senderFee: "0",
          transactionFee: "0",
          totalUsdcToSend: "not-a-total",
        },
        usable: false,
      },
      {
        label: "over-precise total",
        metadata: {
          rate: RATE,
          senderFee: "0",
          transactionFee: "0",
          totalUsdcToSend: "0.3333344",
        },
        usable: false,
      },
      {
        label: "zero total",
        metadata: {
          rate: RATE,
          senderFee: "0",
          transactionFee: "0",
          totalUsdcToSend: "0.000000",
        },
        usable: false,
      },
      {
        label: "malformed senderFee",
        metadata: {
          rate: RATE,
          senderFee: "abc",
          transactionFee: "0",
          totalUsdcToSend: TOTAL_USDC,
        },
        usable: false,
      },
      {
        label: "negative transactionFee",
        metadata: {
          rate: RATE,
          senderFee: "0",
          transactionFee: "-1",
          totalUsdcToSend: TOTAL_USDC,
        },
        usable: false,
      },
      {
        label: "absent fee fields",
        metadata: { rate: RATE, totalUsdcToSend: TOTAL_USDC },
        usable: false,
      },
      {
        label: "padded valid row",
        metadata: {
          rate: RATE,
          senderFee: " 0 ",
          transactionFee: "0",
          totalUsdcToSend: `  ${TOTAL_USDC}  `,
        },
        usable: true,
      },
    ];

    for (const { label, metadata, usable } of boundRowCases) {
      const totalSandbox = newSandbox();
      stubFetch(() => jsonResponse(201, paycrestOrderPayload()));
      const totalPreview = await seedPreview(totalSandbox);
      const totalRow = await totalSandbox.transactions.create({
        idempotencyKey: `idem_airtime_${totalPreview.id}`,
        type: "airtime",
        walletAddress: WALLET,
        amountUsdc: AMOUNT_USDC,
        amountNgn: AMOUNT_NGN,
        paycrestReference: "p4b_bound_total_case",
        paycrestOrderId: "pc_ord_bound_total",
        receiveAddress: RECEIVE_ADDRESS,
        validUntil: new Date(Date.now() + 600_000).toISOString(),
        metadata,
      });
      assert.equal(totalRow.ok, true, label);

      const totalResult = await prepareAirtimePaymentOrder({
        previewId: totalPreview.id,
        walletAddress: WALLET,
        options: {
          previewRepository: new ReplayPreviewRepository(totalPreview),
          transactionRepository: totalSandbox.transactions,
        },
      });

      if (usable) {
        const instructions = expectInstructions(totalResult);
        assert.equal(instructions.totalUsdcToSend, TOTAL_USDC, label);
        assert.equal(instructions.baseUsdc, AMOUNT_USDC, label);
        assert.equal(instructions.senderFeeUsdc, "0", label);
        assert.equal(instructions.transactionFeeUsdc, "0", label);
        continue;
      }
      const refused = expectError(totalResult);
      assert.equal(refused.code, "ORDER_CREATION_OUTCOME_UNKNOWN", label);
      assert.equal(fetchCalls.length, 0, `no provider call: ${label}`);
    }

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

    /* ------------------------------------------------------------------ */
    /* 9. Deposit rehydration: opt-in, id-addressed, ownership-gated       */
    /* ------------------------------------------------------------------ */

    // A rehydration read of a pending order must never reach the provider: any
    // upstream call would be an unrequested financial side effect. The stub
    // answers 500 so a stray call also shows up in the recorded call count.
    stubFetch(() => jsonResponse(500, { status: "error", message: "unexpected" }));

    const rehydrationSandbox = newSandbox();
    const boundRow = await seedAirtimeRow(rehydrationSandbox);
    const ownQuery = `?paymentInstructions=true&walletAddress=${WALLET}`;

    // The stored wallet is the lowercased form and the query carries the
    // checksummed one: both spellings address the same owner.
    const rehydrated = await readRehydratedBody(
      await rehydrateTransaction(rehydrationSandbox, boundRow.id, ownQuery),
    );
    assert.equal(rehydrated.ok, true);
    assert.equal(rehydrated.transaction.id, boundRow.id);
    assert.deepEqual(rehydrated.paymentInstructions, {
      transactionId: boundRow.id,
      receiveAddress: RECEIVE_ADDRESS,
      baseUsdc: AMOUNT_USDC,
      senderFeeUsdc: "0",
      transactionFeeUsdc: "0",
      totalUsdcToSend: TOTAL_USDC,
      validUntil: boundRow.validUntil,
    });
    assert.equal("paymentInstructionsError" in rehydrated, false);

    // Repeated reads are stable and leave the row byte-identical: rehydration
    // never funds, re-binds, or re-orders anything.
    const beforeReads = JSON.stringify(boundRow);
    const repeated = await readRehydratedBody(
      await rehydrateTransaction(
        rehydrationSandbox,
        boundRow.id,
        `?paymentInstructions=true&walletAddress=${WALLET.toLowerCase()}`,
      ),
    );
    assert.deepEqual(repeated.paymentInstructions, rehydrated.paymentInstructions);
    assert.equal(
      JSON.stringify(await rehydrationSandbox.transactions.findById(boundRow.id)),
      beforeReads,
    );

    // A read that never opted in keeps the legacy body exactly: no rehydration
    // key of any kind, so existing consumers see byte-identical responses.
    const omittedReads: Array<{ label: string; query: string }> = [
      { label: "not opted in", query: "" },
      { label: "wallet without the flag", query: `?walletAddress=${WALLET}` },
      {
        label: "explicit false",
        query: `?paymentInstructions=false&walletAddress=${WALLET}`,
      },
    ];

    for (const { label, query } of omittedReads) {
      const response = await readRehydratedBody(
        await rehydrateTransaction(rehydrationSandbox, boundRow.id, query),
      );
      assert.equal(response.transaction.id, boundRow.id, label);
      assert.equal("paymentInstructions" in response, false, label);
      assert.equal("paymentInstructionsError" in response, false, label);
    }

    // Owner-scoped reads are gated by the server before reconciliation and
    // before any DTO is built. A missing wallet context is refused with 401, a
    // malformed one with 400, and another wallet's address with one generic 403.
    // Every refusal is closed: no transaction DTO, no instruction, no expiry
    // code, and no echo of the id, owner, destination, or amount.
    const refusalReads: Array<{
      label: string;
      query: string;
      status: number;
    }> = [
      { label: "missing wallet", query: "?paymentInstructions=true", status: 401 },
      {
        label: "blank wallet",
        query: "?paymentInstructions=true&walletAddress=%20",
        status: 401,
      },
      {
        label: "malformed wallet",
        query: "?paymentInstructions=true&walletAddress=0xnot-an-address",
        status: 400,
      },
      {
        label: "foreign wallet",
        query: `?paymentInstructions=true&walletAddress=${OTHER_WALLET}`,
        status: 403,
      },
      {
        label: "receipt scope, missing wallet",
        query: "?scope=receipt",
        status: 401,
      },
      {
        label: "receipt scope, malformed wallet",
        query: "?scope=receipt&walletAddress=0xnot-an-address",
        status: 400,
      },
      {
        label: "receipt scope, foreign wallet",
        query: `?scope=receipt&walletAddress=${OTHER_WALLET}`,
        status: 403,
      },
    ];

    for (const { label, query, status } of refusalReads) {
      const refusal = await readRefusalBody(
        await rehydrateTransaction(rehydrationSandbox, boundRow.id, query),
        status,
        label,
      );
      const serialized = JSON.stringify(refusal);
      assert.equal(serialized.includes(boundRow.id), false, `${label}: no id`);
      assert.equal(
        serialized.includes(WALLET.toLowerCase()),
        false,
        `${label}: no owner wallet`,
      );
      assert.equal(
        serialized.includes(OTHER_WALLET),
        false,
        `${label}: no presented wallet echo`,
      );
      assert.equal(
        serialized.includes(RECEIVE_ADDRESS),
        false,
        `${label}: no destination address`,
      );
      assert.equal(serialized.includes(AMOUNT_USDC), false, `${label}: no amount`);
    }

    // An explicit owner-scoped receipt read serves the same DTO to the owning
    // wallet, and only to it. It is not an opt-in instruction read: the
    // rehydration keys stay absent exactly as on the legacy body.
    const receiptScopeRead = await readRehydratedBody(
      await rehydrateTransaction(
        rehydrationSandbox,
        boundRow.id,
        `?scope=receipt&walletAddress=${WALLET}`,
      ),
    );
    assert.equal(receiptScopeRead.transaction.id, boundRow.id);
    assert.equal("paymentInstructions" in receiptScopeRead, false);
    assert.equal("paymentInstructionsError" in receiptScopeRead, false);

    // The paycrestOrderId fallback still serves the DTO, but it is a lookup
    // convenience, never ownership proof: no instructions may be minted from it,
    // and the explicit refusal must not imply anything about the order.
    const orderIdRead = await readRehydratedBody(
      await rehydrateTransaction(
        rehydrationSandbox,
        boundRow.paycrestOrderId ?? "",
        ownQuery,
      ),
    );
    assert.equal(orderIdRead.transaction.id, boundRow.id);
    assert.equal(orderIdRead.paymentInstructions, null);
    assert.equal("paymentInstructionsError" in orderIdRead, false);

    // Per-field eligibility: each row is a realistically bound airtime order
    // with exactly one eligibility input broken.
    const ineligibleRows: Array<{
      label: string;
      overrides: Partial<CreateTransactionInput>;
    }> = [
      { label: "cash_out type", overrides: { type: "cash_out" } },
      { label: "no paycrest order id", overrides: { paycrestOrderId: null } },
      { label: "no receive address", overrides: { receiveAddress: null } },
      {
        label: "malformed receive address",
        overrides: { receiveAddress: "0xnot-an-address" },
      },
      { label: "no validUntil", overrides: { validUntil: null } },
      {
        label: "unparsable validUntil",
        overrides: { validUntil: "not-a-timestamp" },
      },
      {
        label: "missing total",
        overrides: { metadata: { rate: RATE, senderFee: "0", transactionFee: "0" } },
      },
      {
        label: "zero total",
        overrides: {
          metadata: {
            rate: RATE,
            senderFee: "0",
            transactionFee: "0",
            totalUsdcToSend: "0.000000",
          },
        },
      },
      {
        label: "unparsable total",
        overrides: {
          metadata: {
            rate: RATE,
            senderFee: "0",
            transactionFee: "0",
            totalUsdcToSend: "not-a-total",
          },
        },
      },
      {
        label: "malformed senderFee",
        overrides: {
          metadata: {
            rate: RATE,
            senderFee: "abc",
            transactionFee: "0",
            totalUsdcToSend: TOTAL_USDC,
          },
        },
      },
      {
        label: "negative transactionFee",
        overrides: {
          metadata: {
            rate: RATE,
            senderFee: "0",
            transactionFee: "-1",
            totalUsdcToSend: TOTAL_USDC,
          },
        },
      },
      {
        label: "absent fee fields",
        overrides: { metadata: { rate: RATE, totalUsdcToSend: TOTAL_USDC } },
      },
    ];

    for (const { label, overrides } of ineligibleRows) {
      const sandbox = newSandbox();
      const row = await seedAirtimeRow(sandbox, overrides);
      const response = await readRehydratedBody(
        await rehydrateTransaction(sandbox, row.id, ownQuery),
      );
      assert.equal(response.transaction.id, row.id, label);
      assert.equal(response.paymentInstructions, null, label);
      // Only a proven expiry of an otherwise payable order carries a reason; a
      // broken binding, fee, or status says nothing beyond `null`.
      assert.equal("paymentInstructionsError" in response, false, label);
    }

    // An elapsed window is refused without retrying anything: the caller gets
    // the truthful row, an explicit null, and the one safe reason it is owed —
    // the provider-bound state stays exactly as recorded.
    const expiredReadSandbox = newSandbox();
    const expiredBoundRow = await seedAirtimeRow(expiredReadSandbox, {
      validUntil: new Date(Date.now() - 1_000).toISOString(),
    });
    const expiredRead = await readRehydratedBody(
      await rehydrateTransaction(expiredReadSandbox, expiredBoundRow.id, ownQuery),
    );
    assert.equal(expiredRead.paymentInstructions, null);
    assert.equal(expiredRead.paymentInstructionsError, "PAYMENT_ORDER_EXPIRED");
    assert.equal(expiredRead.transaction.status, "pending");
    assert.equal(
      JSON.stringify(
        await expiredReadSandbox.transactions.findById(expiredBoundRow.id),
      ),
      JSON.stringify(expiredBoundRow),
    );

    // The expiry reason is not an oracle: the same elapsed row read with another
    // wallet's address is refused before the expiry is ever judged, or found by
    // paycrestOrderId rather than its own id, is refused with a bare null.
    await readRefusalBody(
      await rehydrateTransaction(
        expiredReadSandbox,
        expiredBoundRow.id,
        `?paymentInstructions=true&walletAddress=${OTHER_WALLET}`,
      ),
      403,
      "an unowned read must not learn the expiry reason",
    );

    const expiredByOrderId = await readRehydratedBody(
      await rehydrateTransaction(
        expiredReadSandbox,
        expiredBoundRow.paycrestOrderId ?? "",
        ownQuery,
      ),
    );
    assert.equal(expiredByOrderId.paymentInstructions, null);
    assert.equal("paymentInstructionsError" in expiredByOrderId, false);

    // An elapsed window never excuses corrupted metadata: an owned elapsed row
    // with an unusable fee or total is refused with a bare null, so the expiry
    // reason always describes a row that is payable in every other respect.
    const elapsedCorruptRows: Array<{
      label: string;
      metadata: TransactionMetadata;
    }> = [
      {
        label: "elapsed with absent fees",
        metadata: { rate: RATE, totalUsdcToSend: TOTAL_USDC },
      },
      {
        label: "elapsed with malformed senderFee",
        metadata: {
          rate: RATE,
          senderFee: "abc",
          transactionFee: "0",
          totalUsdcToSend: TOTAL_USDC,
        },
      },
      {
        label: "elapsed with missing total",
        metadata: { rate: RATE, senderFee: "0", transactionFee: "0" },
      },
    ];

    for (const { label, metadata } of elapsedCorruptRows) {
      const sandbox = newSandbox();
      const row = await seedAirtimeRow(sandbox, {
        validUntil: new Date(Date.now() - 1_000).toISOString(),
        metadata,
      });
      const response = await readRehydratedBody(
        await rehydrateTransaction(sandbox, row.id, ownQuery),
      );
      assert.equal(response.paymentInstructions, null, label);
      assert.equal("paymentInstructionsError" in response, false, label);
    }

    assert.equal(
      fetchCalls.length,
      0,
      "an unfunded rehydration read must never call the provider",
    );

    // A settling row is a deposit already in flight and a bound Celo hash means
    // the money moved: both are refused so a client can never be told to pay
    // twice. An opt-in read is a pure read here too — neither the row's status
    // nor an accompanying `reconcile=true` may make it reach the provider.
    stubFetch(() => jsonResponse(500, { status: "error", message: "unexpected" }));

    const settlingSandbox = newSandbox();
    const settlingRow = await seedAirtimeRow(settlingSandbox);
    const settlingUpdate = await settlingSandbox.transactions.updateStatus(
      settlingRow.id,
      { status: "settling" },
    );
    assert.equal(settlingUpdate.ok, true);
    const settlingRead = await readRehydratedBody(
      await rehydrateTransaction(settlingSandbox, settlingRow.id, ownQuery),
    );
    assert.equal(settlingRead.paymentInstructions, null, "settling row");
    assert.equal("paymentInstructionsError" in settlingRead, false, "settling row");
    assert.equal(
      JSON.stringify(await settlingSandbox.transactions.findById(settlingRow.id)),
      JSON.stringify(settlingUpdate.ok ? settlingUpdate.record : null),
      "an opt-in read must leave the settling row untouched",
    );

    // Precedence is by context, not by clock: an elapsed order that is no longer
    // payable for another reason is refused before its window is ever judged, so
    // it carries no expiry reason either.
    const elapsedSettlingSandbox = newSandbox();
    const elapsedSettlingRow = await seedAirtimeRow(elapsedSettlingSandbox, {
      validUntil: new Date(Date.now() - 1_000).toISOString(),
    });
    const elapsedSettlingUpdate =
      await elapsedSettlingSandbox.transactions.updateStatus(elapsedSettlingRow.id, {
        status: "settling",
      });
    assert.equal(elapsedSettlingUpdate.ok, true);
    const elapsedSettlingRead = await readRehydratedBody(
      await rehydrateTransaction(
        elapsedSettlingSandbox,
        elapsedSettlingRow.id,
        ownQuery,
      ),
    );
    assert.equal(elapsedSettlingRead.paymentInstructions, null);
    assert.equal("paymentInstructionsError" in elapsedSettlingRead, false);

    const fundedSandbox = newSandbox();
    const fundedRow = await seedAirtimeRow(fundedSandbox);
    const celoTxHash = `0x${"ab".repeat(32)}`;
    const fundedUpdate = await fundedSandbox.transactions.bindCeloTxHash({
      id: fundedRow.id,
      celoTxHash,
    });
    assert.equal(fundedUpdate.ok, true);
    const fundedRead = await readRehydratedBody(
      await rehydrateTransaction(fundedSandbox, fundedRow.id, ownQuery),
    );
    assert.equal(fundedRead.paymentInstructions, null, "funded row");
    assert.equal("paymentInstructionsError" in fundedRead, false, "funded row");
    assert.equal(fundedRead.transaction.celoTxHash, celoTxHash);

    // Neither status nor an explicit `reconcile=true` can make an opt-in read
    // reach the provider: no row is ever re-read, re-priced, or re-ordered.
    const optedInReconcileRead = await readRehydratedBody(
      await rehydrateTransaction(
        settlingSandbox,
        settlingRow.id,
        `?reconcile=true&paymentInstructions=true&walletAddress=${WALLET}`,
      ),
    );
    assert.equal(optedInReconcileRead.paymentInstructions, null);
    assert.equal("paymentInstructionsError" in optedInReconcileRead, false);
    assert.equal(
      fetchCalls.length,
      0,
      "an opt-in read must never trigger provider reconciliation",
    );

    // The legacy reconcile path is untouched: the same settling row read without
    // the payment flag still reconciles exactly as before, and an upstream answer
    // it cannot read leaves the recorded state truthful.
    const legacyReconcileRead = await readRehydratedBody(
      await rehydrateTransaction(settlingSandbox, settlingRow.id, "?reconcile=true"),
    );
    assert.equal("paymentInstructions" in legacyReconcileRead, false);
    assert.equal(legacyReconcileRead.transaction.status, "settling");
    assert.equal(
      fetchCalls.length,
      1,
      "a read without the payment flag still reconciles",
    );

    // Ownership is proven before the provider is touched. A receipt-scoped read
    // of a settling row by the owner still reconciles exactly like the public
    // reconcile path, while the same read by another wallet is refused without a
    // single upstream call: the gate can never be jumped by asking to reconcile.
    stubFetch(() => jsonResponse(500, { status: "error", message: "unexpected" }));
    const ownedReceiptReconcileRead = await readRehydratedBody(
      await rehydrateTransaction(
        settlingSandbox,
        settlingRow.id,
        `?reconcile=true&scope=receipt&walletAddress=${WALLET}`,
      ),
    );
    assert.equal(ownedReceiptReconcileRead.transaction.id, settlingRow.id);
    assert.equal("paymentInstructions" in ownedReceiptReconcileRead, false);
    assert.equal(
      fetchCalls.length,
      1,
      "an owned receipt read still reconciles like the public path",
    );

    const foreignReceiptReconcileRead = await rehydrateTransaction(
      settlingSandbox,
      settlingRow.id,
      `?reconcile=true&scope=receipt&walletAddress=${OTHER_WALLET}`,
    );
    await readRefusalBody(
      foreignReceiptReconcileRead,
      403,
      "an unowned receipt read must be refused",
    );
    assert.equal(
      fetchCalls.length,
      1,
      "an unowned receipt read must never reconcile",
    );

    // An unknown id keeps its 404 shape, and the error body carries no
    // rehydration key at all.
    const missingId = "tx_missing_rehydrate";
    setTransactionRepositoryForTesting(rehydrationSandbox.transactions);
    const missingResponse = await getTransactionById(
      new Request(`http://localhost/api/transactions/${missingId}${ownQuery}`),
      { params: Promise.resolve({ id: missingId }) },
    );
    assert.equal(missingResponse.status, 404);
    const missingBody = (await missingResponse.json()) as Record<string, unknown>;
    assert.equal(missingBody.ok, false);
    assert.equal("paymentInstructions" in missingBody, false);
    assert.equal("paymentInstructionsError" in missingBody, false);

    /* ------------------------------------------------------------------ */
    /* 10. cNGN: the quote's asset drives the order, the binding and the    */
    /*     instructions end to end                                          */
    /* ------------------------------------------------------------------ */

    applyValidSettlementEnv();

    const cngnAmountNgn = "1000";
    const cngnRate = "0.9";
    // The exact ceiling inverse quote for the cNGN corridor: 1000 / 0.9 at 6
    // base-unit decimals, rounded up so the deposit can never under-fund it.
    const cngnAmountUsdc = divideDecimalStrings(cngnAmountNgn, cngnRate, 6, "ceil");
    assert.equal(cngnAmountUsdc, "1111.111112", "cNGN quote is the ceiling inverse");
    assert.equal(cngnAmountUsdc === (cngnAmountNgn as string), false);
    const cngnTotalUsdc = "1111.861112"; // ceil quote + provider fees below

    const cngnSandbox = newSandbox();
    const cngnValidUntil = new Date(Date.now() + 600_000).toISOString();
    stubFetch(() =>
      jsonResponse(
        201,
        paycrestOrderPayload({
          orderId: "pc_ord_cngn_1",
          validUntil: cngnValidUntil,
          token: "CNGN",
          rate: cngnRate,
          amount: cngnAmountUsdc,
          senderFee: "0.5",
          transactionFee: "0.25",
        }),
      ),
    );
    const cngnPreview = await seedPreview(cngnSandbox, {
      asset: "CNGN",
      amountNgn: cngnAmountNgn,
      rate: cngnRate,
      amountUsdc: cngnAmountUsdc,
      totalUsdc: cngnAmountUsdc,
    });
    assert.equal(cngnPreview.asset, "CNGN");

    const cngnInstructions = expectInstructions(
      await prepare(cngnSandbox, cngnPreview.id),
    );
    assert.equal(cngnInstructions.asset, "CNGN", "the instruction names the cNGN asset");
    assert.equal(cngnInstructions.baseUsdc, cngnAmountUsdc);
    assert.equal(cngnInstructions.senderFeeUsdc, "0.5");
    assert.equal(cngnInstructions.transactionFeeUsdc, "0.25");
    assert.equal(cngnInstructions.totalUsdcToSend, cngnTotalUsdc);
    assert.equal(cngnInstructions.receiveAddress, RECEIVE_ADDRESS);
    assert.equal(cngnInstructions.validUntil, cngnValidUntil);
    assert.equal(fetchCalls.length, 1);

    const cngnOutgoing = fetchCalls[0].body as unknown as OutgoingOrderBody;
    assert.equal(cngnOutgoing.amount, cngnAmountUsdc, "the cNGN order is priced in the ceil quote");
    assert.equal(cngnOutgoing.source.currency, "CNGN");
    assert.equal(cngnOutgoing.source.network, "celo");
    assert.equal(cngnOutgoing.source.refundAddress, WALLET.toLowerCase());
    assert.equal(cngnOutgoing.destination.recipient.memo, MEMO);

    const cngnStored = await cngnSandbox.transactions.findById(
      cngnInstructions.transactionId,
    );
    assert.notEqual(cngnStored, null);
    if (!cngnStored) return;
    assert.equal(cngnStored.status, "pending");
    assert.equal(cngnStored.amountUsdc, cngnAmountUsdc);
    assert.equal(cngnStored.amountNgn, cngnAmountNgn);
    assert.equal(cngnStored.metadata?.asset, "CNGN");
    assert.equal(cngnStored.metadata?.rate, cngnRate);
    assert.equal(cngnStored.metadata?.totalUsdcToSend, cngnTotalUsdc);
    assert.equal(cngnStored.paycrestOrderId, "pc_ord_cngn_1");

    // A provider order priced in another asset than the quote is refused
    // outright: the deposit instruction would name the wrong token.
    const cngnMismatchSandbox = newSandbox();
    stubFetch(() =>
      jsonResponse(
        201,
        paycrestOrderPayload({
          orderId: "pc_ord_cngn_mismatch",
          validUntil: cngnValidUntil,
          token: "USDC",
          amount: cngnAmountUsdc,
        }),
      ),
    );
    const cngnMismatchPreview = await seedPreview(cngnMismatchSandbox, {
      asset: "CNGN",
      amountNgn: cngnAmountNgn,
      rate: cngnRate,
      amountUsdc: cngnAmountUsdc,
      totalUsdc: cngnAmountUsdc,
    });

    const cngnMismatchResult = await prepare(
      cngnMismatchSandbox,
      cngnMismatchPreview.id,
    );
    const cngnMismatchError = expectError(cngnMismatchResult);
    assert.equal(cngnMismatchError.code, "PAYCREST_BIND_FAILED");
    assert.equal(
      "data" in cngnMismatchResult,
      false,
      "a currency mismatch never yields instructions",
    );
    assert.equal(fetchCalls.length, 1, "a currency mismatch is never retried");

    const cngnMismatchRow =
      await cngnMismatchSandbox.transactions.findByIdempotencyKey(
        `idem_airtime_${cngnMismatchPreview.id}`,
      );
    assert.notEqual(cngnMismatchRow, null);
    assert.equal(cngnMismatchRow?.status, "failed");
    assert.equal(cngnMismatchRow?.failureCode, "ORDER_RESPONSE_UNSAFE");
    assert.equal(cngnMismatchRow?.failureReason, "Unexpected order currency");
    assert.equal(cngnMismatchRow?.paycrestOrderId, null);
    assert.equal(cngnMismatchRow?.metadata?.asset, undefined);

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
