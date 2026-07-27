import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const NOW = new Date('2026-07-26T12:00:00.000Z');

integration('database-backed automated research runner', () => {
	const sql = postgres(databaseUrl!, { max: 1 });

	beforeAll(async () => {
		process.env.RESEARCH_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64');
		await sql.unsafe(`
			truncate table
				executive_research_worker,
				executive_research_job,
				executive_research_run,
				research_model,
				research_model_provider,
				security_listing,
				company,
				research_snapshot
			restart identity cascade
		`);
		await sql`
			insert into research_snapshot (source, as_of, payload, payload_hash, created_at)
			values ('massive', ${NOW}, ${sql.json({ schemaVersion: 1 })}, 'universe-hash', ${NOW})
		`;
		await sql`
			insert into company (
				issuer_key,
				cik,
				name,
				description,
					homepage_url,
					canonical_ticker,
					included,
					created_at,
				updated_at
			)
			values (
				'cik:0000000001',
				'0000000001',
				'Example Corporation',
				'Example description',
				'https://example.com',
					'EXMP',
					true,
					${NOW},
				${NOW}
			)
		`;
	});

	afterAll(async () => {
		vi.unstubAllGlobals();
		await sql.end();
	});

	it('persists encrypted providers, reusable model limits, and resumable run jobs', async () => {
		const {
			createResearchModel,
			createResearchProvider,
			createResearchRun,
			listResearchProviders,
			listResearchRuns,
			setResearchRunStatus
		} = await import('../research-runner/configuration');
		const provider = await createResearchProvider({
			name: 'Test provider',
			baseUrl: 'https://inference.example/v1',
			apiKey: 'provider-secret-value'
		});
		const [credential] = await sql<Array<{ encryptedApiKey: Buffer; keyHint: string }>>`
			select
				encrypted_api_key as "encryptedApiKey",
				key_hint as "keyHint"
			from research_model_provider
			where id = ${provider.id}
		`;
		expect(credential?.encryptedApiKey.toString('utf8')).not.toContain('provider-secret-value');
		expect(credential?.keyHint).toBe('alue');

		const model = await createResearchModel({
			providerId: provider.id,
			name: 'Fast model',
			modelId: 'provider-fast-model',
			maxConcurrency: 50,
			requestsPerMinute: 120,
			tokensPerMinute: 1_000_000,
			requestTimeoutMs: 180_000,
			maxOutputTokens: 12_000,
			maxAttempts: 3,
			enabled: true
		});
		await expect(listResearchProviders()).resolves.toMatchObject([
			{
				name: 'Test provider',
				models: [
					{
						modelId: 'provider-fast-model',
						maxConcurrency: 50,
						requestsPerMinute: 120,
						tokensPerMinute: 1_000_000
					}
				]
			}
		]);

		const run = await createResearchRun(model.id, NOW);
		expect(run.jobCount).toBe(1);
		await expect(createResearchRun(model.id, NOW)).rejects.toThrow();
		await expect(listResearchRuns()).resolves.toMatchObject([
			{
				id: run.id,
				status: 'queued',
				totalJobs: 1,
				modelIdentifier: 'provider-fast-model',
				maxConcurrency: 50
			}
		]);

		await setResearchRunStatus(run.id, 'pause', NOW);
		await expect(listResearchRuns()).resolves.toMatchObject([{ status: 'paused' }]);
		await setResearchRunStatus(run.id, 'resume', NOW);
		await expect(listResearchRuns()).resolves.toMatchObject([{ status: 'queued' }]);
		await setResearchRunStatus(run.id, 'cancel', NOW);
		const [job] = await sql<Array<{ status: string }>>`
			select status from executive_research_job where run_id = ${run.id}
		`;
		expect(job?.status).toBe('cancelled');
		await expect(listResearchRuns()).resolves.toMatchObject([{ status: 'cancelled' }]);

		await sql`
			update company
			set cik = null, homepage_url = null
			where issuer_key = 'cik:0000000001'
		`;
		const automatedRun = await createResearchRun(model.id, NOW);
		const modelFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const request = JSON.parse(String(init?.body)) as {
				model: string;
				messages: Array<{ content: string }>;
			};
			expect(request.model).toBe('provider-fast-model');
			expect(request.messages[1]?.content).toContain('Example Corporation');
			return Response.json({
				choices: [
					{
						finish_reason: 'stop',
						message: {
							content: JSON.stringify({
								schema_version: 2,
								status: 'needs_review',
								issuer_key: 'cik:0000000001',
								canonical_ticker: 'EXMP',
								company_name: 'Example Corporation',
								reasons: ['No official source or portrait candidate was available.'],
								candidate_sources: []
							})
						}
					}
				],
				usage: { prompt_tokens: 500, completion_tokens: 75 }
			});
		});
		vi.stubGlobal('fetch', modelFetch);
		const { runResearchWorker } = await import('../research-runner/worker');
		await runResearchWorker({
			once: true,
			workerId: 'f9dab98d-e62f-49f7-8e74-85f5982bf521'
		});
		expect(modelFetch).toHaveBeenCalledOnce();
		await expect(listResearchRuns()).resolves.toMatchObject([
			{
				id: automatedRun.id,
				status: 'completed',
				reviewJobs: 1,
				promptTokens: 500,
				completionTokens: 75
			},
			{ id: run.id, status: 'cancelled' }
		]);
		const [automatedIssue] = await sql<
			Array<{ reportedByApiKeyId: string | null; status: string }>
		>`
			select
				eri.reported_by_api_key_id as "reportedByApiKeyId",
				erj.status
			from executive_research_issue eri
			join executive_research_job erj on erj.company_id = eri.company_id
			where erj.run_id = ${automatedRun.id}
		`;
		expect(automatedIssue).toEqual({
			reportedByApiKeyId: null,
			status: 'needs_review'
		});
	});
});
