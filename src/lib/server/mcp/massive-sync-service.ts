import { env } from '$env/dynamic/private';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
	createNormalizedUniverseSnapshot,
	fetchMassiveUniverse,
	normalizeCik,
	normalizeUniverse,
	reviewedIssuerAliasesSchema,
	type ReviewedIssuerAliases
} from '$lib/research/universe';
import type { MassiveTicker } from '$lib/research/schemas';
import { db } from '$lib/server/db';
import {
	cohortState,
	company,
	leadershipSlate,
	massiveTickerCheckpoint,
	massiveUniverseSync,
	researchSnapshot,
	reviewedIssuerAlias,
	type ReadinessStatus
} from '$lib/server/db/schema';
import { createDatabaseResearchImportService } from '$lib/server/research-import';
import type { AuthenticatedMcpApiKey } from './api-keys';
import { McpResearchError } from './research-service';

const SYNC_LEASE_MS = 2 * 60 * 1_000;
const CHECKPOINT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const PROGRESS_INTERVAL = 25;

export interface SyncMassiveUniverseInput {
	asOf?: string;
	reviewedAliases?: Record<string, string>;
}

export interface MassiveSyncProgress {
	progress: number;
	total?: number;
	message: string;
}

export interface SyncMassiveUniverseOptions {
	fetch?: typeof globalThis.fetch;
	massiveApiKey?: string;
	now?: () => Date;
	signal?: AbortSignal;
	onProgress?: (progress: MassiveSyncProgress) => void | Promise<void>;
}

export interface UnresolvedMassiveListing {
	ticker: string;
	name: string;
	primaryExchange: string | null;
	homepageUrl: string | null;
	tickerRoot: string | null;
	compositeFigi: string | null;
	shareClassFigi: string | null;
}

export type SyncMassiveUniverseResult =
	| {
			status: 'imported' | 'unchanged';
			asOf: string;
			payloadSha256: string;
			issuerCount: number;
			includedCount: number;
			excludedCount: number;
			listingCount: number;
	  }
	| {
			status: 'needs_alias_review';
			asOf: string;
			listingCount: number;
			unresolvedListings: UnresolvedMassiveListing[];
	  };

export async function syncMassiveUniverse(
	actor: AuthenticatedMcpApiKey,
	input: SyncMassiveUniverseInput,
	options: SyncMassiveUniverseOptions = {}
): Promise<SyncMassiveUniverseResult> {
	const now = options.now ?? (() => new Date());
	const startedAt = now();
	const asOf = input.asOf ?? startedAt.toISOString().slice(0, 10);
	const inputAliases = reviewedIssuerAliasesSchema.parse(input.reviewedAliases ?? {});
	const massiveApiKey = options.massiveApiKey ?? env.MASSIVE_API_KEY?.trim();
	if (!massiveApiKey) {
		throw new McpResearchError(
			'massive_not_configured',
			'MASSIVE_API_KEY is not configured for Executive Arena'
		);
	}
	await requireUnfrozenCohort();
	await rejectAliasConflicts(inputAliases);
	await pruneOldSyncs(startedAt);

	const sync = await acquireSync(actor.id, asOf, startedAt);
	const requestIds = new Set<string>();
	try {
		await options.onProgress?.({
			progress: 0,
			message: `Loading the ${asOf} active US common-stock universe from Massive`
		});
		const records = await fetchMassiveUniverse({
			apiKey: massiveApiKey,
			asOf,
			fetch: options.fetch,
			signal: options.signal,
			loadCachedDetail: (ticker) => loadCheckpoint(sync.id, ticker),
			saveDetail: (record, _requestAsOf, requestId) =>
				saveCheckpoint(sync.id, record, requestId, now()),
			onRequestId: (requestId) => requestIds.add(requestId),
			onListComplete: async (listingCount) => {
				await heartbeatSync(sync.id, now(), { listingCount });
				await options.onProgress?.({
					progress: 0,
					total: listingCount,
					message: `Found ${listingCount} listings; enriching ticker details`
				});
			},
			onDetailProgress: async ({ completed, total, ticker, cached }) => {
				if (completed % PROGRESS_INTERVAL !== 0 && completed !== total) return;
				await heartbeatSync(sync.id, now(), { listingCount: total, enrichedCount: completed });
				await options.onProgress?.({
					progress: completed,
					total,
					message: `${cached ? 'Reused' : 'Fetched'} ${ticker}; enriched ${completed}/${total}`
				});
			}
		});

		await persistReviewedAliases(actor.id, inputAliases, records, now());
		const storedAliases = await loadReviewedAliases();
		const unresolved = unresolvedListings(records, storedAliases);
		if (unresolved.length > 0) {
			await db
				.update(massiveUniverseSync)
				.set({
					status: 'needs_alias_review',
					listingCount: records.length,
					enrichedCount: records.length,
					leaseExpiresAt: null,
					error: null,
					updatedAt: now()
				})
				.where(eq(massiveUniverseSync.id, sync.id));
			return {
				status: 'needs_alias_review',
				asOf,
				listingCount: records.length,
				unresolvedListings: unresolved
			};
		}

		const issuers = normalizeUniverse(records, storedAliases);
		const snapshot = createNormalizedUniverseSnapshot(issuers, asOf, now(), [...requestIds]);
		await options.onProgress?.({
			progress: records.length,
			total: records.length,
			message: `Validated ${snapshot.issuerCount} issuers; importing the universe`
		});

		const latest = await db
			.select({ asOf: researchSnapshot.asOf, payloadHash: researchSnapshot.payloadHash })
			.from(researchSnapshot)
			.where(eq(researchSnapshot.source, 'massive'))
			.orderBy(desc(researchSnapshot.createdAt), desc(researchSnapshot.id))
			.limit(1)
			.then((rows) => rows[0]);
		const status =
			latest?.asOf.toISOString().slice(0, 10) === asOf &&
			latest.payloadHash === snapshot.payloadSha256
				? ('unchanged' as const)
				: await createDatabaseResearchImportService(db, {
						now,
						submittedByApiKeyId: actor.id
					})
						.importUniverse(snapshot)
						.then(() => 'imported' as const);
		if (status === 'unchanged') {
			await db
				.update(company)
				.set({
					readinessStatus: sql<ReadinessStatus>`
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
					`
				})
				.execute();
		}

		await completeSync(sync.id, records.length, now());
		return {
			status,
			asOf,
			payloadSha256: snapshot.payloadSha256,
			issuerCount: snapshot.issuerCount,
			includedCount: snapshot.includedCount,
			excludedCount: snapshot.excludedCount,
			listingCount: snapshot.listingCount
		};
	} catch (cause) {
		await failSync(sync.id, cause, now()).catch(() => undefined);
		throw cause;
	}
}

async function requireUnfrozenCohort(): Promise<void> {
	const stored = await db
		.select({ frozenAt: cohortState.frozenAt })
		.from(cohortState)
		.where(eq(cohortState.id, 1))
		.limit(1)
		.then((rows) => rows[0]);
	if (stored?.frozenAt) {
		throw new McpResearchError(
			'cohort_frozen',
			'The Massive universe cannot be synchronized after the cohort has been frozen'
		);
	}
}

async function rejectAliasConflicts(input: ReviewedIssuerAliases): Promise<void> {
	if (Object.keys(input).length === 0) return;
	const stored = await db
		.select({ ticker: reviewedIssuerAlias.ticker, issuerKey: reviewedIssuerAlias.issuerKey })
		.from(reviewedIssuerAlias)
		.where(inArray(reviewedIssuerAlias.ticker, Object.keys(input)));
	for (const alias of stored) {
		if (input[alias.ticker] !== alias.issuerKey) {
			throw new McpResearchError(
				'issuer_alias_conflict',
				`${alias.ticker} is already assigned to ${alias.issuerKey}`
			);
		}
	}
}

async function persistReviewedAliases(
	actorId: string,
	input: ReviewedIssuerAliases,
	records: MassiveTicker[],
	now: Date
): Promise<void> {
	const entries = Object.entries(input);
	if (entries.length === 0) return;
	const eligibleNoCikTickers = new Set(
		records.filter(isEligibleNoCikListing).map((record) => record.ticker.toUpperCase())
	);
	for (const [ticker] of entries) {
		if (!eligibleNoCikTickers.has(ticker)) {
			throw new McpResearchError(
				'issuer_alias_not_applicable',
				`${ticker} is not an eligible no-CIK listing in the selected Massive universe`
			);
		}
	}
	await db
		.insert(reviewedIssuerAlias)
		.values(
			entries.map(([ticker, issuerKey]) => ({
				ticker,
				issuerKey,
				reviewedByApiKeyId: actorId,
				createdAt: now,
				updatedAt: now
			}))
		)
		.onConflictDoUpdate({
			target: reviewedIssuerAlias.ticker,
			set: { updatedAt: now }
		});
}

async function loadReviewedAliases(): Promise<ReviewedIssuerAliases> {
	const rows = await db
		.select({ ticker: reviewedIssuerAlias.ticker, issuerKey: reviewedIssuerAlias.issuerKey })
		.from(reviewedIssuerAlias);
	return reviewedIssuerAliasesSchema.parse(
		Object.fromEntries(rows.map((row) => [row.ticker, row.issuerKey]))
	);
}

function unresolvedListings(
	records: MassiveTicker[],
	aliases: ReviewedIssuerAliases
): UnresolvedMassiveListing[] {
	return records
		.filter(
			(record) =>
				isEligibleNoCikListing(record) && aliases[record.ticker.toUpperCase()] === undefined
		)
		.map((record) => ({
			ticker: record.ticker.toUpperCase(),
			name: record.name,
			primaryExchange: record.primary_exchange ?? null,
			homepageUrl: record.homepage_url ?? null,
			tickerRoot: record.ticker_root ?? null,
			compositeFigi: record.composite_figi ?? null,
			shareClassFigi: record.share_class_figi ?? null
		}))
		.sort((left, right) => left.ticker.localeCompare(right.ticker, 'en-US'));
}

function isEligibleNoCikListing(record: MassiveTicker): boolean {
	return (
		record.active &&
		record.locale.toLocaleLowerCase('en-US') === 'us' &&
		record.market === 'stocks' &&
		record.type === 'CS' &&
		normalizeCik(record.cik) === null
	);
}

async function acquireSync(actorId: string, asOf: string, now: Date) {
	const asOfDate = new Date(`${asOf}T00:00:00.000Z`);
	if (Number.isNaN(asOfDate.valueOf()) || asOfDate.toISOString().slice(0, 10) !== asOf) {
		throw new McpResearchError('validation_error', 'asOf must be an ISO date');
	}
	const leaseExpiresAt = new Date(now.valueOf() + SYNC_LEASE_MS);
	try {
		return await db.transaction(async (transaction) => {
			const running = await transaction
				.select()
				.from(massiveUniverseSync)
				.where(eq(massiveUniverseSync.status, 'running'))
				.for('update')
				.limit(1)
				.then((rows) => rows[0]);
			if (running && running.leaseExpiresAt && running.leaseExpiresAt > now) {
				throw new McpResearchError(
					'universe_sync_in_progress',
					`A Massive universe sync for ${running.asOf.toISOString().slice(0, 10)} is already running`
				);
			}
			if (running) {
				await transaction
					.update(massiveUniverseSync)
					.set({
						status: 'failed',
						leaseExpiresAt: null,
						error: 'The sync lease expired before completion',
						updatedAt: now
					})
					.where(eq(massiveUniverseSync.id, running.id));
			}

			const resumable = await transaction
				.select()
				.from(massiveUniverseSync)
				.where(
					and(
						eq(massiveUniverseSync.asOf, asOfDate),
						inArray(massiveUniverseSync.status, ['failed', 'needs_alias_review'])
					)
				)
				.orderBy(desc(massiveUniverseSync.createdAt))
				.limit(1)
				.then((rows) => rows[0]);
			if (resumable) {
				const [claimed] = await transaction
					.update(massiveUniverseSync)
					.set({
						status: 'running',
						requestedByApiKeyId: actorId,
						leaseExpiresAt,
						error: null,
						updatedAt: now
					})
					.where(eq(massiveUniverseSync.id, resumable.id))
					.returning();
				if (!claimed) throw new Error('Failed to resume the Massive universe sync');
				return claimed;
			}

			const [created] = await transaction
				.insert(massiveUniverseSync)
				.values({
					asOf: asOfDate,
					status: 'running',
					requestedByApiKeyId: actorId,
					leaseExpiresAt,
					createdAt: now,
					updatedAt: now
				})
				.returning();
			if (!created) throw new Error('Failed to create the Massive universe sync');
			return created;
		});
	} catch (cause) {
		if (cause instanceof McpResearchError) throw cause;
		if (isPostgresUniqueViolation(cause)) {
			throw new McpResearchError(
				'universe_sync_in_progress',
				'A Massive universe sync is already running'
			);
		}
		throw cause;
	}
}

async function loadCheckpoint(syncId: string, ticker: string) {
	const stored = await db
		.select({
			record: massiveTickerCheckpoint.record,
			requestId: massiveTickerCheckpoint.requestId
		})
		.from(massiveTickerCheckpoint)
		.where(
			and(eq(massiveTickerCheckpoint.syncId, syncId), eq(massiveTickerCheckpoint.ticker, ticker))
		)
		.limit(1)
		.then((rows) => rows[0]);
	return stored ?? null;
}

async function saveCheckpoint(
	syncId: string,
	record: MassiveTicker,
	requestId: string | null,
	now: Date
): Promise<void> {
	await db
		.insert(massiveTickerCheckpoint)
		.values({
			syncId,
			ticker: record.ticker,
			record,
			requestId,
			createdAt: now,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: [massiveTickerCheckpoint.syncId, massiveTickerCheckpoint.ticker],
			set: { record, requestId, updatedAt: now }
		});
}

async function heartbeatSync(
	syncId: string,
	now: Date,
	counts: { listingCount?: number; enrichedCount?: number }
): Promise<void> {
	await db
		.update(massiveUniverseSync)
		.set({
			...counts,
			leaseExpiresAt: new Date(now.valueOf() + SYNC_LEASE_MS),
			updatedAt: now
		})
		.where(eq(massiveUniverseSync.id, syncId));
}

async function completeSync(syncId: string, listingCount: number, now: Date): Promise<void> {
	await db.transaction(async (transaction) => {
		await transaction
			.update(massiveUniverseSync)
			.set({
				status: 'completed',
				listingCount,
				enrichedCount: listingCount,
				leaseExpiresAt: null,
				error: null,
				updatedAt: now,
				completedAt: now
			})
			.where(eq(massiveUniverseSync.id, syncId));
		await transaction
			.delete(massiveTickerCheckpoint)
			.where(eq(massiveTickerCheckpoint.syncId, syncId));
	});
}

async function failSync(syncId: string, cause: unknown, now: Date): Promise<void> {
	await db
		.update(massiveUniverseSync)
		.set({
			status: 'failed',
			leaseExpiresAt: null,
			error: cause instanceof Error ? cause.message.slice(0, 2_000) : 'The sync failed',
			updatedAt: now
		})
		.where(eq(massiveUniverseSync.id, syncId));
}

async function pruneOldSyncs(now: Date): Promise<void> {
	await db
		.delete(massiveUniverseSync)
		.where(
			and(
				inArray(massiveUniverseSync.status, ['completed', 'failed', 'needs_alias_review']),
				lt(massiveUniverseSync.updatedAt, new Date(now.valueOf() - CHECKPOINT_RETENTION_MS))
			)
		);
}

function isPostgresUniqueViolation(cause: unknown): boolean {
	return (
		typeof cause === 'object' &&
		cause !== null &&
		'code' in cause &&
		(cause as { code?: unknown }).code === '23505'
	);
}
