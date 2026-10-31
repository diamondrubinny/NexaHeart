CREATE TABLE "profile_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"prompt_key" varchar(40) NOT NULL,
	"status" varchar(12) DEFAULT 'quarantine' NOT NULL,
	"quarantine_key" text,
	"media_key" text,
	"poster_key" text,
	"duration_ms" integer,
	"reject_reason" varchar(32),
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_videos_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "profile_videos" ADD CONSTRAINT "profile_videos_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_videos" ADD CONSTRAINT "profile_videos_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;