ALTER TABLE "sessions" ADD COLUMN "last_extraction_at" bigint;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "extraction_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "extraction_retry_at" bigint;
