CREATE TABLE "executive_research_claim" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"claimed_by_api_key_id" uuid,
	"claimed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "executive_research_claim_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "executive_research_claim_valid_expiry" CHECK ("executive_research_claim"."expires_at" > "executive_research_claim"."claimed_at")
);
--> statement-breakpoint
ALTER TABLE "executive_research_claim" ADD CONSTRAINT "executive_research_claim_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_research_claim" ADD CONSTRAINT "executive_research_claim_claimed_by_api_key_id_mcp_api_key_id_fk" FOREIGN KEY ("claimed_by_api_key_id") REFERENCES "public"."mcp_api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "executive_research_claim_expires_at_idx" ON "executive_research_claim" USING btree ("expires_at");