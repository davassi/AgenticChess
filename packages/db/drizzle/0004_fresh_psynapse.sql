CREATE TYPE "public"."view_surface" AS ENUM('app', 'site');--> statement-breakpoint
CREATE TABLE "page_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"surface" "view_surface" NOT NULL,
	"referrer_host" text,
	"visitor_id" text NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "page_views_occurred_idx" ON "page_views" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "page_views_path_idx" ON "page_views" USING btree ("path","occurred_at");--> statement-breakpoint
CREATE INDEX "page_views_visitor_idx" ON "page_views" USING btree ("visitor_id","occurred_at");