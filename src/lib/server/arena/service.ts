import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	cohortState,
	comparison,
	company,
	leadershipSlate,
	pairPresentation,
	rankingEntry,
	rankingRun
} from '$lib/server/db/schema';
import { selectPair, type ComparisonOutcome } from '$lib/server/ranking';
import { persistActiveRanking } from '$lib/server/ranking/persistence';
import { getLeadershipCards, getReadinessSummary } from './read-model';
import type { LeadershipCard, ReadinessSummary } from './types';

const PRESENTATION_LIFETIME_MS = 30 * 60 * 1000;

export type PairResult =
	| {
			kind: 'ready';
			presentationId: string;
			phase: string;
			cards: [LeadershipCard, LeadershipCard];
			summary: ReadinessSummary;
	  }
	| { kind: 'locked'; summary: ReadinessSummary; reason: string };

async function activeSlateIds(executor: Pick<typeof db, 'select'>): Promise<string[]> {
	const rows = await executor
		.select({ id: leadershipSlate.id })
		.from(leadershipSlate)
		.innerJoin(company, eq(company.id, leadershipSlate.companyId))
		.where(
			and(
				eq(leadershipSlate.status, 'active'),
				eq(company.included, true),
				eq(company.readinessStatus, 'ready')
			)
		)
		.orderBy(asc(leadershipSlate.id));
	return rows.map((row) => row.id);
}

async function activeOutcomes(
	executor: Pick<typeof db, 'select'>,
	slateIds: string[]
): Promise<Array<ComparisonOutcome & { id: number }>> {
	if (slateIds.length === 0) return [];
	return executor
		.select({
			id: comparison.id,
			leftSlateId: comparison.leftSlateId,
			rightSlateId: comparison.rightSlateId,
			winnerSlateId: comparison.winnerSlateId
		})
		.from(comparison)
		.where(
			and(inArray(comparison.leftSlateId, slateIds), inArray(comparison.rightSlateId, slateIds))
		)
		.orderBy(asc(comparison.id));
}

async function latestRankingEntries(
	executor: Pick<typeof db, 'select'>,
	slateIds: string[],
	cohortRevision: number
) {
	if (slateIds.length === 0) return [];
	const [latest] = await executor
		.select({ id: rankingRun.id })
		.from(rankingRun)
		.where(eq(rankingRun.cohortRevision, cohortRevision))
		.orderBy(desc(rankingRun.createdAt), desc(rankingRun.id))
		.limit(1);
	if (!latest) {
		return slateIds.map((slateId, index) => ({ slateId, rank: index + 1, strength: 1 }));
	}
	const entries = await executor
		.select({
			slateId: rankingEntry.slateId,
			rank: rankingEntry.rank,
			strength: rankingEntry.strength
		})
		.from(rankingEntry)
		.where(and(eq(rankingEntry.runId, latest.id), inArray(rankingEntry.slateId, slateIds)))
		.orderBy(asc(rankingEntry.rank));
	if (entries.length !== slateIds.length) {
		return slateIds.map((slateId, index) => ({ slateId, rank: index + 1, strength: 1 }));
	}
	return entries;
}

export async function getOrCreatePair(now = new Date()): Promise<PairResult> {
	const summary = await getReadinessSummary();
	if (!summary.frozenAt) {
		return { kind: 'locked', summary, reason: 'Freeze the complete cohort before comparing.' };
	}
	if (summary.total < 2 || summary.ready !== summary.total) {
		return {
			kind: 'locked',
			summary,
			reason: 'Every included company needs a complete leadership profile and portrait.'
		};
	}

	const selected = await db.transaction(async (transaction) => {
		await transaction.execute(sql`select pg_advisory_xact_lock(187432901)`);
		const [state] = await transaction
			.select()
			.from(cohortState)
			.where(eq(cohortState.id, 1))
			.for('update')
			.limit(1);
		if (!state?.frozenAt) return null;

		const [open] = await transaction
			.select({
				id: pairPresentation.id,
				leftSlateId: pairPresentation.leftSlateId,
				rightSlateId: pairPresentation.rightSlateId,
				phase: pairPresentation.phase
			})
			.from(pairPresentation)
			.where(
				and(
					eq(pairPresentation.cohortRevision, state.revision),
					isNull(pairPresentation.consumedAt),
					gt(pairPresentation.expiresAt, now)
				)
			)
			.orderBy(desc(pairPresentation.createdAt))
			.limit(1);
		if (open) return open;

		const slateIds = await activeSlateIds(transaction);
		const outcomes = await activeOutcomes(transaction, slateIds);
		const rankingEntries = await latestRankingEntries(transaction, slateIds, state.revision);
		const selection = selectPair({
			activeSlateIds: slateIds,
			comparisons: outcomes,
			rankingEntries,
			seed: state.pairingSeed
		});
		if (!selection) return null;
		const [created] = await transaction
			.insert(pairPresentation)
			.values({
				cohortRevision: state.revision,
				leftSlateId: selection.leftSlateId,
				rightSlateId: selection.rightSlateId,
				phase: selection.phase,
				expiresAt: new Date(now.getTime() + PRESENTATION_LIFETIME_MS)
			})
			.returning({ id: pairPresentation.id });
		return { ...selection, id: created.id };
	});
	if (!selected) {
		return {
			kind: 'locked',
			summary,
			reason: 'At least two active leadership slates are required.'
		};
	}
	const cards = await getLeadershipCards([selected.leftSlateId, selected.rightSlateId]);
	if (cards.length !== 2) throw new Error('Selected leadership profile is incomplete');

	return {
		kind: 'ready',
		presentationId: selected.id,
		phase: selected.phase,
		cards: [cards[0], cards[1]],
		summary
	};
}

export async function recordChoice(
	presentationId: string,
	winnerSlateId: string,
	now = new Date()
): Promise<void> {
	if (!presentationId || !winnerSlateId) throw new Error('A presented winner is required');

	await db.transaction(async (transaction) => {
		const [state] = await transaction
			.select()
			.from(cohortState)
			.where(eq(cohortState.id, 1))
			.for('update')
			.limit(1);
		const [presented] = await transaction
			.select()
			.from(pairPresentation)
			.where(eq(pairPresentation.id, presentationId))
			.limit(1);
		if (!presented) throw new Error('Comparison presentation not found');
		if (presented.consumedAt) throw new Error('Comparison presentation was already used');
		if (presented.expiresAt.getTime() <= now.getTime()) {
			throw new Error('Comparison presentation expired');
		}
		if (winnerSlateId !== presented.leftSlateId && winnerSlateId !== presented.rightSlateId) {
			throw new Error('Winner must be one of the presented leadership slates');
		}

		if (!state || state.revision !== presented.cohortRevision) {
			throw new Error('The company cohort changed; load a new comparison');
		}

		const [consumed] = await transaction
			.update(pairPresentation)
			.set({ consumedAt: now })
			.where(
				and(
					eq(pairPresentation.id, presentationId),
					isNull(pairPresentation.consumedAt),
					gt(pairPresentation.expiresAt, now)
				)
			)
			.returning({ id: pairPresentation.id });
		if (!consumed) throw new Error('Comparison presentation could not be consumed');

		await transaction.insert(comparison).values({
			presentationId,
			cohortRevision: state.revision,
			leftSlateId: presented.leftSlateId,
			rightSlateId: presented.rightSlateId,
			winnerSlateId,
			createdAt: now
		});
	});
	scheduleActiveRankingRefresh(now);
}

export async function refitActiveRanking(now = new Date()): Promise<void> {
	await persistActiveRanking(db, now);
}

let rankingRefreshQueued = false;
let rankingRefreshRunning = false;

export function scheduleActiveRankingRefresh(now = new Date()): void {
	rankingRefreshQueued = true;
	if (rankingRefreshRunning) return;
	rankingRefreshRunning = true;
	void Promise.resolve()
		.then(async () => {
			while (rankingRefreshQueued) {
				rankingRefreshQueued = false;
				await persistActiveRanking(db, now);
			}
		})
		.catch((cause: unknown) => {
			console.error('Failed to refresh the active Bradley–Terry ranking', cause);
		})
		.finally(() => {
			rankingRefreshRunning = false;
			if (rankingRefreshQueued) scheduleActiveRankingRefresh();
		});
}

export async function initializeCohortState(now = new Date()): Promise<void> {
	await db
		.insert(cohortState)
		.values({
			id: 1,
			revision: 1,
			pairingSeed: randomBytes(32).toString('hex'),
			updatedAt: now
		})
		.onConflictDoNothing();
}
