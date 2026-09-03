CREATE TYPE "public"."agent_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."color" AS ENUM('white', 'black');--> statement-breakpoint
CREATE TYPE "public"."game_result" AS ENUM('1-0', '0-1', '1/2-1/2', '*');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('created', 'active', 'finished', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."illegal_reason" AS ENUM('unparseable', 'not_legal');--> statement-breakpoint
CREATE TYPE "public"."termination" AS ENUM('checkmate', 'stalemate', 'threefold_repetition', 'fifty_move_rule', 'insufficient_material', 'move_limit', 'timeout', 'illegal_moves', 'resignation', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"model_provider" text NOT NULL,
	"model_name" text NOT NULL,
	"api_key_prefix" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"suspended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"white_agent_id" uuid NOT NULL,
	"black_agent_id" uuid NOT NULL,
	"status" "game_status" DEFAULT 'created' NOT NULL,
	"result" "game_result",
	"termination" "termination",
	"time_per_move_ms" integer NOT NULL,
	"move_limit_plies" integer NOT NULL,
	"illegal_attempts_per_turn" integer NOT NULL,
	"current_fen" text NOT NULL,
	"ply" integer DEFAULT 0 NOT NULL,
	"turn_started_at" timestamp with time zone,
	"move_deadline_at" timestamp with time zone,
	"illegal_attempts_this_turn" integer DEFAULT 0 NOT NULL,
	"pgn" text,
	"white_rating_before" double precision,
	"white_rating_after" double precision,
	"black_rating_before" double precision,
	"black_rating_after" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "move_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"ply" integer NOT NULL,
	"submitted" text NOT NULL,
	"reason" "illegal_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"ply" integer NOT NULL,
	"color" "color" NOT NULL,
	"san" text NOT NULL,
	"uci" text NOT NULL,
	"fen_after" text NOT NULL,
	"comment" text,
	"think_time_ms" integer NOT NULL,
	"illegal_attempts_before" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_white_agent_id_agents_id_fk" FOREIGN KEY ("white_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_black_agent_id_agents_id_fk" FOREIGN KEY ("black_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move_attempts" ADD CONSTRAINT "move_attempts_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move_attempts" ADD CONSTRAINT "move_attempts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moves" ADD CONSTRAINT "moves_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_api_key_prefix_idx" ON "agents" USING btree ("api_key_prefix");--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "games_status_idx" ON "games" USING btree ("status");--> statement-breakpoint
CREATE INDEX "games_white_idx" ON "games" USING btree ("white_agent_id","finished_at");--> statement-breakpoint
CREATE INDEX "games_black_idx" ON "games" USING btree ("black_agent_id","finished_at");--> statement-breakpoint
CREATE INDEX "move_attempts_game_idx" ON "move_attempts" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "move_attempts_agent_idx" ON "move_attempts" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "moves_game_ply_idx" ON "moves" USING btree ("game_id","ply");