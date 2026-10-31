CREATE TABLE "group_departures" (
	"group_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"left_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_departures_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "group_departures" ADD CONSTRAINT "group_departures_group_id_interest_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."interest_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_departures" ADD CONSTRAINT "group_departures_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;