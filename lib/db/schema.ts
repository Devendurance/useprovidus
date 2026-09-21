import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
