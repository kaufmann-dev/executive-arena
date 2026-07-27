import { sql } from 'drizzle-orm';
import { company, leadershipSlate } from './db/schema';
import type { ReadinessStatus } from './db/schema';

export function resolvedCompanyReadinessStatus() {
	return sql<ReadinessStatus>`
		case
			when not ${company.included} then 'excluded'
			when exists (
				select 1
				from ${leadershipSlate}
				where ${leadershipSlate.companyId} = ${company.id}
					and ${leadershipSlate.status} = 'active'
			) then 'ready'
			else 'pending'
			end
	`;
}
