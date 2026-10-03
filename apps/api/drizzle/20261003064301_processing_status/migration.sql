ALTER TABLE "files" ADD COLUMN "uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "processing_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "processing_error" text;--> statement-breakpoint
CREATE INDEX "files_unprocessed_idx" ON "files" ("uploaded_at") WHERE "file_status" = 'uploaded' AND "processing_status" = 'pending';--> statement-breakpoint
-- Files uploaded before processing was tracked: the old worker already handled them.
UPDATE "files" SET "processing_status" = 'done', "uploaded_at" = "created_at" WHERE "file_status" = 'uploaded';
