CREATE TABLE "massive_ticker_checkpoint" (
	"sync_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"record" jsonb NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "massive_ticker_checkpoint_sync_id_ticker_pk" PRIMARY KEY("sync_id","ticker")
);
--> statement-breakpoint
CREATE TABLE "massive_universe_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"requested_by_api_key_id" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"listing_count" integer DEFAULT 0 NOT NULL,
	"enriched_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reviewed_issuer_alias" (
	"ticker" text PRIMARY KEY NOT NULL,
	"issuer_key" text NOT NULL,
	"reviewed_by_api_key_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "massive_ticker_checkpoint" ADD CONSTRAINT "massive_ticker_checkpoint_sync_id_massive_universe_sync_id_fk" FOREIGN KEY ("sync_id") REFERENCES "public"."massive_universe_sync"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "massive_universe_sync" ADD CONSTRAINT "massive_universe_sync_requested_by_api_key_id_mcp_api_key_id_fk" FOREIGN KEY ("requested_by_api_key_id") REFERENCES "public"."mcp_api_key"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewed_issuer_alias" ADD CONSTRAINT "reviewed_issuer_alias_reviewed_by_api_key_id_mcp_api_key_id_fk" FOREIGN KEY ("reviewed_by_api_key_id") REFERENCES "public"."mcp_api_key"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "massive_ticker_checkpoint_sync_idx" ON "massive_ticker_checkpoint" USING btree ("sync_id");--> statement-breakpoint
CREATE INDEX "massive_universe_sync_as_of_idx" ON "massive_universe_sync" USING btree ("as_of","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "massive_universe_sync_one_running_idx" ON "massive_universe_sync" USING btree ("status") WHERE "massive_universe_sync"."status" = 'running';