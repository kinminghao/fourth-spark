ALTER TABLE "device_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "device_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD COLUMN "history" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "custom_agents" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_agents" ADD COLUMN "variant" text;--> statement-breakpoint
ALTER TABLE "custom_agents" ADD COLUMN "memory_enabled" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_agents" ADD COLUMN "memory_model" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "additions" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "deletions" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "changed_files_count" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "commit_count" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "diff_stats" jsonb;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "repo_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_repo_idx" ON "sessions" USING btree ("repo_id");