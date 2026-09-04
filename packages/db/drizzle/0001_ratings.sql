CREATE TABLE "rating_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"rating_before" double precision NOT NULL,
	"rating_after" double precision NOT NULL,
	"rd_after" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"rating" double precision NOT NULL,
	"rd" double precision NOT NULL,
	"volatility" double precision NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"last_game_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rating_history_agent_game_idx" ON "rating_history" USING btree ("agent_id","game_id");--> statement-breakpoint
CREATE INDEX "rating_history_agent_idx" ON "rating_history" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "ratings_leaderboard_idx" ON "ratings" USING btree ("rating" DESC NULLS LAST,"rd","agent_id");