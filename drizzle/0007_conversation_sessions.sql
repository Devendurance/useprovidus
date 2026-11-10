CREATE TABLE "conversation_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"owner_address" text NOT NULL,
	"message_sequence" bigint NOT NULL,
	"turn_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"turn_status" text,
	"attempt_id" text,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_message_role_check" CHECK (role IN ('user', 'assistant')),
	CONSTRAINT "conversation_message_turn_state_check" CHECK (((role = 'user' AND turn_status IS NOT NULL AND turn_status IN ('pending', 'complete', 'failed', 'superseded') AND attempt_count >= 1 AND ((turn_status = 'pending' AND attempt_id IS NOT NULL AND lease_expires_at IS NOT NULL AND failure_code IS NULL) OR (turn_status <> 'pending' AND attempt_id IS NULL AND lease_expires_at IS NULL))) OR (role = 'assistant' AND turn_status IS NULL AND attempt_id IS NULL AND lease_expires_at IS NULL AND attempt_count IS NULL AND failure_code IS NULL))),
	CONSTRAINT "conversation_message_sequence_check" CHECK (message_sequence >= 1),
	CONSTRAINT "conversation_message_content_length_check" CHECK (char_length(trim(content)) BETWEEN 1 AND 2000),
	CONSTRAINT "conversation_message_failure_code_check" CHECK (failure_code IS NULL OR failure_code IN ('assistant_unavailable', 'invalid_output', 'rate_limited'))
);
--> statement-breakpoint
CREATE TABLE "conversation_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"create_request_id" text NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"title_source" text DEFAULT 'automatic' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone,
	"next_sequence" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "conversation_session_id_owner_unique" UNIQUE("id","owner_address"),
	CONSTRAINT "conversation_session_title_source_check" CHECK (title_source IN ('automatic', 'manual')),
	CONSTRAINT "conversation_session_title_length_check" CHECK (char_length(trim(title)) BETWEEN 1 AND 80),
	CONSTRAINT "conversation_session_next_sequence_check" CHECK (next_sequence >= 1)
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_message_session_owner_fk" FOREIGN KEY ("session_id","owner_address") REFERENCES "public"."conversation_sessions"("id","owner_address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_session_sequence_idx" ON "conversation_messages" USING btree ("session_id","owner_address","message_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_turn_role_idx" ON "conversation_messages" USING btree ("session_id","owner_address","turn_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_pending_turn_idx" ON "conversation_messages" USING btree ("session_id") WHERE role = 'user' AND turn_status = 'pending';--> statement-breakpoint
CREATE INDEX "conversation_message_owner_history_idx" ON "conversation_messages" USING btree ("owner_address","session_id","message_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_session_owner_create_idx" ON "conversation_sessions" USING btree ("owner_address","create_request_id");--> statement-breakpoint
CREATE INDEX "conversation_session_owner_recent_idx" ON "conversation_sessions" USING btree ("owner_address","updated_at","id");