ALTER TABLE "agents" ADD COLUMN "is_house" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "rated" boolean DEFAULT true NOT NULL;