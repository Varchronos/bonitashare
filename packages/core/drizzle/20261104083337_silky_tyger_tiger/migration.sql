CREATE TABLE "file_takedowns" (
	"file_id" text PRIMARY KEY,
	"state" text NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"sha256" text,
	"owner_id_snapshot" uuid,
	"owner_email_snapshot" text,
	"purge_content_after" timestamp with time zone,
	"content_purged_at" timestamp with time zone,
	"appeal_text" text,
	"appealed_at" timestamp with time zone,
	"appeal_resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"file_id" text,
	"album_id" text,
	"reporter_id" uuid,
	"reporter_ip" text,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	CONSTRAINT "reports_one_artifact" CHECK (num_nonnulls("file_id", "album_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "takedown_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"file_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "file_takedowns_owner_snapshot_idx" ON "file_takedowns" ("owner_id_snapshot") WHERE "owner_id_snapshot" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "file_takedowns_purge_content_idx" ON "file_takedowns" ("purge_content_after") WHERE "content_purged_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_reporter_file_idx" ON "reports" ("reporter_id","file_id") WHERE "file_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_reporter_album_idx" ON "reports" ("reporter_id","album_id") WHERE "album_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reports_status_created_idx" ON "reports" ("status","created_at");--> statement-breakpoint
CREATE INDEX "takedown_events_file_idx" ON "takedown_events" ("file_id","at");--> statement-breakpoint
ALTER TABLE "file_takedowns" ADD CONSTRAINT "file_takedowns_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL;