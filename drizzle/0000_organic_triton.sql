CREATE TABLE "agent_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"type" text DEFAULT 'cash_out' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"wallet_address" text NOT NULL,
	"amount_usdc" text NOT NULL,
	"amount_ngn" text,
	"celo_tx_hash" text,
	"paycrest_order_id" text,
	"paycrest_reference" text NOT NULL,
	"paycrest_status" text,
	"receive_address" text,
	"valid_until" timestamp with time zone,
	"failure_code" text,
	"failure_reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tx_idempotency_idx" ON "agent_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tx_paycrest_ref_idx" ON "agent_transactions" USING btree ("paycrest_reference");--> statement-breakpoint
CREATE INDEX "agent_tx_wallet_idx" ON "agent_transactions" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "agent_tx_order_id_idx" ON "agent_transactions" USING btree ("paycrest_order_id");--> statement-breakpoint
CREATE INDEX "agent_tx_status_idx" ON "agent_transactions" USING btree ("status");