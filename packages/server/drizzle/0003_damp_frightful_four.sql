CREATE TABLE "device_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"platform" text DEFAULT 'ios' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_tags" (
	"issue_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "issue_tags_issue_id_tag_id_pk" PRIMARY KEY("issue_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"state" text DEFAULT 'open' NOT NULL,
	"due_on" bigint,
	"open_issues" integer DEFAULT 0 NOT NULL,
	"closed_issues" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '6b7280' NOT NULL,
	"description" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_agents" ADD COLUMN "system_prompt_position" integer DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "milestone_id" text;--> statement-breakpoint
ALTER TABLE "issue_tags" ADD CONSTRAINT "issue_tags_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tags" ADD CONSTRAINT "issue_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_token_idx" ON "device_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "issue_tags_tag_idx" ON "issue_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "milestones_repo_number_idx" ON "milestones" USING btree ("repo_id","number");--> statement-breakpoint
CREATE INDEX "milestones_repo_idx" ON "milestones" USING btree ("repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_repo_name_idx" ON "tags" USING btree ("repo_id","name");--> statement-breakpoint
CREATE INDEX "tags_repo_idx" ON "tags" USING btree ("repo_id");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issues_milestone_idx" ON "issues" USING btree ("milestone_id");