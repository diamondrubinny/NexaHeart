CREATE TABLE "group_crushes" (
	"user_id" text NOT NULL,
	"target_id" text NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_crushes_user_id_target_id_pk" PRIMARY KEY("user_id","target_id")
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "member_groups" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "interest_groups" ADD COLUMN "status" varchar(8) DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "interest_groups" ADD COLUMN "host_id" text;--> statement-breakpoint
ALTER TABLE "group_crushes" ADD CONSTRAINT "group_crushes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_crushes" ADD CONSTRAINT "group_crushes_target_id_user_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_crushes" ADD CONSTRAINT "group_crushes_group_id_interest_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."interest_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_crushes_target_idx" ON "group_crushes" USING btree ("target_id");--> statement-breakpoint
ALTER TABLE "interest_groups" ADD CONSTRAINT "interest_groups_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;