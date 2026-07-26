import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import {
	company,
	executiveResearchJob,
	executiveResearchRun,
	executiveResearchWorker,
	researchModel,
	researchModelProvider,
	researchSnapshot,
	type ResearchRunStatus
} from '$lib/server/db/schema';
import { encryptProviderApiKey, providerKeyHint, readCredentialEncryptionKey } from './credentials';

const normalizedBaseUrl = z
	.string()
	.trim()
	.min(1)
	.max(1_000)
	.transform((value, context) => {
		try {
			const url = new URL(value);
			if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
				context.addIssue({
					code: 'custom',
					message:
						'Base URL must be HTTPS and must not contain credentials, query parameters, or a fragment'
				});
				return z.NEVER;
			}
			return url.toString().replace(/\/$/, '');
		} catch {
			context.addIssue({ code: 'custom', message: 'Base URL must be a valid HTTPS URL' });
			return z.NEVER;
		}
	});

const optionalPositiveInteger = (maximum: number) =>
	z.preprocess(
		(value) => (value === '' ? null : value),
		z.coerce.number().int().min(1).max(maximum).nullable()
	);

export const providerInputSchema = z.strictObject({
	name: z.string().trim().min(1).max(100),
	baseUrl: normalizedBaseUrl,
	apiKey: z.string().trim().min(8).max(10_000)
});

export const providerUpdateSchema = z.strictObject({
	id: z.uuid(),
	name: z.string().trim().min(1).max(100),
	baseUrl: normalizedBaseUrl,
	enabled: z.boolean()
});

export const providerKeyRotationSchema = z.strictObject({
	id: z.uuid(),
	apiKey: z.string().trim().min(8).max(10_000)
});

export const modelInputSchema = z.strictObject({
	providerId: z.uuid(),
	name: z.string().trim().min(1).max(100),
	modelId: z.string().trim().min(1).max(200),
	maxConcurrency: z.coerce.number().int().min(1).max(500),
	requestsPerMinute: optionalPositiveInteger(1_000_000),
	tokensPerMinute: optionalPositiveInteger(2_000_000_000),
	requestTimeoutMs: z.coerce.number().int().min(1_000).max(900_000),
	maxOutputTokens: z.coerce.number().int().min(256).max(1_000_000),
	maxAttempts: z.coerce.number().int().min(1).max(20),
	enabled: z.boolean()
});

export const modelUpdateSchema = modelInputSchema.extend({ id: z.uuid() });

export async function listResearchProviders() {
	const rows = await db
		.select({
			providerId: researchModelProvider.id,
			providerName: researchModelProvider.name,
			baseUrl: researchModelProvider.baseUrl,
			keyHint: researchModelProvider.keyHint,
			providerEnabled: researchModelProvider.enabled,
			providerCreatedAt: researchModelProvider.createdAt,
			providerUpdatedAt: researchModelProvider.updatedAt,
			modelId: researchModel.id,
			modelName: researchModel.name,
			modelIdentifier: researchModel.modelId,
			maxConcurrency: researchModel.maxConcurrency,
			requestsPerMinute: researchModel.requestsPerMinute,
			tokensPerMinute: researchModel.tokensPerMinute,
			requestTimeoutMs: researchModel.requestTimeoutMs,
			maxOutputTokens: researchModel.maxOutputTokens,
			maxAttempts: researchModel.maxAttempts,
			modelEnabled: researchModel.enabled
		})
		.from(researchModelProvider)
		.leftJoin(researchModel, eq(researchModel.providerId, researchModelProvider.id))
		.orderBy(researchModelProvider.name, researchModel.name);

	return [...Map.groupBy(rows, (row) => row.providerId).entries()].map(
		([providerId, providerRows]) => {
			const first = providerRows[0]!;
			return {
				id: providerId,
				name: first.providerName,
				baseUrl: first.baseUrl,
				keyHint: first.keyHint,
				enabled: first.providerEnabled,
				createdAt: first.providerCreatedAt,
				updatedAt: first.providerUpdatedAt,
				models: providerRows.flatMap((row) =>
					row.modelId === null
						? []
						: [
								{
									id: row.modelId,
									name: row.modelName!,
									modelId: row.modelIdentifier!,
									maxConcurrency: row.maxConcurrency!,
									requestsPerMinute: row.requestsPerMinute,
									tokensPerMinute: row.tokensPerMinute,
									requestTimeoutMs: row.requestTimeoutMs!,
									maxOutputTokens: row.maxOutputTokens!,
									maxAttempts: row.maxAttempts!,
									enabled: row.modelEnabled!
								}
							]
				)
			};
		}
	);
}

export async function createResearchProvider(input: z.infer<typeof providerInputSchema>) {
	const parsed = providerInputSchema.parse(input);
	const id = randomUUID();
	const masterKey = readCredentialEncryptionKey();
	const [created] = await db
		.insert(researchModelProvider)
		.values({
			id,
			name: parsed.name,
			baseUrl: parsed.baseUrl,
			encryptedApiKey: encryptProviderApiKey(parsed.apiKey, id, masterKey),
			keyHint: providerKeyHint(parsed.apiKey)
		})
		.returning({ id: researchModelProvider.id });
	if (!created) throw new Error('Provider creation did not return a record');
	return created;
}

export async function updateResearchProvider(input: z.infer<typeof providerUpdateSchema>) {
	const parsed = providerUpdateSchema.parse(input);
	const [updated] = await db
		.update(researchModelProvider)
		.set({
			name: parsed.name,
			baseUrl: parsed.baseUrl,
			enabled: parsed.enabled,
			updatedAt: new Date()
		})
		.where(eq(researchModelProvider.id, parsed.id))
		.returning({ id: researchModelProvider.id });
	if (!updated) throw new Error('Provider not found');
	return updated;
}

export async function rotateResearchProviderKey(input: z.infer<typeof providerKeyRotationSchema>) {
	const parsed = providerKeyRotationSchema.parse(input);
	const masterKey = readCredentialEncryptionKey();
	const [updated] = await db
		.update(researchModelProvider)
		.set({
			encryptedApiKey: encryptProviderApiKey(parsed.apiKey, parsed.id, masterKey),
			keyHint: providerKeyHint(parsed.apiKey),
			updatedAt: new Date()
		})
		.where(eq(researchModelProvider.id, parsed.id))
		.returning({ id: researchModelProvider.id });
	if (!updated) throw new Error('Provider not found');
	return updated;
}

export async function createResearchModel(input: z.infer<typeof modelInputSchema>) {
	const parsed = modelInputSchema.parse(input);
	const [created] = await db
		.insert(researchModel)
		.values(parsed)
		.returning({ id: researchModel.id });
	if (!created) throw new Error('Model creation did not return a record');
	return created;
}

export async function updateResearchModel(input: z.infer<typeof modelUpdateSchema>) {
	const parsed = modelUpdateSchema.parse(input);
	const { id, ...values } = parsed;
	const [updated] = await db
		.update(researchModel)
		.set({ ...values, updatedAt: new Date() })
		.where(eq(researchModel.id, id))
		.returning({ id: researchModel.id });
	if (!updated) throw new Error('Model not found');
	return updated;
}

export async function createResearchRun(modelId: string, now = new Date()) {
	if (!z.uuid().safeParse(modelId).success) throw new Error('Invalid model');

	return db.transaction(async (transaction) => {
		const [selected] = await transaction
			.select({
				modelId: researchModel.id,
				modelName: researchModel.name,
				modelIdentifier: researchModel.modelId,
				maxConcurrency: researchModel.maxConcurrency,
				requestsPerMinute: researchModel.requestsPerMinute,
				tokensPerMinute: researchModel.tokensPerMinute,
				requestTimeoutMs: researchModel.requestTimeoutMs,
				maxOutputTokens: researchModel.maxOutputTokens,
				maxAttempts: researchModel.maxAttempts,
				modelEnabled: researchModel.enabled,
				providerName: researchModelProvider.name,
				baseUrl: researchModelProvider.baseUrl,
				providerEnabled: researchModelProvider.enabled
			})
			.from(researchModel)
			.innerJoin(researchModelProvider, eq(researchModelProvider.id, researchModel.providerId))
			.where(eq(researchModel.id, modelId))
			.for('update')
			.limit(1);
		if (!selected) throw new Error('Model not found');
		if (!selected.modelEnabled || !selected.providerEnabled) {
			throw new Error('The selected provider and model must both be enabled');
		}

		const [universe] = await transaction
			.select({
				asOf: researchSnapshot.asOf,
				payloadHash: researchSnapshot.payloadHash
			})
			.from(researchSnapshot)
			.where(eq(researchSnapshot.source, 'massive'))
			.orderBy(desc(researchSnapshot.createdAt), desc(researchSnapshot.id))
			.limit(1);
		if (!universe) throw new Error('Import a Massive universe before starting research');

		const targets = await transaction
			.select({
				companyId: company.id,
				issuerKey: company.issuerKey,
				cik: company.cik,
				canonicalTicker: company.canonicalTicker,
				name: company.name,
				description: company.description,
				homepageUrl: company.homepageUrl
			})
			.from(company)
			.where(and(eq(company.included, true), eq(company.readinessStatus, 'pending')));
		if (targets.length === 0) throw new Error('No pending included companies require research');

		const [run] = await transaction
			.insert(executiveResearchRun)
			.values({
				modelId,
				status: 'queued',
				providerName: selected.providerName,
				baseUrl: selected.baseUrl,
				modelName: selected.modelName,
				modelIdentifier: selected.modelIdentifier,
				maxConcurrency: selected.maxConcurrency,
				requestsPerMinute: selected.requestsPerMinute,
				tokensPerMinute: selected.tokensPerMinute,
				requestTimeoutMs: selected.requestTimeoutMs,
				maxOutputTokens: selected.maxOutputTokens,
				maxAttempts: selected.maxAttempts,
				promptVersion: 'executive-profile-v2',
				universeAsOf: universe.asOf,
				universePayloadHash: universe.payloadHash,
				createdAt: now,
				updatedAt: now
			})
			.returning({ id: executiveResearchRun.id });
		if (!run) throw new Error('Research run creation did not return a record');

		for (const batch of chunks(targets, 500)) {
			await transaction.insert(executiveResearchJob).values(
				batch.map((target) => ({
					runId: run.id,
					companyId: target.companyId,
					input: {
						issuerKey: target.issuerKey,
						cik: target.cik,
						canonicalTicker: target.canonicalTicker,
						name: target.name,
						description: target.description,
						homepageUrl: target.homepageUrl,
						universeAsOf: universe.asOf.toISOString().slice(0, 10)
					},
					createdAt: now,
					updatedAt: now,
					availableAt: now
				}))
			);
		}
		return { id: run.id, jobCount: targets.length };
	});
}

export async function listResearchRuns(limit = 25) {
	return db
		.select({
			id: executiveResearchRun.id,
			status: executiveResearchRun.status,
			providerName: executiveResearchRun.providerName,
			modelName: executiveResearchRun.modelName,
			modelIdentifier: executiveResearchRun.modelIdentifier,
			maxConcurrency: executiveResearchRun.maxConcurrency,
			requestsPerMinute: executiveResearchRun.requestsPerMinute,
			tokensPerMinute: executiveResearchRun.tokensPerMinute,
			promptVersion: executiveResearchRun.promptVersion,
			universeAsOf: executiveResearchRun.universeAsOf,
			createdAt: executiveResearchRun.createdAt,
			startedAt: executiveResearchRun.startedAt,
			completedAt: executiveResearchRun.completedAt,
			totalJobs: sql<number>`count(${executiveResearchJob.id})::int`,
			completedJobs: sql<number>`count(*) filter (where ${executiveResearchJob.status} = 'completed')::int`,
			reviewJobs: sql<number>`count(*) filter (where ${executiveResearchJob.status} = 'needs_review')::int`,
			failedJobs: sql<number>`count(*) filter (where ${executiveResearchJob.status} = 'failed')::int`,
			activeJobs: sql<number>`count(*) filter (where ${executiveResearchJob.status} = 'leased')::int`,
			promptTokens: sql<number>`coalesce(sum(${executiveResearchJob.promptTokens}), 0)::int`,
			completionTokens: sql<number>`coalesce(sum(${executiveResearchJob.completionTokens}), 0)::int`
		})
		.from(executiveResearchRun)
		.leftJoin(executiveResearchJob, eq(executiveResearchJob.runId, executiveResearchRun.id))
		.groupBy(executiveResearchRun.id)
		.orderBy(desc(executiveResearchRun.createdAt))
		.limit(limit);
}

export async function listRecentResearchFailures(limit = 20) {
	return db
		.select({
			id: executiveResearchJob.id,
			runId: executiveResearchJob.runId,
			ticker: company.canonicalTicker,
			companyName: company.name,
			providerName: executiveResearchRun.providerName,
			modelName: executiveResearchRun.modelName,
			attempt: executiveResearchJob.attempt,
			lastError: executiveResearchJob.lastError,
			completedAt: executiveResearchJob.completedAt
		})
		.from(executiveResearchJob)
		.innerJoin(company, eq(company.id, executiveResearchJob.companyId))
		.innerJoin(executiveResearchRun, eq(executiveResearchRun.id, executiveResearchJob.runId))
		.where(eq(executiveResearchJob.status, 'failed'))
		.orderBy(desc(executiveResearchJob.completedAt), desc(executiveResearchJob.updatedAt))
		.limit(limit);
}

export async function setResearchRunStatus(
	runId: string,
	action: 'pause' | 'resume' | 'cancel',
	now = new Date()
) {
	const transitions: Record<typeof action, { from: ResearchRunStatus[]; to: ResearchRunStatus }> = {
		pause: { from: ['queued', 'running'], to: 'paused' },
		resume: { from: ['paused'], to: 'queued' },
		cancel: { from: ['queued', 'running', 'paused'], to: 'cancelled' }
	};
	const transition = transitions[action];
	return db.transaction(async (transaction) => {
		const [updated] = await transaction
			.update(executiveResearchRun)
			.set({
				status: transition.to,
				updatedAt: now,
				completedAt: action === 'cancel' ? now : null
			})
			.where(
				and(
					eq(executiveResearchRun.id, runId),
					inArray(executiveResearchRun.status, transition.from)
				)
			)
			.returning({ id: executiveResearchRun.id });
		if (!updated) throw new Error(`Research run cannot ${action} from its current state`);
		if (action === 'cancel') {
			await transaction
				.update(executiveResearchJob)
				.set({ status: 'cancelled', updatedAt: now, completedAt: now })
				.where(
					and(
						eq(executiveResearchJob.runId, runId),
						inArray(executiveResearchJob.status, ['queued', 'retry'])
					)
				);
		}
		return updated;
	});
}

export async function getResearchWorkerStatus(now = new Date()) {
	const cutoff = new Date(now.getTime() - 15_000);
	const [active] = await db
		.select({
			workerId: executiveResearchWorker.id,
			startedAt: executiveResearchWorker.startedAt,
			heartbeatAt: executiveResearchWorker.heartbeatAt
		})
		.from(executiveResearchWorker)
		.where(
			and(
				isNull(executiveResearchWorker.stoppedAt),
				gte(executiveResearchWorker.heartbeatAt, cutoff)
			)
		)
		.orderBy(desc(executiveResearchWorker.heartbeatAt))
		.limit(1);
	if (active) return { active: true, ...active };

	const [latest] = await db
		.select({
			workerId: executiveResearchWorker.id,
			startedAt: executiveResearchWorker.startedAt,
			heartbeatAt: executiveResearchWorker.heartbeatAt
		})
		.from(executiveResearchWorker)
		.orderBy(desc(executiveResearchWorker.heartbeatAt))
		.limit(1);
	return latest ? { active: false, ...latest } : null;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
	const output: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		output.push(values.slice(index, index + size));
	}
	return output;
}
