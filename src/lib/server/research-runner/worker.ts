import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	executiveResearchJob,
	executiveResearchRun,
	executiveResearchWorker,
	researchModel,
	researchModelProvider
} from '$lib/server/db/schema';
import { importCompanyProfile } from '$lib/server/arena/admin-service';
import { reportAutomatedExecutiveResearchIssue } from '$lib/server/mcp/research-service';
import { decryptProviderApiKey, readCredentialEncryptionKey } from './credentials';
import {
	ModelRequestError,
	requestExecutiveResearch,
	type ModelResearchResult
} from './model-client';
import { FixedWindowRateLimiter } from './rate-limiter';
import {
	discoverResearchSources,
	researchCompanyInputSchema,
	type ResearchCompanyInput,
	type ResearchSourceBundle
} from './source-discovery';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const MINIMUM_LEASE_MS = 15 * 60_000;
const MAX_RETRY_DELAY_MS = 10 * 60_000;

interface ClaimedJob {
	id: string;
	runId: string;
	companyId: string;
	attempt: number;
	leaseToken: string;
	providerId: string;
	encryptedApiKey: Buffer;
	baseUrl: string;
	modelIdentifier: string;
	requestTimeoutMs: number;
	maxOutputTokens: number;
	maxAttempts: number;
	requestsPerMinute: number | null;
	tokensPerMinute: number | null;
	company: ResearchCompanyInput;
}

export interface ResearchWorkerOptions {
	once?: boolean;
	pollIntervalMs?: number;
	signal?: AbortSignal;
	workerId?: string;
}

export async function runResearchWorker(options: ResearchWorkerOptions = {}): Promise<void> {
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
	readCredentialEncryptionKey();
	const workerId = options.workerId ?? randomUUID();
	const startedAt = new Date();
	await heartbeat(workerId, startedAt, startedAt);
	const heartbeatTimer = setInterval(() => {
		void heartbeat(workerId, startedAt, new Date()).catch((cause) => {
			console.error('Research worker heartbeat failed', cause);
		});
	}, HEARTBEAT_INTERVAL_MS);

	const limiters = new Map<string, FixedWindowRateLimiter>();
	try {
		do {
			if (options.signal?.aborted) break;
			const jobs = await claimJobs(workerId);
			if (jobs.length === 0) {
				await finalizeRuns();
				if (options.once) break;
				await wait(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, options.signal);
				continue;
			}
			await Promise.all(
				jobs.map((job) => {
					let limiter = limiters.get(job.runId);
					if (!limiter) {
						limiter = new FixedWindowRateLimiter({
							requestsPerMinute: job.requestsPerMinute,
							tokensPerMinute: job.tokensPerMinute
						});
						limiters.set(job.runId, limiter);
					}
					return processJob(job, limiter);
				})
			);
			await finalizeRuns();
		} while (!options.once);
	} finally {
		clearInterval(heartbeatTimer);
		await db
			.update(executiveResearchWorker)
			.set({ heartbeatAt: new Date(), stoppedAt: new Date() })
			.where(eq(executiveResearchWorker.id, workerId));
	}
}

async function claimJobs(workerId: string, now = new Date()): Promise<ClaimedJob[]> {
	return db.transaction(async (transaction) => {
		const [run] = await transaction
			.select({
				id: executiveResearchRun.id,
				status: executiveResearchRun.status,
				modelId: executiveResearchRun.modelId,
				baseUrl: executiveResearchRun.baseUrl,
				modelIdentifier: executiveResearchRun.modelIdentifier,
				maxConcurrency: executiveResearchRun.maxConcurrency,
				requestsPerMinute: executiveResearchRun.requestsPerMinute,
				tokensPerMinute: executiveResearchRun.tokensPerMinute,
				requestTimeoutMs: executiveResearchRun.requestTimeoutMs,
				maxOutputTokens: executiveResearchRun.maxOutputTokens,
				maxAttempts: executiveResearchRun.maxAttempts
			})
			.from(executiveResearchRun)
			.where(inArray(executiveResearchRun.status, ['queued', 'running']))
			.orderBy(asc(executiveResearchRun.createdAt))
			.for('update', { skipLocked: true })
			.limit(1);
		if (!run) return [];

		await transaction
			.update(executiveResearchJob)
			.set({
				status: 'failed',
				lastError: 'Job lease expired after the configured attempt limit',
				leaseToken: null,
				leaseExpiresAt: null,
				workerId: null,
				updatedAt: now,
				completedAt: now
			})
			.where(
				and(
					eq(executiveResearchJob.runId, run.id),
					eq(executiveResearchJob.status, 'leased'),
					lt(executiveResearchJob.leaseExpiresAt, now),
					sql`${executiveResearchJob.attempt} >= ${run.maxAttempts}`
				)
			);

		const [active] = await transaction
			.select({ value: count() })
			.from(executiveResearchJob)
			.where(
				and(
					eq(executiveResearchJob.runId, run.id),
					eq(executiveResearchJob.status, 'leased'),
					or(
						isNull(executiveResearchJob.leaseExpiresAt),
						gte(executiveResearchJob.leaseExpiresAt, now)
					)
				)
			);
		const rateLimitedBatch =
			run.requestsPerMinute === null
				? run.maxConcurrency
				: Math.min(run.maxConcurrency, run.requestsPerMinute);
		const availableSlots = Math.max(0, rateLimitedBatch - (active?.value ?? 0));
		if (availableSlots === 0) return [];

		const candidates = await transaction
			.select({ id: executiveResearchJob.id })
			.from(executiveResearchJob)
			.where(
				and(
					eq(executiveResearchJob.runId, run.id),
					or(
						and(
							inArray(executiveResearchJob.status, ['queued', 'retry']),
							lte(executiveResearchJob.availableAt, now)
						),
						and(
							eq(executiveResearchJob.status, 'leased'),
							lt(executiveResearchJob.leaseExpiresAt, now),
							sql`${executiveResearchJob.attempt} < ${run.maxAttempts}`
						)
					)
				)
			)
			.orderBy(asc(executiveResearchJob.availableAt), asc(executiveResearchJob.createdAt))
			.for('update', { skipLocked: true })
			.limit(availableSlots);
		if (candidates.length === 0) return [];

		const leaseToken = randomUUID();
		const leaseExpiresAt = new Date(
			now.getTime() + Math.max(MINIMUM_LEASE_MS, run.requestTimeoutMs + 5 * 60_000)
		);
		const claimed = await transaction
			.update(executiveResearchJob)
			.set({
				status: 'leased',
				attempt: sql`${executiveResearchJob.attempt} + 1`,
				leaseToken,
				leaseExpiresAt,
				workerId,
				startedAt: sql`coalesce(${executiveResearchJob.startedAt}, ${now.toISOString()}::timestamptz)`,
				updatedAt: now,
				lastError: null
			})
			.where(
				inArray(
					executiveResearchJob.id,
					candidates.map((candidate) => candidate.id)
				)
			)
			.returning({
				id: executiveResearchJob.id,
				companyId: executiveResearchJob.companyId,
				attempt: executiveResearchJob.attempt,
				input: executiveResearchJob.input
			});
		await transaction
			.update(executiveResearchRun)
			.set({
				status: 'running',
				startedAt: sql`coalesce(${executiveResearchRun.startedAt}, ${now.toISOString()}::timestamptz)`,
				updatedAt: now
			})
			.where(eq(executiveResearchRun.id, run.id));

		const [provider] = await transaction
			.select({
				id: researchModelProvider.id,
				encryptedApiKey: researchModelProvider.encryptedApiKey
			})
			.from(researchModel)
			.innerJoin(researchModelProvider, eq(researchModelProvider.id, researchModel.providerId))
			.where(eq(researchModel.id, run.modelId))
			.limit(1);
		if (!provider) throw new Error('Research run provider no longer exists');

		return claimed.map((job) => {
			return {
				id: job.id,
				runId: run.id,
				companyId: job.companyId,
				attempt: job.attempt,
				leaseToken,
				providerId: provider.id,
				encryptedApiKey: provider.encryptedApiKey,
				baseUrl: run.baseUrl,
				modelIdentifier: run.modelIdentifier,
				requestTimeoutMs: run.requestTimeoutMs,
				maxOutputTokens: run.maxOutputTokens,
				maxAttempts: run.maxAttempts,
				requestsPerMinute: run.requestsPerMinute,
				tokensPerMinute: run.tokensPerMinute,
				company: researchCompanyInputSchema.parse(job.input)
			};
		});
	});
}

async function processJob(job: ClaimedJob, limiter: FixedWindowRateLimiter): Promise<void> {
	let bundle: ResearchSourceBundle | undefined;
	try {
		bundle = await discoverResearchSources(job.company);
		const estimatedTokens =
			Math.ceil(
				JSON.stringify({ sources: bundle.sources, portraits: bundle.portraits }).length / 4
			) + job.maxOutputTokens;
		await limiter.acquire(estimatedTokens);
		const apiKey = decryptProviderApiKey(job.encryptedApiKey, job.providerId);
		const result = await requestExecutiveResearch(
			{
				baseUrl: job.baseUrl,
				model: job.modelIdentifier,
				apiKey,
				requestTimeoutMs: job.requestTimeoutMs,
				maxOutputTokens: job.maxOutputTokens,
				userId: job.id
			},
			job.company,
			bundle
		);
		if (!(await runAllowsPublishing(job.runId))) {
			await markCancelled(job);
			return;
		}
		await publishResult(job, result);
	} catch (cause) {
		await markFailedAttempt(job, cause, bundle);
	}
}

async function publishResult(job: ClaimedJob, result: ModelResearchResult): Promise<void> {
	if ('status' in result.artifact) {
		await reportAutomatedExecutiveResearchIssue(job.companyId, result.artifact);
		await completeJob(job, 'needs_review', result.artifact, result);
		return;
	}
	await importCompanyProfile(job.companyId, result.artifact);
	await completeJob(job, 'completed', result.artifact, result);
}

async function completeJob(
	job: ClaimedJob,
	status: 'completed' | 'needs_review',
	result: unknown,
	usage: Pick<ModelResearchResult, 'promptTokens' | 'completionTokens'>,
	now = new Date()
): Promise<void> {
	await db
		.update(executiveResearchJob)
		.set({
			status,
			result,
			promptTokens: usage.promptTokens,
			completionTokens: usage.completionTokens,
			leaseToken: null,
			leaseExpiresAt: null,
			workerId: null,
			updatedAt: now,
			completedAt: now
		})
		.where(
			and(eq(executiveResearchJob.id, job.id), eq(executiveResearchJob.leaseToken, job.leaseToken))
		);
}

async function markFailedAttempt(
	job: ClaimedJob,
	cause: unknown,
	bundle: ResearchSourceBundle | undefined,
	now = new Date()
): Promise<void> {
	const retryable = !(cause instanceof ModelRequestError) || cause.retryable;
	const retry = retryable && job.attempt < job.maxAttempts;
	const lastError = [
		errorMessage(cause),
		bundle?.warnings.length ? `Discovery warnings: ${bundle.warnings.join('; ')}` : ''
	]
		.filter(Boolean)
		.join('\n')
		.slice(0, 20_000);
	await db
		.update(executiveResearchJob)
		.set({
			status: retry ? 'retry' : 'failed',
			availableAt: retry ? new Date(now.getTime() + retryDelayMilliseconds(job.attempt)) : now,
			lastError,
			leaseToken: null,
			leaseExpiresAt: null,
			workerId: null,
			updatedAt: now,
			completedAt: retry ? null : now
		})
		.where(
			and(eq(executiveResearchJob.id, job.id), eq(executiveResearchJob.leaseToken, job.leaseToken))
		);
}

async function markCancelled(job: ClaimedJob, now = new Date()): Promise<void> {
	await db
		.update(executiveResearchJob)
		.set({
			status: 'cancelled',
			leaseToken: null,
			leaseExpiresAt: null,
			workerId: null,
			updatedAt: now,
			completedAt: now
		})
		.where(
			and(eq(executiveResearchJob.id, job.id), eq(executiveResearchJob.leaseToken, job.leaseToken))
		);
}

async function runAllowsPublishing(runId: string): Promise<boolean> {
	const [run] = await db
		.select({ status: executiveResearchRun.status })
		.from(executiveResearchRun)
		.where(eq(executiveResearchRun.id, runId))
		.limit(1);
	return run?.status === 'queued' || run?.status === 'running' || run?.status === 'paused';
}

async function finalizeRuns(now = new Date()): Promise<void> {
	const candidates = await db
		.select({ id: executiveResearchRun.id })
		.from(executiveResearchRun)
		.where(inArray(executiveResearchRun.status, ['queued', 'running']))
		.orderBy(desc(executiveResearchRun.createdAt));
	for (const run of candidates) {
		const [unfinished] = await db
			.select({ value: count() })
			.from(executiveResearchJob)
			.where(
				and(
					eq(executiveResearchJob.runId, run.id),
					inArray(executiveResearchJob.status, ['queued', 'leased', 'retry'])
				)
			);
		if ((unfinished?.value ?? 0) === 0) {
			await db
				.update(executiveResearchRun)
				.set({ status: 'completed', updatedAt: now, completedAt: now })
				.where(
					and(
						eq(executiveResearchRun.id, run.id),
						inArray(executiveResearchRun.status, ['queued', 'running'])
					)
				);
		}
	}
}

async function heartbeat(workerId: string, startedAt: Date, now: Date): Promise<void> {
	await db
		.insert(executiveResearchWorker)
		.values({ id: workerId, startedAt, heartbeatAt: now })
		.onConflictDoUpdate({
			target: executiveResearchWorker.id,
			set: { heartbeatAt: now, stoppedAt: null }
		});
}

function retryDelayMilliseconds(attempt: number): number {
	return Math.min(MAX_RETRY_DELAY_MS, 5_000 * 2 ** Math.max(0, attempt - 1));
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const timeout = setTimeout(resolve, milliseconds);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timeout);
				resolve();
			},
			{ once: true }
		);
	});
}
