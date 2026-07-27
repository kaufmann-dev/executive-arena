import { sql } from 'drizzle-orm';
import { company, leadershipSlate } from './db/schema';

export type ReadinessStatus = 'pending' | 'ready' | 'excluded';

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
