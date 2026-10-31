CREATE TABLE "profile_polls" (
	"user_id" text PRIMARY KEY NOT NULL,
	"question" varchar(120) NOT NULL,
	"answers" text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "poll_answer" varchar(40);--> statement-breakpoint
ALTER TABLE "profile_polls" ADD CONSTRAINT "profile_polls_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;