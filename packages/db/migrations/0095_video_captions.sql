ALTER TABLE "profile_videos" ADD COLUMN "lang" varchar(5);--> statement-breakpoint
ALTER TABLE "profile_videos" ADD COLUMN "captions" jsonb;--> statement-breakpoint
ALTER TABLE "profile_videos" ADD COLUMN "captions_status" varchar(8);--> statement-breakpoint
ALTER TABLE "profile_videos" ADD COLUMN "caption_flags" text[] DEFAULT '{}'::text[] NOT NULL;