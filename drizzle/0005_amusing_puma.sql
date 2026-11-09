CREATE TABLE "wallet_transfer_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"recipient_source" text NOT NULL,
	"saved_recipient_id" text,
	"saved_recipient_version" integer,
	"recipient_address" text NOT NULL,
	"recipient_label" text NOT NULL,
	"chain_id" integer NOT NULL,
	"environment" text NOT NULL,
	"asset_symbol" text NOT NULL,
	"token_address" text,
	"asset_decimals" integer NOT NULL,
	"amount_display" text NOT NULL,
	"amount_base_units" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approval_version" integer DEFAULT 1 NOT NULL,
	"terms_fingerprint" text NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "wti_owner_idx" ON "wallet_transfer_intents" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "wti_owner_status_idx" ON "wallet_transfer_intents" USING btree ("owner_address","status");--> statement-breakpoint
CREATE UNIQUE INDEX "wti_owner_idem_idx" ON "wallet_transfer_intents" USING btree ("owner_address","idempotency_key") WHERE "wallet_transfer_intents"."idempotency_key" IS NOT NULL;