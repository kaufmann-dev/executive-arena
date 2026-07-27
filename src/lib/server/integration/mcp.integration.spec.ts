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
	let secondPortraitBytes: Buffer;

	beforeAll(async () => {
		await cleanup.unsafe(`
			truncate table
				massive_ticker_checkpoint,
				massive_universe_sync,
				reviewed_issuer_alias,
				executive_research_claim,
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
		secondPortraitBytes = await sharp({
			create: {
				width: 240,
				height: 300,
				channels: 3,
				background: { r: 93, g: 28, b: 71 }
			}
		})
			.png()
			.toBuffer();
	});

	afterAll(async () => {
		vi.unstubAllGlobals();
		await cleanup.end();
	});

	it('supports independent keys, publishing, attribution, readiness, and deletion', async () => {
		const { authenticateMcpApiKey, createMcpApiKey, deleteMcpApiKey } =
			await import('../mcp/api-keys');
		const { syncMassiveUniverse } = await import('../mcp/massive-sync-service');
		const {
			claimCompanies,
			getCompanyProfile,
			getCohortStatus,
			listCompanies,
			publishExecutiveProfile,
			releaseCompanyClaim,
			renewCompanyClaim
		} = await import('../mcp/research-service');
		const { excludeCompany, importCompanyProfile } = await import('../arena/admin-service');
		const { createCompanyClaimToken, hashCompanyClaimToken } = await import('../research-claims');
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
		await expect(getCohortStatus(NOW)).resolves.toMatchObject({
			included: 1,
			notReady: 1,
			ready: 0,
			universeAsOf: '2026-07-26',
			cohortRevision: 1,
			cohortFrozenAt: null
		});
		await expect(
			listCompanies({
				status: 'not_ready',
				limit: 20
			})
		).resolves.toMatchObject({
			items: [
				expect.objectContaining({
					issuerKey: issuerRecord.issuerKey,
					included: true
				})
			],
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
		const validClaimProfile = executiveProfile(issuerRecord);
		const [firstClaim] = (await claimCompanies(firstAuth!, { limit: 1 }, NOW)).claims;
		expect(firstClaim).toMatchObject({
			companyId: storedCompany!.id,
			claimToken: expect.stringMatching(/^eac_[A-Za-z0-9_-]{43}$/),
			claimedAt: NOW.toISOString(),
			expiresAt: '2026-07-26T12:45:00.000Z',
			task: {
				company: {
					companyId: storedCompany!.id,
					status: 'not_ready',
					claim: { expiresAt: '2026-07-26T12:45:00.000Z' }
				}
			}
		});
		const [storedClaim] = await cleanup<Array<{ tokenHash: string }>>`
			select token_hash as "tokenHash"
			from executive_research_claim
			where company_id = ${storedCompany!.id}
		`;
		expect(storedClaim?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
		expect(storedClaim?.tokenHash).not.toBe(firstClaim!.claimToken);
		await expect(getCohortStatus(NOW)).resolves.toMatchObject({
			notReady: 1,
			claimed: 1,
			available: 0
		});
		await expect(listCompanies({ status: 'not_ready', limit: 20 }, NOW)).resolves.toMatchObject({
			items: [
				expect.objectContaining({
					companyId: storedCompany!.id,
					claim: { expiresAt: '2026-07-26T12:45:00.000Z' }
				})
			]
		});
		await expect(
			publishExecutiveProfile(firstAuth!, storedCompany!.id, validClaimProfile, NOW)
		).rejects.toMatchObject({ code: 'claim_required' });
		await expect(
			publishExecutiveProfile(
				firstAuth!,
				storedCompany!.id,
				validClaimProfile,
				NOW,
				`eac_${'x'.repeat(43)}`
			)
		).rejects.toMatchObject({ code: 'claim_token_invalid' });
		await expect(
			releaseCompanyClaim(storedCompany!.id, firstClaim!.claimToken, NOW)
		).resolves.toEqual({ companyId: storedCompany!.id, released: true });
		await expect(
			releaseCompanyClaim(storedCompany!.id, firstClaim!.claimToken, NOW)
		).resolves.toEqual({ companyId: storedCompany!.id, released: false });
		await expect(getCohortStatus(NOW)).resolves.toMatchObject({
			claimed: 0,
			available: 1
		});

		const [renewedClaim] = (await claimCompanies(secondAuth!, { limit: 1 }, NOW)).claims;
		const renewalTime = new Date('2026-07-26T12:05:00.000Z');
		await expect(
			renewCompanyClaim(storedCompany!.id, renewedClaim!.claimToken, renewalTime)
		).resolves.toEqual({
			companyId: storedCompany!.id,
			expiresAt: '2026-07-26T12:50:00.000Z'
		});
		const expiredAt = new Date('2026-07-26T12:51:00.000Z');
		await expect(
			renewCompanyClaim(storedCompany!.id, renewedClaim!.claimToken, expiredAt)
		).rejects.toMatchObject({ code: 'claim_expired' });
		await expect(
			publishExecutiveProfile(
				firstAuth!,
				storedCompany!.id,
				validClaimProfile,
				expiredAt,
				renewedClaim!.claimToken
			)
		).rejects.toMatchObject({ code: 'claim_expired' });
		await expect(
			releaseCompanyClaim(storedCompany!.id, renewedClaim!.claimToken, expiredAt)
		).resolves.toEqual({ companyId: storedCompany!.id, released: false });

		const [publicationClaim] = (await claimCompanies(secondAuth!, { limit: 1 }, expiredAt)).claims;
		const rejectedProfile = executiveProfile(issuerRecord);
		rejectedProfile.leaders[0]!.portraits = [];
		const portraitDiagnostic = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await expect(
			publishExecutiveProfile(
				firstAuth!,
				storedCompany!.id,
				rejectedProfile,
				expiredAt,
				publicationClaim!.claimToken
			)
		).rejects.toMatchObject({ code: 'portrait_missing' });
		expect(portraitDiagnostic).toHaveBeenCalledWith(
			expect.stringContaining('"code":"portrait_missing"')
		);
		portraitDiagnostic.mockRestore();
		await expect(getCohortStatus(expiredAt)).resolves.toMatchObject({
			included: 1,
			notReady: 1,
			ready: 0,
			claimed: 1,
			available: 0
		});

		vi.stubGlobal(
			'fetch',
			vi.fn(async (input) => {
				const data = String(input).includes('portrait-2.png') ? secondPortraitBytes : portraitBytes;
				return new Response(Uint8Array.from(data).buffer, { status: 200 });
			})
		);
		const profile = executiveProfile(issuerRecord);
		profile.leaders[0]!.portraits.push({
			...profile.leaders[0]!.portraits[0]!,
			image_url: 'https://93.184.216.34/portrait-2.png',
			source: {
				url: 'https://news.example.com/alex-example',
				title: 'Alex Example biography',
				publisher: 'Example News',
				retrieved_at: '2026-07-26'
			}
		});
		await expect(
			publishExecutiveProfile(
				firstAuth!,
				storedCompany!.id,
				profile,
				expiredAt,
				publicationClaim!.claimToken,
				() => new Date('2026-07-26T13:37:00.000Z')
			)
		).rejects.toMatchObject({ code: 'claim_expired' });
		const [portraitCountAfterExpiredPublish] = await cleanup<Array<{ count: number }>>`
			select count(*)::int as count from portrait
		`;
		expect(portraitCountAfterExpiredPublish?.count).toBe(0);
		const published = await publishExecutiveProfile(
			firstAuth!,
			storedCompany!.id,
			profile,
			expiredAt,
			publicationClaim!.claimToken,
			() => expiredAt
		);
		expect(published.action).toBe('created');
		const [claimCountAfterPublish] = await cleanup<Array<{ count: number }>>`
			select count(*)::int as count from executive_research_claim
		`;
		expect(claimCountAfterPublish?.count).toBe(0);
		await expect(
			publishExecutiveProfile(firstAuth!, storedCompany!.id, profile, expiredAt)
		).resolves.toMatchObject({ action: 'unchanged', slateId: published.slateId });

		const adminClaimToken = createCompanyClaimToken();
		await cleanup`
			insert into executive_research_claim (
				company_id,
				token_hash,
				claimed_by_api_key_id,
				claimed_at,
				expires_at
			) values (
				${storedCompany!.id},
				${hashCompanyClaimToken(adminClaimToken)},
				${second.id},
				${expiredAt},
				${new Date('2026-07-26T13:36:00.000Z')}
			)
		`;
		await expect(
			importCompanyProfile(storedCompany!.id, profile, { now: expiredAt })
		).resolves.toMatchObject({
			companyId: storedCompany!.id
		});
		const [claimCountAfterAdminPublish] = await cleanup<Array<{ count: number }>>`
			select count(*)::int as count from executive_research_claim
		`;
		expect(claimCountAfterAdminPublish?.count).toBe(0);

		const [snapshot] = await cleanup<Array<{ submittedByApiKeyId: string; payloadHash: string }>>`
			select
				submitted_by_api_key_id as "submittedByApiKeyId",
				payload_hash as "payloadHash"
			from research_snapshot
			where source = ${`executive_profile:${issuerRecord.issuerKey}`}
				and submitted_by_api_key_id is not null
			limit 1
		`;
		expect(snapshot).toMatchObject({
			submittedByApiKeyId: first.id,
			payloadHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
		});
		await expect(getCompanyProfile(storedCompany!.id)).resolves.toMatchObject({
			company: {
				companyId: storedCompany!.id,
				status: 'ready'
			},
			universeAsOf: '2026-07-26',
			currentProfile: {
				issuer_key: issuerRecord.issuerKey,
				leaders: [
					expect.objectContaining({
						portraits: [expect.any(Object), expect.any(Object)]
					})
				]
			}
		});
		const [storedPortraits] = await cleanup<Array<{ count: number }>>`
			select count(*)::int as count from portrait
		`;
		expect(storedPortraits?.count).toBe(2);

		const [directCompany] = await cleanup<Array<{ id: string }>>`
			insert into company (
				issuer_key,
				name,
				description,
				canonical_ticker,
				included,
				cohort_order
			) values ('alias:direct-publication', 'Direct Publication', '', 'DIR', true, 2)
			returning id
		`;
		const directProfile = structuredClone(profile);
		directProfile.issuer_key = 'alias:direct-publication';
		directProfile.canonical_ticker = 'DIR';
		directProfile.company_name = 'Direct Publication';
		await expect(
			publishExecutiveProfile(firstAuth!, directCompany!.id, directProfile, expiredAt)
		).resolves.toMatchObject({ action: 'created', companyId: directCompany!.id });

		const extraCompanies = await cleanup<Array<{ id: string }>>`
			insert into company (
				issuer_key,
				name,
				description,
				canonical_ticker,
				included,
				cohort_order
			) values
				('alias:queue-second', 'Queue Second', '', 'QUE2', true, 3),
				('alias:queue-third', 'Queue Third', '', 'QUE3', true, 4)
			returning id
		`;
		const [parallelFirst, parallelSecond] = await Promise.all([
			claimCompanies(firstAuth!, { limit: 1 }, expiredAt),
			claimCompanies(secondAuth!, { limit: 1 }, expiredAt)
		]);
		const parallelClaims = [...parallelFirst.claims, ...parallelSecond.claims];
		expect(parallelClaims).toHaveLength(2);
		expect(new Set(parallelClaims.map((claim) => claim.companyId)).size).toBe(2);
		expect(new Set(parallelClaims.map((claim) => claim.companyId))).toEqual(
			new Set(extraCompanies.map((company) => company.id))
		);
		const excludedClaim = parallelClaims[0]!;
		await excludeCompany(excludedClaim.companyId, 'Queue exclusion test', expiredAt);
		const [excludedClaimCount] = await cleanup<Array<{ count: number }>>`
			select count(*)::int as count
			from executive_research_claim
			where company_id = ${excludedClaim.companyId}
		`;
		expect(excludedClaimCount?.count).toBe(0);
		const releasedClaim = parallelClaims[1]!;
		await expect(
			releaseCompanyClaim(releasedClaim.companyId, releasedClaim.claimToken, expiredAt)
		).resolves.toMatchObject({ released: true });

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
		await expect(getCohortStatus()).resolves.toMatchObject({
			included: 1,
			notReady: 0,
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
		await expect(getCohortStatus()).resolves.toMatchObject({
			included: 1,
			notReady: 0,
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
		retrieved_at: '2026-07-26'
	};
	return {
		schema_version: 3,
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
