CREATE TABLE "agent_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"custom_agent_id" text NOT NULL,
	"session_id" text,
	"merged_from" jsonb,
	"content" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"importance" real DEFAULT 0.5 NOT NULL,
	"superseded_by" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_custom_agent_id_custom_agents_id_fk" FOREIGN KEY ("custom_agent_id") REFERENCES "public"."custom_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_memories_agent_idx" ON "agent_memories" USING btree ("custom_agent_id");--> statement-breakpoint
CREATE INDEX "agent_memories_category_idx" ON "agent_memories" USING btree ("custom_agent_id","category");--> statement-breakpoint
CREATE INDEX "agent_memories_active_idx" ON "agent_memories" USING btree ("custom_agent_id","importance");