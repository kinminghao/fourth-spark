CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"branch" text NOT NULL,
	"local_path" text NOT NULL,
	"base_branch" text DEFAULT 'main' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"port" integer,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "runtime_type" text DEFAULT 'opencode';--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "worktree_enabled" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "completed_at" bigint;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspaces_repo_idx" ON "workspaces" USING btree ("repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_local_path_idx" ON "workspaces" USING btree ("local_path");--> statement-breakpoint
CREATE INDEX "workspaces_status_idx" ON "workspaces" USING btree ("repo_id","status");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_workspace_idx" ON "sessions" USING btree ("workspace_id");