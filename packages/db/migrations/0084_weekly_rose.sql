ALTER TABLE "instance_settings" ADD COLUMN "weekly_rose" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "rose" boolean DEFAULT false NOT NULL;