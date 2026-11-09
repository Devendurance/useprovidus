CREATE TABLE "transfer_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"intent_id" text NOT NULL,
	"owner_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"environment" text NOT NULL,
	"contract_address" text NOT NULL,
	"terms_fingerprint" text NOT NULL,
	"token_address" text,
	"recipient_address" text NOT NULL,
	"amount_base_units" text NOT NULL,
	"tx_hash" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"receipt_status" text,
	"block_number" bigint,
	"block_hash" text,
	"confirmations" integer,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tsub_intent_idx" ON "transfer_submissions" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tsub_tx_idx" ON "transfer_submissions" USING btree ("tx_hash") WHERE "transfer_submissions"."tx_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tsub_owner_idx" ON "transfer_submissions" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "tsub_status_idx" ON "transfer_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tsub_intent_owner_idx" ON "transfer_submissions" USING btree ("intent_id","owner_address");