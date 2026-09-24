ALTER TABLE "files" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "files_expires_at_idx" ON "files" ("expires_at") WHERE "expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_with_email_idx" ON "users" ("email") WHERE "email" IS NOT NULL;