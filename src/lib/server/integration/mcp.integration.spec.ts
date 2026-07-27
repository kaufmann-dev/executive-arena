import sharp from 'sharp';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExecutiveProfile } from '../../research/schemas';
import type { NormalizedIssuer } from '../../research/universe';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const NOW = new Date('2026-07-26T12:00:00.000Z');

integration('database-backed MCP research lifecycle', () => {
	const cleanup = postgres(databaseUrl!, { max: 1 });
	let portraitBytes: Buffer;

	beforeAll(async () => {
		await cleanup.unsafe(`
			truncate table
				massive_ticker_checkpoint,
				massive_universe_sync,
				reviewed_issuer_alias,
				executive_research_issue,
				mcp_api_key,
				cohort_state,
				comparison,
				leadership_member_source,
				leadership_member,
				pair_presentation,
				person_fact_source,
				person_fact,
				person_source,
				portrait,
				ranking_entry,
				ranking_run,
				leadership_slate,
				person,
				security_listing,
				company,
				source,
				research_snapshot
			restart identity cascade
		`);
		portraitBytes = await sharp({
			create: {
				width: 320,
				height: 320,
				channels: 3,
				background: { r: 28, g: 93, b: 71 }
			}
		})
			.png()
			.toBuffer();
	});

	afterAll(async () => {
		vi.unstubAllGlobals();
		await cleanup.end();
	});

	it('supports independent keys, publishing, attribution, review resolution, and deletion', async () => {
		const { authenticateMcpApiKey, createMcpApiKey, deleteMcpApiKey } =
			await import('../mcp/api-keys');
		const { syncMassiveUniverse } = await import('../mcp/massive-sync-service');
		const {
			getExecutiveResearchTask,
			getResearchCoverage,
			listResearchCompanies,
			publishExecutiveProfile,
			reportExecutiveResearchIssue
		} = await import('../mcp/research-service');
		const first = await createMcpApiKey('First Codex', NOW);
		const second = await createMcpApiKey('Second Codex', NOW);
		const firstAuth = await authenticateMcpApiKey(`Bearer ${first.token}`, NOW);
		const secondAuth = await authenticateMcpApiKey(`Bearer ${second.token}`, NOW);
		expect(firstAuth?.id).toBe(first.id);
		expect(secondAuth?.id).toBe(second.id);
		const issuerRecord = issuer();
		const firstSync = await syncMassiveUniverse(
			firstAuth!,
			{ asOf: '2026-07-26' },
			{
				massiveApiKey: 'massive-secret',
				fetch: massiveFetcher(),
				now: () => NOW
			}
		);
		expect(firstSync).toMatchObject({
			status: 'needs_alias_review',
			unresolvedListings: [{ ticker: 'EXMP' }]
		});
		const [{ companyCount }] = await cleanup<Array<{ companyCount: number }>>`
			select count(*)::int as "companyCount" from company
		`;
		expect(companyCount).toBe(0);
		await expect(
			syncMassiveUniverse(
				firstAuth!,
				{
					asOf: '2026-07-26',
					reviewedAliases: { EXMP: issuerRecord.issuerKey }
				},
				{
					massiveApiKey: 'massive-secret',
					fetch: massiveFetcher(),
					now: () => NOW
				}
			)
		).resolves.toMatchObject({
			status: 'imported',
			issuerCount: 1,
			includedCount: 1,
			listingCount: 1
		});

		const storedKeys = await cleanup<Array<{ tokenHash: string }>>`
			select token_hash as "tokenHash" from mcp_api_key order by created_at
		`;
		expect(storedKeys).toHaveLength(2);
		expect(storedKeys.some((row) => row.tokenHash === first.token)).toBe(false);
		expect(storedKeys.some((row) => row.tokenHash === second.token)).toBe(false);
		await expect(getResearchCoverage()).resolves.toMatchObject({
			included: 1,
			pending: 1,
			ready: 0,
			needsReview: 0,
			cohortRevision: 1,
			cohortFrozenAt: null
		});
		await expect(
			listResearchCompanies({
				status: 'pending',
				review: 'clear',
				limit: 20
			})
		).resolves.toMatchObject({
			items: [expect.objectContaining({ issuerKey: issuerRecord.issuerKey })],
			nextCursor: null
		});

		const [storedCompany] = await cleanup<Array<{ id: string; marketCap: number }>>`
			select id, market_cap as "marketCap"
			from company
			where issuer_key = ${issuerRecord.issuerKey}
		`;
		expect(storedCompany).toMatchObject({
			marketCap: 39_136_594_480.08
		});
		const [storedListing] = await cleanup<Array<{ marketCap: number }>>`
			select market_cap as "marketCap"
			from security_listing
			where ticker = ${issuerRecord.canonicalTicker}
		`;
		expect(storedListing).toMatchObject({
			marketCap: 39_136_594_480.08
		});
		const issue = reviewArtifact(issuerRecord);
		await reportExecutiveResearchIssue(firstAuth!, storedCompany!.id, issue, NOW);
		await expect(
			listResearchCompanies({
				status: 'pending',
				review: 'needs_review',
				limit: 20
			})
		).resolves.toMatchObject({
			items: [expect.objectContaining({ reviewStatus: 'needs_review' })]
		});

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(Uint8Array.from(portraitBytes).buffer, { status: 200 }))
		);
		const profile = executiveProfile(issuerRecord);
		const published = await publishExecutiveProfile(firstAuth!, storedCompany!.id, profile, NOW);
		expect(published.action).toBe('created');
		await expect(
			publishExecutiveProfile(firstAuth!, storedCompany!.id, profile, NOW)
		).resolves.toMatchObject({ action: 'unchanged', slateId: published.slateId });

		const [snapshot] = await cleanup<Array<{ submittedByApiKeyId: string; payloadHash: string }>>`
			select
				submitted_by_api_key_id as "submittedByApiKeyId",
				payload_hash as "payloadHash"
			from research_snapshot
			where source = ${`executive_profile:${issuerRecord.issuerKey}`}
		`;
		expect(snapshot).toMatchObject({
			submittedByApiKeyId: first.id,
			payloadHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
		});
		const [storedIssue] = await cleanup<Array<{ resolvedAt: Date | null }>>`
			select resolved_at as "resolvedAt" from executive_research_issue
		`;
		expect(storedIssue?.resolvedAt).toEqual(NOW);
		await expect(getExecutiveResearchTask(storedCompany!.id)).resolves.toMatchObject({
			company: {
				companyId: storedCompany!.id,
				readinessStatus: 'ready'
			},
			currentProfile: {
				issuer_key: issuerRecord.issuerKey
			},
			openIssue: null
		});

		await expect(
			syncMassiveUniverse(
				firstAuth!,
				{ asOf: '2026-07-27' },
				{
					massiveApiKey: 'massive-secret',
					fetch: massiveFetcher(),
					now: () => NOW
				}
			)
		).resolves.toMatchObject({
			status: 'imported',
			issuerCount: 1,
			includedCount: 1,
			listingCount: 1
		});
		await expect(getResearchCoverage()).resolves.toMatchObject({
			included: 1,
			pending: 0,
			ready: 1
		});
		await expect(
			syncMassiveUniverse(
				firstAuth!,
				{ asOf: '2026-07-27' },
				{
					massiveApiKey: 'massive-secret',
					fetch: massiveFetcher(),
					now: () => NOW
				}
			)
		).resolves.toMatchObject({
			status: 'unchanged',
			issuerCount: 1,
			includedCount: 1,
			listingCount: 1
		});
		await expect(getResearchCoverage()).resolves.toMatchObject({
			included: 1,
			pending: 0,
			ready: 1
		});

		await deleteMcpApiKey(first.id);
		await expect(authenticateMcpApiKey(`Bearer ${first.token}`, NOW)).resolves.toBeNull();
		await expect(authenticateMcpApiKey(`Bearer ${second.token}`, NOW)).resolves.toMatchObject({
			id: second.id
		});
		const [deletedKeyCount] = await cleanup<Array<{ count: number }>>`
			select count(*)::int as count from mcp_api_key where id = ${first.id}
		`;
		expect(deletedKeyCount?.count).toBe(0);
		const [preservedSnapshot] = await cleanup<Array<{ submittedByApiKeyId: string | null }>>`
			select submitted_by_api_key_id as "submittedByApiKeyId"
			from research_snapshot
			where source = ${`executive_profile:${issuerRecord.issuerKey}`}
		`;
		expect(preservedSnapshot?.submittedByApiKeyId).toBeNull();
	});
});

function issuer(): NormalizedIssuer {
	return {
		issuerKey: 'alias:example-corporation',
		cik: null,
		name: 'Example Corporation',
		description: 'Example Corporation makes durable products.',
		homepageUrl: 'https://example.com',
		sicCode: '3571',
		sicDescription: 'Electronic Computers',
		canonicalTicker: 'EXMP',
		marketCap: 39_136_594_480.08,
		included: true,
		exclusionReason: null,
		listings: [
			{
				ticker: 'EXMP',
				name: 'Example Corporation',
				primaryExchange: 'XNAS',
				type: 'CS',
				active: true,
				compositeFigi: 'BBGEXMP',
				shareClassFigi: 'BBGEXMPSHARE',
				marketCap: 39_136_594_480.08,
				lastUpdatedAt: '2026-07-26T10:00:00Z',
				isCanonical: true
			}
		]
	};
}

function massiveFetcher(): typeof fetch {
	return vi.fn(async (input) => {
		const url = new URL(String(input));
		const base = {
			active: true,
			locale: 'us',
			market: 'stocks',
			name: 'Example Corporation',
			primary_exchange: 'XNAS',
			ticker: 'EXMP',
			type: 'CS'
		};
		if (url.pathname === '/v3/reference/tickers') {
			return Response.json({
				status: 'OK',
				request_id: 'list-request',
				results: [base]
			});
		}
		if (url.pathname === '/v3/reference/tickers/EXMP') {
			return Response.json({
				status: 'OK',
				request_id: 'detail-request',
				results: {
					...base,
					composite_figi: 'BBGEXMP',
					description: 'Example Corporation makes durable products.',
					homepage_url: 'https://example.com',
					last_updated_utc: '2026-07-26T10:00:00Z',
					market_cap: 39_136_594_480.08,
					share_class_figi: 'BBGEXMPSHARE',
					sic_code: '3571',
					sic_description: 'Electronic Computers'
				}
			});
		}
		return new Response('Not found', { status: 404 });
	}) as typeof fetch;
}

function executiveProfile(issuerRecord: NormalizedIssuer): ExecutiveProfile {
	const source = {
		url: 'https://example.com/leadership',
		title: 'Example Corporation leadership',
		publisher: 'Example Corporation',
		retrieved_at: '2026-07-26',
		kind: 'official_company' as const
	};
	return {
		schema_version: 2,
		issuer_key: issuerRecord.issuerKey,
		canonical_ticker: issuerRecord.canonicalTicker,
		company_name: issuerRecord.name,
		leadership_as_of: '2026-07-26',
		leaders: [
			{
				name: 'Alex Example',
				title: 'Chief Executive Officer',
				role_kind: 'ceo',
				is_interim: false,
				summary: Array.from({ length: 84 }, (_, index) => `Biography${index + 1}`).join(' '),
				summary_sources: [source],
				role_source: source,
				portraits: [
					{
						image_url: 'https://93.184.216.34/portrait.png',
						alt_text: 'Portrait of Alex Example',
						is_real_person: true,
						source
					}
				],
				facts: [
					{
						category: 'education',
						value: 'Alex Example completed a university degree.',
						sources: [source]
					}
				]
			}
		]
	};
}

function reviewArtifact(issuerRecord: NormalizedIssuer) {
	return {
		schema_version: 2 as const,
		status: 'needs_review' as const,
		issuer_key: issuerRecord.issuerKey,
		canonical_ticker: issuerRecord.canonicalTicker,
		company_name: issuerRecord.name,
		reasons: ['The official role source needs a second review.'],
		candidate_sources: []
	};
}
