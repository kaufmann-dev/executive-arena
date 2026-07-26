CREATE TABLE "app_session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"id_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cohort_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"pairing_seed" text NOT NULL,
	"frozen_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer_key" text NOT NULL,
	"cik" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"homepage_url" text,
	"sic_code" text,
	"sic_description" text,
	"canonical_ticker" text NOT NULL,
	"market_cap" bigint,
	"included" boolean DEFAULT true NOT NULL,
	"readiness_status" text DEFAULT 'pending' NOT NULL,
	"exclusion_reason" text,
	"cohort_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_issuer_key_unique" UNIQUE("issuer_key")
);
--> statement-breakpoint
CREATE TABLE "comparison" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"presentation_id" uuid NOT NULL,
	"cohort_revision" integer NOT NULL,
	"left_slate_id" uuid NOT NULL,
	"right_slate_id" uuid NOT NULL,
	"winner_slate_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comparison_winner_is_presented" CHECK ("comparison"."winner_slate_id" = "comparison"."left_slate_id" or "comparison"."winner_slate_id" = "comparison"."right_slate_id"),
	CONSTRAINT "comparison_distinct_slates" CHECK ("comparison"."left_slate_id" <> "comparison"."right_slate_id")
);
--> statement-breakpoint
CREATE TABLE "leadership_member" (
	"slate_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"title" text NOT NULL,
	"role_kind" text NOT NULL,
	"is_interim" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "leadership_member_slate_id_person_id_pk" PRIMARY KEY("slate_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "leadership_member_source" (
	"slate_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	CONSTRAINT "leadership_member_source_slate_id_person_id_source_id_pk" PRIMARY KEY("slate_id","person_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "leadership_slate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_at" text NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_transaction" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"browser_token_hash" text NOT NULL,
	"nonce" text NOT NULL,
	"code_verifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pair_presentation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_revision" integer NOT NULL,
	"left_slate_id" uuid NOT NULL,
	"right_slate_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pair_presentation_identity_unique" UNIQUE("id","cohort_revision","left_slate_id","right_slate_id"),
	CONSTRAINT "pair_presentation_distinct_slates" CHECK ("pair_presentation"."left_slate_id" <> "pair_presentation"."right_slate_id")
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text NOT NULL,
	"leadership_as_of" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "person_fact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"category" text NOT NULL,
	"value" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_fact_source" (
	"fact_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	CONSTRAINT "person_fact_source_fact_id_source_id_pk" PRIMARY KEY("fact_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "person_source" (
	"person_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"kind" text DEFAULT 'summary' NOT NULL,
	CONSTRAINT "person_source_person_id_source_id_kind_pk" PRIMARY KEY("person_id","source_id","kind")
);
--> statement-breakpoint
CREATE TABLE "portrait" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"image" "bytea" NOT NULL,
	"image_url" text NOT NULL,
	"content_type" text DEFAULT 'image/webp' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_length" integer NOT NULL,
	"sha256" text NOT NULL,
	"alt_text" text NOT NULL,
	"source_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portrait_person_id_unique" UNIQUE("person_id"),
	CONSTRAINT "portrait_width_positive" CHECK ("portrait"."width" > 0),
	CONSTRAINT "portrait_height_positive" CHECK ("portrait"."height" > 0),
	CONSTRAINT "portrait_byte_length_positive" CHECK ("portrait"."byte_length" > 0)
);
--> statement-breakpoint
CREATE TABLE "ranking_entry" (
	"run_id" uuid NOT NULL,
	"slate_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"strength" double precision NOT NULL,
	"score" double precision NOT NULL,
	"wins" integer NOT NULL,
	"losses" integer NOT NULL,
	"comparison_count" integer NOT NULL,
	CONSTRAINT "ranking_entry_run_id_slate_id_pk" PRIMARY KEY("run_id","slate_id")
);
--> statement-breakpoint
CREATE TABLE "ranking_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_revision" integer NOT NULL,
	"comparison_cutoff" bigint DEFAULT 0 NOT NULL,
	"active_count" integer NOT NULL,
	"iterations" integer NOT NULL,
	"converged" boolean NOT NULL,
	"max_delta" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_listing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"primary_exchange" text,
	"type" text NOT NULL,
	"active" boolean NOT NULL,
	"composite_figi" text,
	"share_class_figi" text,
	"market_cap" bigint,
	"is_canonical" boolean DEFAULT false NOT NULL,
	"last_updated_at" timestamp with time zone,
	CONSTRAINT "security_listing_ticker_unique" UNIQUE("ticker")
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"publisher" text NOT NULL,
	"kind" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "comparison" ADD CONSTRAINT "comparison_winner_slate_id_leadership_slate_id_fk" FOREIGN KEY ("winner_slate_id") REFERENCES "public"."leadership_slate"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison" ADD CONSTRAINT "comparison_presentation_identity_fk" FOREIGN KEY ("presentation_id","cohort_revision","left_slate_id","right_slate_id") REFERENCES "public"."pair_presentation"("id","cohort_revision","left_slate_id","right_slate_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_member" ADD CONSTRAINT "leadership_member_slate_id_leadership_slate_id_fk" FOREIGN KEY ("slate_id") REFERENCES "public"."leadership_slate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_member" ADD CONSTRAINT "leadership_member_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_member_source" ADD CONSTRAINT "leadership_member_source_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_member_source" ADD CONSTRAINT "leadership_member_source_member_fk" FOREIGN KEY ("slate_id","person_id") REFERENCES "public"."leadership_member"("slate_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_slate" ADD CONSTRAINT "leadership_slate_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_presentation" ADD CONSTRAINT "pair_presentation_left_slate_id_leadership_slate_id_fk" FOREIGN KEY ("left_slate_id") REFERENCES "public"."leadership_slate"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_presentation" ADD CONSTRAINT "pair_presentation_right_slate_id_leadership_slate_id_fk" FOREIGN KEY ("right_slate_id") REFERENCES "public"."leadership_slate"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_fact" ADD CONSTRAINT "person_fact_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_fact_source" ADD CONSTRAINT "person_fact_source_fact_id_person_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."person_fact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_fact_source" ADD CONSTRAINT "person_fact_source_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_source" ADD CONSTRAINT "person_source_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_source" ADD CONSTRAINT "person_source_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portrait" ADD CONSTRAINT "portrait_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portrait" ADD CONSTRAINT "portrait_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_entry" ADD CONSTRAINT "ranking_entry_run_id_ranking_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ranking_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_entry" ADD CONSTRAINT "ranking_entry_slate_id_leadership_slate_id_fk" FOREIGN KEY ("slate_id") REFERENCES "public"."leadership_slate"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_listing" ADD CONSTRAINT "security_listing_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_session_expires_at_idx" ON "app_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "company_included_readiness_idx" ON "company" USING btree ("included","readiness_status");--> statement-breakpoint
CREATE INDEX "company_name_idx" ON "company" USING btree ("name");--> statement-breakpoint
CREATE INDEX "company_ticker_idx" ON "company" USING btree ("canonical_ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "company_cik_unique_idx" ON "company" USING btree ("cik") WHERE "company"."cik" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "comparison_presentation_idx" ON "comparison" USING btree ("presentation_id");--> statement-breakpoint
CREATE INDEX "comparison_left_idx" ON "comparison" USING btree ("left_slate_id");--> statement-breakpoint
CREATE INDEX "comparison_right_idx" ON "comparison" USING btree ("right_slate_id");--> statement-breakpoint
CREATE INDEX "comparison_created_idx" ON "comparison" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "leadership_member_person_idx" ON "leadership_member" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "leadership_member_source_member_idx" ON "leadership_member_source" USING btree ("slate_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leadership_slate_company_version_idx" ON "leadership_slate" USING btree ("company_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "leadership_slate_one_active_idx" ON "leadership_slate" USING btree ("company_id") WHERE "leadership_slate"."status" = 'active';--> statement-breakpoint
CREATE INDEX "leadership_slate_status_idx" ON "leadership_slate" USING btree ("status");--> statement-breakpoint
CREATE INDEX "oidc_transaction_expires_at_idx" ON "oidc_transaction" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pair_presentation_open_idx" ON "pair_presentation" USING btree ("consumed_at","expires_at");--> statement-breakpoint
CREATE INDEX "person_name_idx" ON "person" USING btree ("canonical_name");--> statement-breakpoint
CREATE INDEX "person_fact_person_idx" ON "person_fact" USING btree ("person_id","sort_order");--> statement-breakpoint
CREATE INDEX "person_fact_source_fact_idx" ON "person_fact_source" USING btree ("fact_id");--> statement-breakpoint
CREATE INDEX "person_source_person_idx" ON "person_source" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "portrait_sha256_idx" ON "portrait" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "ranking_entry_run_rank_idx" ON "ranking_entry" USING btree ("run_id","rank");--> statement-breakpoint
CREATE INDEX "ranking_entry_slate_idx" ON "ranking_entry" USING btree ("slate_id");--> statement-breakpoint
CREATE INDEX "security_listing_company_idx" ON "security_listing" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "security_listing_one_canonical_idx" ON "security_listing" USING btree ("company_id") WHERE "security_listing"."is_canonical";