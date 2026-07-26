CREATE TABLE "executive_research_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"worker_id" uuid,
	"result" jsonb,
	"last_error" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "executive_research_job_run_company_unique" UNIQUE("run_id","company_id"),
	CONSTRAINT "executive_research_job_attempt_nonnegative" CHECK ("executive_research_job"."attempt" >= 0),
	CONSTRAINT "executive_research_job_prompt_tokens_nonnegative" CHECK ("executive_research_job"."prompt_tokens" >= 0),
	CONSTRAINT "executive_research_job_completion_tokens_nonnegative" CHECK ("executive_research_job"."completion_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "executive_research_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_name" text NOT NULL,
	"base_url" text NOT NULL,
	"model_name" text NOT NULL,
	"model_identifier" text NOT NULL,
	"max_concurrency" integer NOT NULL,
	"requests_per_minute" integer,
	"tokens_per_minute" integer,
	"request_timeout_ms" integer NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"prompt_version" text NOT NULL,
	"universe_as_of" timestamp with time zone NOT NULL,
	"universe_payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "executive_research_worker" (
	"id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "research_model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"model_id" text NOT NULL,
	"max_concurrency" integer NOT NULL,
	"requests_per_minute" integer,
	"tokens_per_minute" integer,
	"request_timeout_ms" integer NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_model_provider_model_unique" UNIQUE("provider_id","model_id"),
	CONSTRAINT "research_model_max_concurrency_range" CHECK ("research_model"."max_concurrency" between 1 and 500),
	CONSTRAINT "research_model_requests_per_minute_positive" CHECK ("research_model"."requests_per_minute" is null or "research_model"."requests_per_minute" > 0),
	CONSTRAINT "research_model_tokens_per_minute_positive" CHECK ("research_model"."tokens_per_minute" is null or "research_model"."tokens_per_minute" > 0),
	CONSTRAINT "research_model_request_timeout_range" CHECK ("research_model"."request_timeout_ms" between 1000 and 900000),
	CONSTRAINT "research_model_max_output_tokens_range" CHECK ("research_model"."max_output_tokens" between 256 and 1000000),
	CONSTRAINT "research_model_max_attempts_range" CHECK ("research_model"."max_attempts" between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "research_model_provider" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"encrypted_api_key" "bytea" NOT NULL,
	"key_hint" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_model_provider_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "executive_research_issue" ALTER COLUMN "reported_by_api_key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "executive_research_job" ADD CONSTRAINT "executive_research_job_run_id_executive_research_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."executive_research_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_research_job" ADD CONSTRAINT "executive_research_job_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_research_run" ADD CONSTRAINT "executive_research_run_model_id_research_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."research_model"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_model" ADD CONSTRAINT "research_model_provider_id_research_model_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."research_model_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "executive_research_job_claim_idx" ON "executive_research_job" USING btree ("run_id","status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "executive_research_job_company_idx" ON "executive_research_job" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "executive_research_job_lease_idx" ON "executive_research_job" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "executive_research_run_status_idx" ON "executive_research_run" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "executive_research_run_model_idx" ON "executive_research_run" USING btree ("model_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "executive_research_run_one_active_model_idx" ON "executive_research_run" USING btree ("model_id") WHERE "executive_research_run"."status" in ('queued', 'running', 'paused');--> statement-breakpoint
CREATE INDEX "research_model_provider_idx" ON "research_model" USING btree ("provider_id","enabled");--> statement-breakpoint
CREATE INDEX "research_model_provider_enabled_idx" ON "research_model_provider" USING btree ("enabled","name");