import { and, eq, exists, sql } from 'drizzle-orm';
import { db } from './db';
import { company, leadershipSlate } from './db/schema';

export type ReadinessStatus = 'pending' | 'ready' | 'excluded';

export function resolvedCompanyReadinessStatus() {
	const activeSlate = db
		.select({ value: sql`1` })
		.from(leadershipSlate)
		.where(and(eq(leadershipSlate.companyId, company.id), eq(leadershipSlate.status, 'active')));
	return sql<ReadinessStatus>`
		case
			when not ${company.included} then 'excluded'
			when ${exists(activeSlate)} then 'ready'
			else 'pending'
			end
	`;
}
