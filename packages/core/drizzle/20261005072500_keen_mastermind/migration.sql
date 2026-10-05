CREATE TABLE "file_videos" (
	"file_id" text PRIMARY KEY,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"hls_prefix" text NOT NULL,
	"master_key" text,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"has_audio" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "file_videos" ADD CONSTRAINT "file_videos_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE;