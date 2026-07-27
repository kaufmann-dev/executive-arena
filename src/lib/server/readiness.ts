import { and, eq, exists, notExists, sql } from 'drizzle-orm';
import { db } from './db';
import { company, leadershipMember, leadershipSlate, portrait } from './db/schema';

export type ReadinessStatus = 'not_ready' | 'missing_image' | 'ready' | 'excluded';

export function resolvedCompanyReadinessStatus() {
	const activeSlate = db
		.select({ value: sql`1` })
		.from(leadershipSlate)
		.where(and(eq(leadershipSlate.companyId, company.id), eq(leadershipSlate.status, 'active')));
	const memberPortrait = db
		.select({ value: sql`1` })
		.from(portrait)
		.where(eq(portrait.personId, leadershipMember.personId));
	const activeMemberWithoutPortrait = db
		.select({ value: sql`1` })
		.from(leadershipSlate)
		.innerJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
		.where(
			and(
				eq(leadershipSlate.companyId, company.id),
				eq(leadershipSlate.status, 'active'),
				notExists(memberPortrait)
			)
		);
	return sql<ReadinessStatus>`
		case
			when not ${company.included} then 'excluded'
			when not ${exists(activeSlate)} then 'not_ready'
			when ${exists(activeMemberWithoutPortrait)} then 'missing_image'
			when ${exists(activeSlate)} then 'ready'
			else 'not_ready'
			end
	`;
}
