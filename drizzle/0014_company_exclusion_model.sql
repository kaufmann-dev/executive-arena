ALTER TABLE "company" ADD COLUMN "universe_exclusion_reason" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "manual_exclusion_reason" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "exclusion_reference_company_id" uuid;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
DO $$
DECLARE
	"unexpected_reasons" text;
BEGIN
	SELECT string_agg(DISTINCT "exclusion_reason", ', ' ORDER BY "exclusion_reason")
	INTO "unexpected_reasons"
	FROM "company"
	WHERE "exclusion_reason" IS NOT NULL
		AND "exclusion_reason" NOT IN (
			'sic_6770',
			'blank_check_description',
			'absent_from_latest_universe'
		);

	IF "unexpected_reasons" IS NOT NULL THEN
		RAISE EXCEPTION 'Unexpected legacy company exclusion_reason values: %', "unexpected_reasons";
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "company"
		WHERE "included" <> ("exclusion_reason" IS NULL)
	) THEN
		RAISE EXCEPTION 'Unexpected legacy company included/exclusion_reason state';
	END IF;
END
$$;--> statement-breakpoint
UPDATE "company"
SET "universe_exclusion_reason" = 'blank_check_or_shell_company'
WHERE "exclusion_reason" IN ('sic_6770', 'blank_check_description');--> statement-breakpoint
UPDATE "company"
SET "archived_at" = "updated_at"
WHERE "exclusion_reason" = 'absent_from_latest_universe';--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_exclusion_reference_company_id_company_id_fk" FOREIGN KEY ("exclusion_reference_company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" DROP COLUMN "exclusion_reason";--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_universe_exclusion_reason_valid" CHECK ("company"."universe_exclusion_reason" is null or "company"."universe_exclusion_reason" = 'blank_check_or_shell_company');--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_manual_exclusion_reason_valid" CHECK ("company"."manual_exclusion_reason" is null or "company"."manual_exclusion_reason" in ('blank_check_or_shell_company', 'executive_profile_incomplete', 'overlapping_executive_coverage'));--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_exclusion_reference_valid" CHECK (("company"."manual_exclusion_reason" = 'overlapping_executive_coverage' and "company"."exclusion_reference_company_id" is not null)
				or ("company"."manual_exclusion_reason" is distinct from 'overlapping_executive_coverage' and "company"."exclusion_reference_company_id" is null));--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_included_matches_state" CHECK ("company"."included" = ("company"."archived_at" is null and "company"."universe_exclusion_reason" is null and "company"."manual_exclusion_reason" is null));
