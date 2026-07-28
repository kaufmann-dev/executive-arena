import { and, asc, eq, exists, gt, or, sql } from 'drizzle-orm';
import { getCompanyCard } from '$lib/server/arena/read-model';
import type { LeadershipCard } from '$lib/server/arena/types';
import { db } from '$lib/server/db';
import { company, leadershipMember, leadershipSlate, portrait } from '$lib/server/db/schema';

export type PortraitBackfillMode = 'missing' | 'incomplete';

interface PortraitBackfillCursor {
	name: string;
	id: string;
}

export interface PortraitBackfillTarget {
	card: LeadershipCard;
	cursor: string;
}

export async function getNextPortraitBackfillTarget(
	mode: PortraitBackfillMode,
	cursorValue?: string | null
): Promise<PortraitBackfillTarget | null> {
	const cursor = decodeCursor(cursorValue);
	const normalizedName = sql<string>`lower(${company.name})`;
	const cursorCondition = cursor
		? or(
				gt(normalizedName, cursor.name),
				and(eq(normalizedName, cursor.name), gt(company.id, cursor.id))
			)
		: undefined;
	const [target] = await db
		.select({ id: company.id, name: normalizedName })
		.from(company)
		.where(
			and(eq(company.included, true), activeExecutivePortraitEligibility(mode), cursorCondition)
		)
		.orderBy(asc(normalizedName), asc(company.id))
		.limit(1);
	if (!target) return null;
	const card = await getCompanyCard(target.id);
	if (!card) return null;
	return {
		card,
		cursor: encodeCursor({ name: target.name, id: target.id })
	};
}

export function executiveMatchesBackfillMode(
	portraitCount: number,
	mode: PortraitBackfillMode
): boolean {
	return mode === 'missing' ? portraitCount === 0 : portraitCount < 3;
}

export function activeExecutivePortraitEligibility(mode: PortraitBackfillMode) {
	const portraitCount = db
		.select({ count: sql<number>`count(*)::int` })
		.from(portrait)
		.where(eq(portrait.personId, leadershipMember.personId));
	return exists(
		db
			.select({ id: leadershipMember.personId })
			.from(leadershipSlate)
			.innerJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
			.where(
				and(
					eq(leadershipSlate.companyId, company.id),
					eq(leadershipSlate.status, 'active'),
					mode === 'missing' ? sql`(${portraitCount}) = 0` : sql`(${portraitCount}) < 3`
				)
			)
	);
}

function encodeCursor(cursor: PortraitBackfillCursor): string {
	return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string | null | undefined): PortraitBackfillCursor | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			!('name' in parsed) ||
			typeof parsed.name !== 'string' ||
			!('id' in parsed) ||
			typeof parsed.id !== 'string'
		) {
			return null;
		}
		return { name: parsed.name, id: parsed.id };
	} catch {
		return null;
	}
}
