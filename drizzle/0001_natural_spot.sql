CREATE TABLE "executive_research_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"reported_by_api_key_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mcp_api_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mcp_api_key_prefix_unique" UNIQUE("prefix"),
	CONSTRAINT "mcp_api_key_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "research_snapshot" ADD COLUMN "payload_hash" text;--> statement-breakpoint
ALTER TABLE "research_snapshot" ADD COLUMN "submitted_by_api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "executive_research_issue" ADD CONSTRAINT "executive_research_issue_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_research_issue" ADD CONSTRAINT "exec_research_issue_api_key_fk" FOREIGN KEY ("reported_by_api_key_id") REFERENCES "public"."mcp_api_key"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "executive_research_issue_one_open_idx" ON "executive_research_issue" USING btree ("company_id") WHERE "executive_research_issue"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "executive_research_issue_company_idx" ON "executive_research_issue" USING btree ("company_id","resolved_at");--> statement-breakpoint
CREATE INDEX "mcp_api_key_created_at_idx" ON "mcp_api_key" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mcp_api_key_active_idx" ON "mcp_api_key" USING btree ("revoked_at") WHERE "mcp_api_key"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "research_snapshot" ADD CONSTRAINT "research_snapshot_api_key_fk" FOREIGN KEY ("submitted_by_api_key_id") REFERENCES "public"."mcp_api_key"("id") ON DELETE restrict ON UPDATE no action;