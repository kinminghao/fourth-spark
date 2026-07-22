CREATE TABLE "repos" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"git_url" text NOT NULL,
	"local_path" text NOT NULL,
	"port" integer,
	"status" text DEFAULT 'inactive' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "repos_local_path_idx" ON "repos" USING btree ("local_path");