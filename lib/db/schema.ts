import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Supported internal transaction statuses across Providus transaction lifecycles:
 *
 * cash_out:
 *   pending -> settling -> settled
 *   ('settled' represents confirmed fiat delivery and serves as effective terminal business outcome)
 *
 * future utility (e.g. airtime / data):
 *   pending -> settling -> settled -> processing -> completed
 *   ('settled' represents confirmed fiat delivery into utility liquidity/escrow rail,
 *    which then transitions to 'processing' for third-party fulfilment and 'completed' on final success)
 *
 * terminal failure modes:
 *   failed: order creation, deposit, or fulfilment definitely failed (universally terminal)
 *   refunded: deposit refunded to user refund address on Celo (universally terminal)
 */
export const TRANSACTION_STATUSES = [
  "pending",
  "settling",
  "settled",
  "processing",
  "completed",
  "failed",
  "refunded",
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_TYPES = ["cash_out", "airtime"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const agentTransactions = pgTable(
  "agent_transactions",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    type: text("type").notNull().default("cash_out"),
    status: text("status").notNull().default("pending"),
    walletAddress: text("wallet_address").notNull(),
    amountUsdc: text("amount_usdc").notNull(),
    amountNgn: text("amount_ngn"),
    celoTxHash: text("celo_tx_hash"),
    paycrestOrderId: text("paycrest_order_id"),
    paycrestReference: text("paycrest_reference").notNull(),
    paycrestStatus: text("paycrest_status"),
    receiveAddress: text("receive_address"),
    validUntil: timestamp("valid_until", { withTimezone: true, mode: "string" }),
    failureCode: text("failure_code"),
    failureReason: text("failure_reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_tx_idempotency_idx").on(table.idempotencyKey),
    uniqueIndex("agent_tx_paycrest_ref_idx").on(table.paycrestReference),
    index("agent_tx_wallet_idx").on(table.walletAddress),
    index("agent_tx_order_id_idx").on(table.paycrestOrderId),
    index("agent_tx_status_idx").on(table.status),
  ],
);

export type AgentTransaction = typeof agentTransactions.$inferSelect;
export type NewAgentTransaction = typeof agentTransactions.$inferInsert;

/**
 * Server-authoritative airtime quotes.
 *
 * A row is the only thing that can authorize payment preparation: the client
 * receives the generated `id` (format `prev_${uuid}`) and hands it back, so no
 * quote value ever has to be trusted from the browser. `consumed_at` and
 * `transaction_id` are written exactly once by the atomic single-use
 * consumption transition, and `expires_at` bounds the 60-second quote window.
 * `asset` records the supported Celo payment asset the quote was priced in and
 * defaults to USDC, so a row written before the column existed reads back as a
 * USDC quote.
 */
export const airtimePreviews = pgTable(
  "airtime_previews",
  {
    id: text("id").primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    intentFingerprint: text("intent_fingerprint").notNull(),
    amountNgn: text("amount_ngn").notNull(),
    phone: text("phone").notNull(),
    network: text("network").notNull(),
    asset: text("asset").notNull().default("USDC"),
    rate: text("rate").notNull(),
    amountUsdc: text("amount_usdc").notNull(),
    feeUsdc: text("fee_usdc").notNull().default("0"),
    totalUsdc: text("total_usdc").notNull(),
    quotedAt: timestamp("quoted_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      mode: "string",
    }),
    transactionId: text("transaction_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("preview_wallet_idx").on(table.walletAddress),
    index("preview_fingerprint_idx").on(table.intentFingerprint),
    index("preview_tx_idx").on(table.transactionId),
  ],
);

/**
 * A stored preview row.
 *
 * `asset` is read as optional on purpose: the asset column is not yet migrated
 * in every environment and hand-built records carry none, so an absent asset
 * means the legacy USDC default and no reader may assume a value a
 * pre-migration row cannot have.
 */
export type AirtimePreviewRecord = Omit<
  typeof airtimePreviews.$inferSelect,
  "asset"
> & { asset?: string };
export type NewAirtimePreviewRecord = typeof airtimePreviews.$inferInsert;

/**
 * B2 — Wallet-owned trusted recipients (multichain conversational payments).
 *
 * Additive table: no change to agent_transactions, airtime_previews, or any
 * Paycrest/ClubKonnect state. Ownership ALWAYS derives from the verified
 * wallet session, never from request data.
 *
 * - `ownerAddress` is the checksummed authenticated wallet.
 * - The same display label may exist on MULTIPLE chains (e.g. "Douglas" on
 *   Celo and on BOT Chain) with different addresses; resolution is always
 *   scoped to one chain ID, so cross-chain mix-ups cannot happen.
 * - Duplicate ACTIVE labels within one owner + chain are rejected. Soft-deleted
 *   rows (`is_active = false`) are excluded by the partial unique index, so a
 *   label can be reused after deletion.
 * - `version` increments on every rename/address change; writers must pass
 *   the version they read (optimistic concurrency) so stale edits fail.
 * - Labels are NOT verified real-world identity — display only.
 * - Never store recipient data in LLM chat history as source of truth; the
 *   database row is authoritative. B3 payment intents must snapshot
 *   (recipient id + version + address) rather than live-reading this table.
 */
export const savedRecipients = pgTable(
  "saved_recipients",
  {
    id: text("id").primaryKey(),
    ownerAddress: text("owner_address").notNull(),
    label: text("label").notNull(),
    normalizedLabel: text("normalized_label").notNull(),
    recipientType: text("recipient_type").notNull().default("wallet"),
    chainId: integer("chain_id").notNull(),
    address: text("address").notNull(),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("saved_rcp_owner_label_chain_idx")
      .on(table.ownerAddress, table.normalizedLabel, table.chainId)
      .where(sql`${table.isActive} = true`),
    index("saved_rcp_owner_idx").on(table.ownerAddress),
    index("saved_rcp_owner_chain_idx").on(table.ownerAddress, table.chainId),
  ],
);

export type SavedRecipient = typeof savedRecipients.$inferSelect;
export type NewSavedRecipient = typeof savedRecipients.$inferInsert;

/**
 * B2 — Non-sensitive audit trail for recipient address lifecycle.
 *
 * Stores only addresses, versions, and timestamps — no auth tokens, no
 * session data, no associations beyond owner + recipient id. One row per
 * create / address change / delete.
 */
export const recipientAddressAudits = pgTable(
  "recipient_address_audits",
  {
    id: text("id").primaryKey(),
    recipientId: text("recipient_id").notNull(),
    ownerAddress: text("owner_address").notNull(),
    chainId: integer("chain_id").notNull(),
    oldAddress: text("old_address"),
    newAddress: text("new_address"),
    oldVersion: integer("old_version").notNull(),
    newVersion: integer("new_version").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("rcp_audit_recipient_idx").on(table.recipientId),
    index("rcp_audit_owner_idx").on(table.ownerAddress),
  ],
);

export type RecipientAddressAudit = typeof recipientAddressAudits.$inferSelect;
export type NewRecipientAddressAudit = typeof recipientAddressAudits.$inferInsert;

/**
 * B2.1 — Durable wallet-auth state for multi-instance deployments.
 *
 * Process-local Maps are NOT safe on Vercel (many concurrent instances), so
 * login nonces, logout revocations, and rate-limit counters live here in the
 * existing Neon PostgreSQL instead. All consumption paths are single-statement
 * atomic operations (DELETE ... RETURNING, INSERT ... ON CONFLICT) so exactly
 * one instance wins a race. Rows are short-lived by design; `expires_at` /
 * `window_start` bound every row and pruning deletes anything stale, so these
 * tables cannot grow without bound.
 *
 * Privacy: nonces bind to wallet addresses only for the minutes a challenge
 * is alive; revocations hold opaque session ids; counters hold hashed keys.
 * No secrets, signatures, or cookies are stored here — ever.
 */
export const authNonces = pgTable(
  "auth_nonces",
  {
    nonce: text("nonce").primaryKey(),
    address: text("address").notNull(),
    chainId: integer("chain_id").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("auth_nonce_exp_idx").on(table.expiresAt)],
);

export type AuthNonceRow = typeof authNonces.$inferSelect;
export type NewAuthNonceRow = typeof authNonces.$inferInsert;

export const authRevokedSessions = pgTable(
  "auth_revoked_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("auth_revoked_exp_idx").on(table.expiresAt)],
);

export type AuthRevokedSessionRow = typeof authRevokedSessions.$inferSelect;
export type NewAuthRevokedSessionRow = typeof authRevokedSessions.$inferInsert;

export const authRateCounters = pgTable(
  "auth_rate_counters",
  {
    key: text("key").notNull(),
    windowStart: bigint("window_start", { mode: "number" }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [
    uniqueIndex("auth_rate_key_window_idx").on(table.key, table.windowStart),
    index("auth_rate_key_idx").on(table.key),
  ],
);

/**
 * B3 — Server-authoritative wallet_transfer PaymentIntent rows.
 *
 * Additive table for the deterministic transfer-intent domain. Distinct from
 * agent_transactions (cash_out/airtime execution) and untouched by
 * Paycrest/ClubKonnect flows. B3 only ever writes status 'pending' and reads
 * or cancels to 'cancelled'; 'approved'/'submitted'/'settled'/'failed' are
 * reserved for future B4/B5 execution wiring.
 *
 * Critical terms (owner, recipient, chain, asset, amount, expiry) are bound
 * by terms_fingerprint. Version/address snapshots pin saved-recipient state
 * at preparation time; B4 must re-check freshness before any execution.
 */
export const walletTransferIntents = pgTable(
  "wallet_transfer_intents",
  {
    id: text("id").primaryKey(),
    ownerAddress: text("owner_address").notNull(),
    recipientSource: text("recipient_source").notNull(),
    savedRecipientId: text("saved_recipient_id"),
    savedRecipientVersion: integer("saved_recipient_version"),
    recipientAddress: text("recipient_address").notNull(),
    recipientLabel: text("recipient_label").notNull(),
    chainId: integer("chain_id").notNull(),
    environment: text("environment").notNull(),
    assetSymbol: text("asset_symbol").notNull(),
    tokenAddress: text("token_address"),
    assetDecimals: integer("asset_decimals").notNull(),
    amountDisplay: text("amount_display").notNull(),
    amountBaseUnits: text("amount_base_units").notNull(),
    status: text("status").notNull().default("pending"),
    approvalVersion: integer("approval_version").notNull().default(1),
    termsFingerprint: text("terms_fingerprint").notNull(),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("wti_owner_idx").on(table.ownerAddress),
    index("wti_owner_status_idx").on(table.ownerAddress, table.status),
    uniqueIndex("wti_owner_idem_idx")
      .on(table.ownerAddress, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ],
);

export type WalletTransferIntent = typeof walletTransferIntents.$inferSelect;
export type NewWalletTransferIntent = typeof walletTransferIntents.$inferInsert;

/**
 * B5 — Durable transfer submission ledger.
 *
 * One row per wallet_transfer intent at most (unique intent_id): an intent can
 * never acquire competing submissions. One transaction hash can never be
 * claimed for unrelated intents (partial unique tx_hash). Status authority:
 * the INTENT row carries user intent (pending/cancelled) while THIS row
 * carries chain fact (submitted/confirmed/failed/unknown). Cancellation of
 * an intent never deletes or rewrites its submission row — a later on-chain
 * confirmation must still be recorded and reported truthfully.
 *
 * A browser-supplied tx hash is a candidate proof only; `confirmed` requires
 * deterministic on-chain verification (see lib/transfers/verify.ts).
 * No private keys or wallet secrets are stored here — ever.
 */
export const transferSubmissions = pgTable(
  "transfer_submissions",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id").notNull(),
    ownerAddress: text("owner_address").notNull(),
    chainId: integer("chain_id").notNull(),
    environment: text("environment").notNull(),
    contractAddress: text("contract_address").notNull(),
    termsFingerprint: text("terms_fingerprint").notNull(),
    tokenAddress: text("token_address"),
    recipientAddress: text("recipient_address").notNull(),
    amountBaseUnits: text("amount_base_units").notNull(),
    txHash: text("tx_hash"),
    status: text("status").notNull().default("submitted"),
    receiptStatus: text("receipt_status"),
    blockNumber: bigint("block_number", { mode: "number" }),
    blockHash: text("block_hash"),
    confirmations: integer("confirmations"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("tsub_intent_idx").on(table.intentId),
    uniqueIndex("tsub_tx_idx")
      .on(table.txHash)
      .where(sql`${table.txHash} IS NOT NULL`),
    index("tsub_owner_idx").on(table.ownerAddress),
    index("tsub_status_idx").on(table.status),
    index("tsub_intent_owner_idx").on(table.intentId, table.ownerAddress),
  ],
);

export type TransferSubmission = typeof transferSubmissions.$inferSelect;
export type NewTransferSubmission = typeof transferSubmissions.$inferInsert;
