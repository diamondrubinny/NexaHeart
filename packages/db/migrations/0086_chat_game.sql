ALTER TYPE "public"."message_kind" ADD VALUE 'game';--> statement-breakpoint
CREATE TABLE "chat_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"question" varchar(40) NOT NULL,
	"started_by" text NOT NULL,
	"answer_a" varchar(280),
	"answer_b" varchar(280),
	"revealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "chat_game" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "game_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_games" ADD CONSTRAINT "chat_games_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_games" ADD CONSTRAINT "chat_games_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_games_open_uq" ON "chat_games" USING btree ("match_id") WHERE revealed_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_games_question_uq" ON "chat_games" USING btree ("match_id","question");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_game_id_chat_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."chat_games"("id") ON DELETE cascade ON UPDATE no action;