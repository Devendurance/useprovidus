CREATE TABLE "recipient_address_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_id" text NOT NULL,
	"owner_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"old_address" text,
	"new_address" text,
	"old_version" integer NOT NULL,
	"new_version" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"label" text NOT NULL,
	"normalized_label" text NOT NULL,
	"recipient_type" text DEFAULT 'wallet' NOT NULL,
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "rcp_audit_recipient_idx" ON "recipient_address_audits" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "rcp_audit_owner_idx" ON "recipient_address_audits" USING btree ("owner_address");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_rcp_owner_label_chain_idx" ON "saved_recipients" USING btree ("owner_address","normalized_label","chain_id") WHERE "saved_recipients"."is_active" = true;--> statement-breakpoint
CREATE INDEX "saved_rcp_owner_idx" ON "saved_recipients" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "saved_rcp_owner_chain_idx" ON "saved_recipients" USING btree ("owner_address","chain_id");