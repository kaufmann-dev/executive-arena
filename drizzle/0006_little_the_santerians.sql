ALTER TABLE "portrait" DROP CONSTRAINT "portrait_person_id_unique";--> statement-breakpoint
ALTER TABLE "portrait" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "portrait_person_order_unique_idx" ON "portrait" USING btree ("person_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "portrait_person_sha256_unique_idx" ON "portrait" USING btree ("person_id","sha256");--> statement-breakpoint
ALTER TABLE "portrait" ADD CONSTRAINT "portrait_display_order_range" CHECK ("portrait"."display_order" >= 0 and "portrait"."display_order" < 3);--> statement-breakpoint
UPDATE "research_snapshot"
SET
	"payload" = jsonb_set(
		jsonb_set("payload", '{schema_version}', '2'::jsonb),
		'{leaders}',
		(
			SELECT jsonb_agg(
				("leader" - 'portrait') || jsonb_build_object('portraits', jsonb_build_array("leader"->'portrait'))
				ORDER BY "position"
			)
			FROM jsonb_array_elements("payload"->'leaders') WITH ORDINALITY AS "leaders"("leader", "position")
		)
	),
	"payload_hash" = NULL
WHERE
	"source" LIKE 'executive_profile:%'
	AND "payload"->>'schema_version' = '1'
	AND jsonb_typeof("payload"->'leaders') = 'array';--> statement-breakpoint
UPDATE "executive_research_issue"
SET "payload" = jsonb_set("payload", '{schema_version}', '2'::jsonb)
WHERE "payload"->>'schema_version' = '1';--> statement-breakpoint
UPDATE "executive_research_job"
SET "result" = CASE
	WHEN jsonb_typeof("result"->'leaders') = 'array' THEN jsonb_set(
		jsonb_set("result", '{schema_version}', '2'::jsonb),
		'{leaders}',
		(
			SELECT jsonb_agg(
				("leader" - 'portrait') || jsonb_build_object('portraits', jsonb_build_array("leader"->'portrait'))
				ORDER BY "position"
			)
			FROM jsonb_array_elements("result"->'leaders') WITH ORDINALITY AS "leaders"("leader", "position")
		)
	)
	ELSE jsonb_set("result", '{schema_version}', '2'::jsonb)
END
WHERE "result"->>'schema_version' = '1';
