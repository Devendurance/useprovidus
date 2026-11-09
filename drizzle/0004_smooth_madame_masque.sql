CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_counters" (
	"key" text NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_revoked_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_nonce_exp_idx" ON "auth_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_key_window_idx" ON "auth_rate_counters" USING btree ("key","window_start");--> statement-breakpoint
CREATE INDEX "auth_rate_key_idx" ON "auth_rate_counters" USING btree ("key");--> statement-breakpoint
CREATE INDEX "auth_revoked_exp_idx" ON "auth_revoked_sessions" USING btree ("expires_at");