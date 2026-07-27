import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from './db';
import { company, executiveResearchIssue } from './db/schema';
import { resolvedCompanyReadinessStatus } from './readiness';

describe('resolved company readiness status', () => {
	it('keeps the outer company reference qualified in a single-table query', () => {
		const query = db
			.select({ readinessStatus: resolvedCompanyReadinessStatus() })
			.from(company)
			.where(eq(company.id, 'fbf3e03b-d618-4d6c-93c7-1bfa9f167fc2'))
			.toSQL();

		expectQualifiedCorrelation(query.sql);
	});

	it('uses the same qualified correlation when the outer query has a join', () => {
		const query = db
			.select({ readinessStatus: resolvedCompanyReadinessStatus() })
			.from(company)
			.leftJoin(
				executiveResearchIssue,
				and(
					eq(executiveResearchIssue.companyId, company.id),
					isNull(executiveResearchIssue.resolvedAt)
				)
			)
			.where(eq(company.id, 'fbf3e03b-d618-4d6c-93c7-1bfa9f167fc2'))
			.toSQL();

		expectQualifiedCorrelation(query.sql);
	});
});

function expectQualifiedCorrelation(query: string): void {
	expect(query).toContain('"leadership_slate"."company_id" = "company"."id"');
	expect(query).not.toContain('"company_id" = "id"');
}
