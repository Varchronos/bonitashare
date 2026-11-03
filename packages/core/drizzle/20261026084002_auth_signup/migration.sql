CREATE TABLE "email_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"password_hash" text,
	"display_name" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "email_otps_signup_has_password" CHECK ("purpose" <> 'signup' OR "password_hash" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_email_key";--> statement-breakpoint
DROP INDEX "users_with_email_idx";--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "device_type" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name" varchar(50);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "email_otps_email_purpose_idx" ON "email_otps" ("email","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" (lower("email")) WHERE "email" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "email_otps" ADD CONSTRAINT "email_otps_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_requires_password_hash" CHECK ("email" IS NULL OR "password_hash" IS NOT NULL);