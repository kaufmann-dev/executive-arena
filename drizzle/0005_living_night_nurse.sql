ALTER TABLE "executive_research_issue" DROP CONSTRAINT "exec_research_issue_api_key_fk";
--> statement-breakpoint
ALTER TABLE "massive_universe_sync" DROP CONSTRAINT "massive_universe_sync_requested_by_api_key_id_mcp_api_key_id_fk";
--> statement-breakpoint
ALTER TABLE "research_snapshot" DROP CONSTRAINT "research_snapshot_api_key_fk";
--> statement-breakpoint
ALTER TABLE "reviewed_issuer_alias" DROP CONSTRAINT "reviewed_issuer_alias_reviewed_by_api_key_id_mcp_api_key_id_fk";
--> statement-breakpoint
DROP INDEX "mcp_api_key_active_idx";--> statement-breakpoint
ALTER TABLE "massive_universe_sync" ALTER COLUMN "requested_by_api_key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviewed_issuer_alias" ALTER COLUMN "reviewed_by_api_key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "executive_research_issue" ADD CONSTRAINT "exec_research_issue_api_key_fk" FOREIGN KEY ("reported_by_api_key_id") REFERENCES "public"."mcp_api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "massive_universe_sync" ADD CONSTRAINT "massive_universe_sync_requested_by_api_key_id_mcp_api_key_id_fk" FOREIGN KEY ("requested_by_api_key_id") REFERENCES "public"."mcp_api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_snapshot" ADD CONSTRAINT "research_snapshot_api_key_fk" FOREIGN KEY ("submitted_by_api_key_id") REFERENCES "public"."mcp_api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewed_issuer_alias" ADD CONSTRAINT "reviewed_issuer_alias_reviewed_by_api_key_id_mcp_api_key_id_fk" FOREIGN KEY ("reviewed_by_api_key_id") REFERENCES "public"."mcp_api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DELETE FROM "mcp_api_key" WHERE "revoked_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_api_key" DROP COLUMN "revoked_at";
