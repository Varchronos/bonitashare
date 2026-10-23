CREATE TABLE "file_deletions" (
	"file_id" text PRIMARY KEY,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "file_deletions_purge_after_idx" ON "file_deletions" ("purge_after");--> statement-breakpoint
ALTER TABLE "file_deletions" ADD CONSTRAINT "file_deletions_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE;