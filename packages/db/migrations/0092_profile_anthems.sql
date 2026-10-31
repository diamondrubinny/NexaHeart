ALTER TYPE "public"."interaction_item_type" ADD VALUE 'anthem';--> statement-breakpoint
CREATE TABLE "profile_anthems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" varchar(80) NOT NULL,
	"artist" varchar(80) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_anthems_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "profile_anthems" ADD CONSTRAINT "profile_anthems_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;