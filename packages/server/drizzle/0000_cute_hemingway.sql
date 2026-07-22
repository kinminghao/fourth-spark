CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"agent" text,
	"model" text,
	"provider" text,
	"variant" text,
	"cost" real,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"session_id" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"title" text DEFAULT '' NOT NULL,
	"agent" text,
	"model" jsonb,
	"directory" text,
	"cost" real DEFAULT 0 NOT NULL,
	"tokens_input" bigint DEFAULT 0 NOT NULL,
	"tokens_output" bigint DEFAULT 0 NOT NULL,
	"tokens_reasoning" bigint DEFAULT 0 NOT NULL,
	"tokens_cache_read" bigint DEFAULT 0 NOT NULL,
	"tokens_cache_write" bigint DEFAULT 0 NOT NULL,
	"user_id" text,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"session_id" text NOT NULL,
	"position" integer NOT NULL,
	"content" text NOT NULL,
	"status" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL,
	CONSTRAINT "todos_session_id_position_pk" PRIMARY KEY("session_id","position")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_session_idx" ON "messages" USING btree ("session_id","time_created");--> statement-breakpoint
CREATE INDEX "parts_message_idx" ON "parts" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "parts_session_idx" ON "parts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_time_created_idx" ON "sessions" USING btree ("time_created");