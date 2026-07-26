import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
	cohortState,
	comparison,
	company,
	leadershipSlate,
	rankingEntry,
	rankingRun
} from '../db/schema';
import * as schema from '../db/schema';
import { fitBradleyTerry } from './bradley-terry';

export type RankingDatabase = PostgresJsDatabase<typeof schema>;
const RANKING_INSERT_BATCH_SIZE = 1_000;

export async function persistActiveRanking(
	database: RankingDatabase,
	now = new Date()
): Promise<void> {
	await database.transaction(async (transaction) => {
		await transaction.execute(sql`select pg_advisory_xact_lock(187432902)`);
		const [state] = await transaction
			.select()
			.from(cohortState)
			.where(eq(cohortState.id, 1))
			.for('update')
			.limit(1);
		if (!state) return;
		const active = await transaction
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
		const slateIds = active.map((slate) => slate.id);
		const outcomes =
			slateIds.length === 0
				? []
				: await transaction
						.select({
							id: comparison.id,
							leftSlateId: comparison.leftSlateId,
							rightSlateId: comparison.rightSlateId,
							winnerSlateId: comparison.winnerSlateId
						})
						.from(comparison)
						.where(
							and(
								inArray(comparison.leftSlateId, slateIds),
								inArray(comparison.rightSlateId, slateIds)
							)
						)
						.orderBy(asc(comparison.id));
		if (outcomes.length === 0) {
			await transaction.delete(rankingRun);
			return;
		}
		const comparisonCutoff = outcomes.at(-1)?.id ?? 0;
		const [existingRun] = await transaction
			.select({ id: rankingRun.id })
			.from(rankingRun)
			.where(
				and(
					eq(rankingRun.cohortRevision, state.revision),
					eq(rankingRun.comparisonCutoff, comparisonCutoff),
					eq(rankingRun.activeCount, slateIds.length)
				)
			)
			.limit(1);
		if (existingRun) {
			const [stored] = await transaction
				.select({ value: count() })
				.from(rankingEntry)
				.where(eq(rankingEntry.runId, existingRun.id));
			if (stored?.value === slateIds.length) return;
		}
		const fit = fitBradleyTerry(slateIds, outcomes);
		if (!fit.converged) throw new Error('Bradley–Terry fit did not converge');
		const [run] = await transaction
			.insert(rankingRun)
			.values({
				cohortRevision: state.revision,
				comparisonCutoff,
				activeCount: slateIds.length,
				iterations: fit.iterations,
				converged: true,
				maxDelta: fit.maxDelta,
				createdAt: now
			})
			.returning({ id: rankingRun.id });
		if (fit.entries.length > 0) {
			const entries = fit.entries.map((entry) => ({
				runId: run.id,
				slateId: entry.slateId,
				rank: entry.rank,
				strength: entry.strength,
				score: entry.score,
				wins: entry.wins,
				losses: entry.losses,
				comparisonCount: entry.comparisonCount
			}));
			for (let index = 0; index < entries.length; index += RANKING_INSERT_BATCH_SIZE) {
				await transaction
					.insert(rankingEntry)
					.values(entries.slice(index, index + RANKING_INSERT_BATCH_SIZE));
			}
		}
		await transaction.delete(rankingRun).where(ne(rankingRun.id, run.id));
	});
}
