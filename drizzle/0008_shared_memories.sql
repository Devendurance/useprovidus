CREATE TABLE "assistant_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"request_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"normalized_label" text NOT NULL,
	"value" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_memory_owner_address_check" CHECK (owner_address ~ '^0x[0-9a-fA-F]{40}$'),
	CONSTRAINT "assistant_memory_kind_check" CHECK (kind IN ('fact', 'preference')),
	CONSTRAINT "assistant_memory_label_length_check" CHECK (char_length(trim(label)) BETWEEN 1 AND 48),
	CONSTRAINT "assistant_memory_normalized_label_length_check" CHECK (char_length(trim(normalized_label)) BETWEEN 1 AND 48),
	CONSTRAINT "assistant_memory_value_length_check" CHECK (char_length(trim(value)) BETWEEN 1 AND 300),
	CONSTRAINT "assistant_memory_request_id_length_check" CHECK (char_length(trim(request_id)) BETWEEN 12 AND 128),
	CONSTRAINT "assistant_memory_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_memory_owner_label_idx" ON "assistant_memories" USING btree ("owner_address","normalized_label");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_memory_owner_request_idx" ON "assistant_memories" USING btree ("owner_address","request_id");--> statement-breakpoint
CREATE INDEX "assistant_memory_owner_updated_idx" ON "assistant_memories" USING btree ("owner_address","updated_at");