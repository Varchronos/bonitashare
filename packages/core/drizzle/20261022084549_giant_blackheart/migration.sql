CREATE TABLE "upload_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"file_id" text,
	"bytes_consumed" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "files_owner_id_idx" ON "files" ("owner_id") WHERE "owner_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "upload_usage_user_created_idx" ON "upload_usage" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "upload_usage_created_idx" ON "upload_usage" ("created_at");--> statement-breakpoint
ALTER TABLE "upload_usage" ADD CONSTRAINT "upload_usage_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "upload_usage" ADD CONSTRAINT "upload_usage_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL;