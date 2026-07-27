import { lte, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from './db';
import { company, executiveResearchClaim } from './db/schema';
import { activeCompanyClaimExists } from './research-claim-query';

describe('active company research claim query', () => {
	it('keeps the outer company reference qualified in aggregate queries', () => {
		const now = new Date('2026-07-27T13:00:00.000Z');
		const query = db
			.select({
				claimed: sql<number>`count(*) filter (where ${activeCompanyClaimExists(now)})::int`
			})
			.from(company)
			.toSQL();

		expect(query.sql).toContain('"executive_research_claim"."company_id" = "company"."id"');
		expect(query.sql).not.toContain('"company_id" = "id"');
	});

	it('uses the timestamp column encoder for expired-claim cleanup', () => {
		const now = new Date('2026-07-27T13:00:00.000Z');
		const query = db
			.delete(executiveResearchClaim)
			.where(lte(executiveResearchClaim.expiresAt, now))
			.toSQL();

		expect(query.sql).toContain('"executive_research_claim"."expires_at" <= $1');
		expect(query.params).toEqual([now.toISOString()]);
	});
});
