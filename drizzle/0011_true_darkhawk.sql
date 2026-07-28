CREATE TABLE "portrait_ingest_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"retrieval_kind" text NOT NULL,
	"outcome" text NOT NULL,
	"host" text NOT NULL,
	"validation_code" text,
	"http_status" integer,
	"content_type" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portrait_ingest_attempt_retrieval_kind_valid" CHECK ("portrait_ingest_attempt"."retrieval_kind" in ('original', 'brave_thumbnail')),
	CONSTRAINT "portrait_ingest_attempt_outcome_valid" CHECK ("portrait_ingest_attempt"."outcome" in ('saved', 'rejected', 'duplicate')),
	CONSTRAINT "portrait_ingest_attempt_dimensions_positive" CHECK (("portrait_ingest_attempt"."width" is null and "portrait_ingest_attempt"."height" is null) or ("portrait_ingest_attempt"."width" > 0 and "portrait_ingest_attempt"."height" > 0))
);
--> statement-breakpoint
ALTER TABLE "portrait_ingest_attempt" ADD CONSTRAINT "portrait_ingest_attempt_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portrait_ingest_attempt" ADD CONSTRAINT "portrait_ingest_attempt_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portrait_ingest_attempt_created_at_idx" ON "portrait_ingest_attempt" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "portrait_ingest_attempt_operation_idx" ON "portrait_ingest_attempt" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "portrait_ingest_attempt_person_idx" ON "portrait_ingest_attempt" USING btree ("person_id","created_at");