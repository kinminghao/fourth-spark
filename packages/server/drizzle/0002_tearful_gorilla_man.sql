CREATE TABLE "custom_agent_fragments" (
	"custom_agent_id" text NOT NULL,
	"fragment_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "custom_agent_fragments_custom_agent_id_fragment_id_pk" PRIMARY KEY("custom_agent_id","fragment_id")
);
--> statement-breakpoint
CREATE TABLE "custom_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_agent" text NOT NULL,
	"model" text,
	"system_prompt" text DEFAULT '' NOT NULL,
	"repo_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"platform" text DEFAULT 'gitea' NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"author_login" text NOT NULL,
	"author_avatar" text,
	"body" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"parent_id" text,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"state" text DEFAULT 'open' NOT NULL,
	"labels" jsonb,
	"html_url" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_fragments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"repo_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "issue_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "custom_agent_id" text;--> statement-breakpoint
ALTER TABLE "custom_agent_fragments" ADD CONSTRAINT "custom_agent_fragments_custom_agent_id_custom_agents_id_fk" FOREIGN KEY ("custom_agent_id") REFERENCES "public"."custom_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_agent_fragments" ADD CONSTRAINT "custom_agent_fragments_fragment_id_prompt_fragments_id_fk" FOREIGN KEY ("fragment_id") REFERENCES "public"."prompt_fragments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_agents" ADD CONSTRAINT "custom_agents_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_fragments" ADD CONSTRAINT "prompt_fragments_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_agents_repo_idx" ON "custom_agents" USING btree ("repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_hosts_host_idx" ON "git_hosts" USING btree ("host");--> statement-breakpoint
CREATE INDEX "issue_comments_issue_idx" ON "issue_comments" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issue_comments_repo_idx" ON "issue_comments" USING btree ("repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_repo_number_idx" ON "issues" USING btree ("repo_id","number");--> statement-breakpoint
CREATE INDEX "issues_repo_state_idx" ON "issues" USING btree ("repo_id","state");--> statement-breakpoint
CREATE INDEX "issues_parent_idx" ON "issues" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "prompt_fragments_repo_idx" ON "prompt_fragments" USING btree ("repo_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_custom_agent_id_custom_agents_id_fk" FOREIGN KEY ("custom_agent_id") REFERENCES "public"."custom_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_issue_idx" ON "sessions" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "sessions_custom_agent_idx" ON "sessions" USING btree ("custom_agent_id");