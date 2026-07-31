CREATE TABLE "pr_issue_links" (
	"pr_id" text NOT NULL,
	"issue_id" text NOT NULL,
	CONSTRAINT "pr_issue_links_pr_id_issue_id_pk" PRIMARY KEY("pr_id","issue_id")
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"state" text DEFAULT 'open' NOT NULL,
	"head_branch" text NOT NULL,
	"base_branch" text NOT NULL,
	"labels" jsonb,
	"html_url" text,
	"author_login" text,
	"author_avatar" text,
	"assignees" jsonb,
	"mergeable" text,
	"draft" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"merged_at" bigint
);
--> statement-breakpoint
CREATE TABLE "session_links" (
	"session_id" text NOT NULL,
	"type" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "session_links_session_id_type_target_id_pk" PRIMARY KEY("session_id","type","target_id")
);
--> statement-breakpoint
ALTER TABLE "custom_agents" ADD COLUMN "is_system" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "author_login" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "author_avatar" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "assignees" jsonb;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "comment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_issue_links" ADD CONSTRAINT "pr_issue_links_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_issue_links" ADD CONSTRAINT "pr_issue_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_links" ADD CONSTRAINT "session_links_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pr_issue_links_issue_idx" ON "pr_issue_links" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_repo_number_idx" ON "pull_requests" USING btree ("repo_id","number");--> statement-breakpoint
CREATE INDEX "pull_requests_repo_state_idx" ON "pull_requests" USING btree ("repo_id","state");--> statement-breakpoint
CREATE INDEX "session_links_session_idx" ON "session_links" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_links_target_idx" ON "session_links" USING btree ("type","target_id");