import { describe, expect, it } from 'vitest';
import { db } from '$lib/server/db';
import { company } from '$lib/server/db/schema';
import {
	activeExecutivePortraitEligibility,
	executiveMatchesBackfillMode,
	portraitBackfillSkipEligibility
} from './service';

describe('portrait backfill queue', () => {
	it.each([
		{ mode: 'missing' as const, portraitCount: 0, expected: true },
		{ mode: 'missing' as const, portraitCount: 1, expected: false },
		{ mode: 'incomplete' as const, portraitCount: 0, expected: true },
		{ mode: 'incomplete' as const, portraitCount: 2, expected: true },
		{ mode: 'incomplete' as const, portraitCount: 3, expected: false },
		{ mode: 'skipped' as const, portraitCount: 0, expected: true },
		{ mode: 'skipped' as const, portraitCount: 2, expected: true },
		{ mode: 'skipped' as const, portraitCount: 3, expected: false }
	])('matches $mode mode for $portraitCount portraits', ({ mode, portraitCount, expected }) => {
		expect(executiveMatchesBackfillMode(portraitCount, mode)).toBe(expected);
	});

	it.each([
		{ mode: 'missing' as const, comparison: '= 0' },
		{ mode: 'incomplete' as const, comparison: '< 3' },
		{ mode: 'skipped' as const, comparison: '< 3' }
	])(
		'correlates the $mode queue to the outer company and active member',
		({ mode, comparison }) => {
			const query = db
				.select({ id: company.id })
				.from(company)
				.where(activeExecutivePortraitEligibility(mode))
				.toSQL();

			expect(query.sql).toContain('"leadership_slate"."company_id" = "company"."id"');
			expect(query.sql).toContain('"leadership_member"."person_id"');
			expect(query.sql).toContain('"portrait"."person_id" = "leadership_member"."person_id"');
			expect(query.sql).toContain(comparison);
			expect(query.sql).not.toContain('"company_id" = "id"');
		}
	);

	it.each([
		{ mode: 'missing' as const, comparison: 'is null' },
		{ mode: 'incomplete' as const, comparison: 'is null' },
		{ mode: 'skipped' as const, comparison: 'is not null' }
	])('uses persistent skip state for the $mode queue', ({ mode, comparison }) => {
		const query = db
			.select({ id: company.id })
			.from(company)
			.where(portraitBackfillSkipEligibility(mode))
			.toSQL();

		expect(query.sql).toContain(`"company"."portrait_backfill_skipped_at" ${comparison}`);
	});
});
