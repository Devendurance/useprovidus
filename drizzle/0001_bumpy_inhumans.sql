CREATE TABLE "airtime_previews" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"intent_fingerprint" text NOT NULL,
	"amount_ngn" text NOT NULL,
	"phone" text NOT NULL,
	"network" text NOT NULL,
	"rate" text NOT NULL,
	"amount_usdc" text NOT NULL,
	"fee_usdc" text DEFAULT '0' NOT NULL,
	"total_usdc" text NOT NULL,
	"quoted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"transaction_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "preview_wallet_idx" ON "airtime_previews" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "preview_fingerprint_idx" ON "airtime_previews" USING btree ("intent_fingerprint");--> statement-breakpoint
CREATE INDEX "preview_tx_idx" ON "airtime_previews" USING btree ("transaction_id");