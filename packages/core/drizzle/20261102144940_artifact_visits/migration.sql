CREATE TABLE "artifact_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"file_id" text,
	"album_id" text,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_visits_one_artifact" CHECK (num_nonnulls("file_id", "album_id") = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_visits_user_file_idx" ON "artifact_visits" ("user_id","file_id") WHERE "file_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_visits_user_album_idx" ON "artifact_visits" ("user_id","album_id") WHERE "album_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "artifact_visits_user_visited_idx" ON "artifact_visits" ("user_id","visited_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "artifact_visits" ADD CONSTRAINT "artifact_visits_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_visits" ADD CONSTRAINT "artifact_visits_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_visits" ADD CONSTRAINT "artifact_visits_album_id_albums_id_fkey" FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE CASCADE;