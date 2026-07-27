INSERT INTO "person_source" ("person_id", "source_id", "kind")
SELECT "person_id", "source_id", 'summary'
FROM "leadership_member_source"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "person_source" ("person_id", "source_id", "kind")
SELECT pf."person_id", pfs."source_id", 'summary'
FROM "person_fact_source" pfs
INNER JOIN "person_fact" pf ON pf."id" = pfs."fact_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "person_source" ("person_id", "source_id", "kind")
SELECT "person_id", "source_id", 'summary'
FROM "portrait"
WHERE "source_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
WITH migrated_profiles AS (
	SELECT
		rs."id",
		jsonb_set(
			rs."payload",
			'{schema_version}',
			'4'::jsonb
		) || jsonb_build_object(
			'leaders',
			COALESCE(
				jsonb_agg(
					(leader.value - 'summary_sources' - 'role_source' - 'facts' - 'portraits')
					|| jsonb_build_object(
						'sources',
						COALESCE((
							SELECT jsonb_agg(DISTINCT source_value - 'retrieved_at')
							FROM (
								SELECT jsonb_array_elements(COALESCE(leader.value->'summary_sources', '[]'::jsonb)) AS source_value
								UNION ALL
								SELECT leader.value->'role_source'
								WHERE leader.value ? 'role_source'
								UNION ALL
								SELECT fact_source.value
								FROM jsonb_array_elements(COALESCE(leader.value->'facts', '[]'::jsonb)) fact
								CROSS JOIN LATERAL jsonb_array_elements(COALESCE(fact.value->'sources', '[]'::jsonb)) fact_source
								UNION ALL
								SELECT portrait.value->'source'
								FROM jsonb_array_elements(COALESCE(leader.value->'portraits', '[]'::jsonb)) portrait
								WHERE portrait.value ? 'source'
							) profile_sources
							WHERE source_value IS NOT NULL
						), '[]'::jsonb),
						'facts',
						COALESCE((
							SELECT jsonb_agg(fact.value - 'sources')
							FROM jsonb_array_elements(COALESCE(leader.value->'facts', '[]'::jsonb)) fact
						), '[]'::jsonb),
						'portraits',
						COALESCE((
							SELECT jsonb_agg(
								CASE
									WHEN portrait.value ? 'source'
									THEN jsonb_set(
										portrait.value,
										'{source}',
										(portrait.value->'source') - 'retrieved_at'
									)
									ELSE portrait.value
								END
							)
							FROM jsonb_array_elements(COALESCE(leader.value->'portraits', '[]'::jsonb)) portrait
						), '[]'::jsonb)
					)
					ORDER BY leader.ordinality
				),
				'[]'::jsonb
			)
		) AS payload
	FROM "research_snapshot" rs
	CROSS JOIN LATERAL jsonb_array_elements(rs."payload"->'leaders') WITH ORDINALITY leader(value, ordinality)
	WHERE rs."source" LIKE 'executive_profile:%'
	GROUP BY rs."id", rs."payload"
)
UPDATE "research_snapshot" rs
SET
	"payload" = migrated_profiles.payload,
	"payload_hash" = 'v4:' || rs."id"::text
FROM migrated_profiles
WHERE rs."id" = migrated_profiles.id;--> statement-breakpoint
ALTER TABLE "leadership_member_source" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_fact_source" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "leadership_member_source" CASCADE;--> statement-breakpoint
DROP TABLE "person_fact_source" CASCADE;--> statement-breakpoint
ALTER TABLE "person_source" DROP CONSTRAINT "person_source_person_id_source_id_kind_pk";--> statement-breakpoint
ALTER TABLE "portrait" ALTER COLUMN "image_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "portrait" ALTER COLUMN "source_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "person_source" ADD CONSTRAINT "person_source_person_id_source_id_pk" PRIMARY KEY("person_id","source_id");--> statement-breakpoint
ALTER TABLE "person_source" DROP COLUMN "kind";
