import { and, eq, exists, gt, sql } from 'drizzle-orm';
import { db } from './db';
import { company, executiveResearchClaim } from './db/schema';

export function activeCompanyClaimExists(now: Date) {
	const activeClaim = db
		.select({ value: sql`1` })
		.from(executiveResearchClaim)
		.where(
			and(
				eq(executiveResearchClaim.companyId, company.id),
				gt(executiveResearchClaim.expiresAt, now)
			)
		);
	return exists(activeClaim);
}
