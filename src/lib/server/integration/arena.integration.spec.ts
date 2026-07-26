import sharp from 'sharp';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExecutiveProfile } from '../../research/schemas';
import { createNormalizedUniverseSnapshot, type NormalizedIssuer } from '../../research/universe';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('database-backed arena lifecycle', () => {
	const cleanup = postgres(databaseUrl!, { max: 1 });
	let portraitBytes: Buffer;
	let secondaryPortraitBytes: Buffer;
	let tertiaryPortraitBytes: Buffer;

	beforeAll(async () => {
		await cleanup.unsafe(`
			truncate table
				app_session,
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
				research_snapshot,
				oidc_transaction
			restart identity cascade
		`);
		portraitBytes = await sharp({
			create: {
				width: 320,
				height: 320,
				channels: 3,
				background: { r: 44, g: 104, b: 79 }
			}
		})
			.png()
			.toBuffer();
		secondaryPortraitBytes = await sharp({
			create: {
				width: 320,
				height: 320,
				channels: 3,
				background: { r: 96, g: 70, b: 139 }
			}
		})
			.png()
			.toBuffer();
		tertiaryPortraitBytes = await sharp({
			create: {
				width: 320,
				height: 320,
				channels: 3,
				background: { r: 176, g: 112, b: 48 }
			}
		})
			.png()
			.toBuffer();
	});

	afterAll(async () => {
		vi.unstubAllGlobals();
		await cleanup.end();
	});

	it('imports, freezes, compares, revisions, and excludes without stale votes', async () => {
		const { connectResearchDatabase, createDatabaseResearchImportService } =
			await import('../research-import');
		const { persistActiveRanking } = await import('../ranking/persistence');
		const connection = connectResearchDatabase(databaseUrl!);
		const importer = createDatabaseResearchImportService(connection.database, {
			fetchPortrait: async (url) => {
				const image = String(url).includes('portrait-2')
					? secondaryPortraitBytes
					: String(url).includes('portrait-3')
						? tertiaryPortraitBytes
						: portraitBytes;
				return new Response(Uint8Array.from(image).buffer, {
					status: 200,
					headers: { 'content-type': 'image/png' }
				});
			},
			resolvePortraitAddresses: async () => ['93.184.216.34']
		});

		try {
			const alfa = issuer('cik:0000000001', 'ALFA', 'Alfa Corporation', 2_000_000_000);
			alfa.listings.push({
				...alfa.listings[0]!,
				ticker: 'ALFA.B',
				compositeFigi: 'BBGALFA.B',
				shareClassFigi: 'BBGALFA.BSHARE',
				marketCap: 500_000_000,
				isCanonical: false
			});
			const universe = [alfa, issuer('cik:0000000002', 'BETA', 'Beta Corporation', 1_000_000_000)];
			const universeResult = await importer.importUniverse(universeSnapshot(universe));
			expect(universeResult.includedCount).toBe(2);

			const incompleteSnapshot = [{ ...alfa, listings: [alfa.listings[0]!] }];
			const reconciled = await importer.importUniverse(universeSnapshot(incompleteSnapshot));
			expect(reconciled).toMatchObject({
				issuerCount: 1,
				includedCount: 1,
				listingCount: 1
			});
			const reconciledRows = await cleanup<
				Array<{
					issuerKey: string;
					included: boolean;
					readinessStatus: string;
					exclusionReason: string | null;
					ticker: string;
					active: boolean;
					isCanonical: boolean;
				}>
			>`
				select
					c.issuer_key as "issuerKey",
					c.included,
					c.readiness_status as "readinessStatus",
					c.exclusion_reason as "exclusionReason",
					sl.ticker,
					sl.active,
					sl.is_canonical as "isCanonical"
				from company c
				join security_listing sl on sl.company_id = c.id
				order by c.issuer_key, sl.ticker
			`;
			expect(reconciledRows).toEqual([
				{
					issuerKey: 'cik:0000000001',
					included: true,
					readinessStatus: 'pending',
					exclusionReason: null,
					ticker: 'ALFA',
					active: true,
					isCanonical: true
				},
				{
					issuerKey: 'cik:0000000001',
					included: true,
					readinessStatus: 'pending',
					exclusionReason: null,
					ticker: 'ALFA.B',
					active: false,
					isCanonical: false
				},
				{
					issuerKey: 'cik:0000000002',
					included: false,
					readinessStatus: 'excluded',
					exclusionReason: 'absent_from_latest_universe',
					ticker: 'BETA',
					active: false,
					isCanonical: false
				}
			]);

			const restored = await importer.importUniverse(universeSnapshot(universe));
			expect(restored).toMatchObject({
				issuerCount: 2,
				includedCount: 2,
				listingCount: 3
			});
			const restoredRows = await cleanup<
				Array<{
					issuerKey: string;
					included: boolean;
					readinessStatus: string;
					exclusionReason: string | null;
					ticker: string;
					active: boolean;
					isCanonical: boolean;
				}>
			>`
				select
					c.issuer_key as "issuerKey",
					c.included,
					c.readiness_status as "readinessStatus",
					c.exclusion_reason as "exclusionReason",
					sl.ticker,
					sl.active,
					sl.is_canonical as "isCanonical"
				from company c
				join security_listing sl on sl.company_id = c.id
				order by c.issuer_key, sl.ticker
			`;
			expect(restoredRows).toEqual([
				{
					issuerKey: 'cik:0000000001',
					included: true,
					readinessStatus: 'pending',
					exclusionReason: null,
					ticker: 'ALFA',
					active: true,
					isCanonical: true
				},
				{
					issuerKey: 'cik:0000000001',
					included: true,
					readinessStatus: 'pending',
					exclusionReason: null,
					ticker: 'ALFA.B',
					active: true,
					isCanonical: false
				},
				{
					issuerKey: 'cik:0000000002',
					included: true,
					readinessStatus: 'pending',
					exclusionReason: null,
					ticker: 'BETA',
					active: true,
					isCanonical: true
				}
			]);

			const staleProfile = profile(universe[0]!, 'Stale Alpha', 'https://example.com/stale-alfa');
			staleProfile.leadership_as_of = '2026-07-25';
			await expect(importer.importProfiles([staleProfile])).rejects.toThrow(
				'predates the Massive universe snapshot'
			);

			const firstProfiles = [
				profile(universe[0]!, 'Ada Alpha', 'https://example.com/alfa'),
				profile(universe[1]!, 'Ben Beta', 'https://example.com/beta')
			];
			const imported = await importer.importProfiles(firstProfiles);
			expect(imported.profiles.map((item) => item.action)).toEqual(['created', 'created']);
			const conflictingSource = profile(universe[1]!, 'Ben Beta', 'https://example.com/beta');
			conflictingSource.leaders[0]!.facts[0]!.sources = [
				{
					...conflictingSource.leaders[0]!.facts[0]!.sources[0]!,
					url: 'https://example.com/alfa/leadership',
					kind: 'reputable_news'
				}
			];
			await expect(importer.importProfiles([conflictingSource])).rejects.toThrow(
				'previously classified as official_company'
			);

			const frozen = await importer.freeze();
			expect(frozen).toMatchObject({ includedCount: 2, revision: 1, alreadyFrozen: false });
			await persistActiveRanking(connection.database);

			const { getOrCreatePair, recordChoice, refitActiveRanking } =
				await import('../arena/service');
			const { createCompanyWithProfile, excludeCompany } = await import('../arena/admin-service');
			const { getCompanyCard, getLeaderboard, getReadinessSummary } =
				await import('../arena/read-model');
			const presentationNow = new Date();
			const concurrentPairs = await Promise.all(
				Array.from({ length: 8 }, () => getOrCreatePair(presentationNow))
			);
			const readyPairs = concurrentPairs.map((candidate) => {
				expect(candidate.kind).toBe('ready');
				if (candidate.kind !== 'ready') throw new Error('Expected a comparison pair');
				return candidate;
			});
			const pair = readyPairs[0]!;
			expect(new Set(readyPairs.map((candidate) => candidate.presentationId))).toEqual(
				new Set([pair.presentationId])
			);
			expect(
				new Set(
					readyPairs.map((candidate) => candidate.cards.map((card) => card.slateId).join(':'))
				)
			).toEqual(new Set([pair.cards.map((card) => card.slateId).join(':')]));
			const [{ presentationCount, openPresentationCount }] = await cleanup<
				Array<{ presentationCount: number; openPresentationCount: number }>
			>`
				select
					count(*)::int as "presentationCount",
					count(*) filter (where consumed_at is null)::int as "openPresentationCount"
				from pair_presentation
			`;
			expect({ presentationCount, openPresentationCount }).toEqual({
				presentationCount: 1,
				openPresentationCount: 1
			});
			await recordChoice(pair.presentationId, pair.cards[0].slateId);
			await refitActiveRanking();

			const ranked = await getLeaderboard({
				q: '',
				page: 1,
				pageSize: 50,
				sort: 'rank',
				direction: 'asc'
			});
			expect(ranked.total).toBe(2);
			expect(ranked.rows[0]).toMatchObject({
				slateId: pair.cards[0].slateId,
				rank: 1,
				wins: 1,
				comparisonCount: 1
			});

			const contentUpdate = profile(
				universe[0]!,
				'Ada Alpha',
				'https://example.com/alfa',
				'updated'
			);
			const primaryPortrait = contentUpdate.leaders[0]!.portraits[0]!;
			contentUpdate.leaders[0]!.portraits.push(
				{ ...primaryPortrait, image_url: 'https://example.com/alfa/portrait-2.png' },
				{ ...primaryPortrait, image_url: 'https://example.com/alfa/portrait-3.png' }
			);
			const updated = await importer.importProfiles([contentUpdate]);
			expect(updated.profiles[0]).toMatchObject({
				action: 'updated',
				slateId: imported.profiles[0]!.slateId,
				cohortRevision: null
			});
			const updatedCard = await getCompanyCard(updated.profiles[0]!.companyId);
			expect(updatedCard?.leaders[0]?.portraits.map(({ imageUrl }) => imageUrl)).toEqual([
				'https://example.com/alfa/portrait.png',
				'https://example.com/alfa/portrait-2.png',
				'https://example.com/alfa/portrait-3.png'
			]);

			const replacement = profile(universe[1]!, 'Bea Beta', 'https://example.com/beta-replacement');
			const replaced = await importer.importProfiles([replacement]);
			expect(replaced.profiles[0]).toMatchObject({
				action: 'replaced',
				slateVersion: 2,
				cohortRevision: 2
			});
			await persistActiveRanking(connection.database);

			const revisedSummary = await getReadinessSummary();
			expect(revisedSummary).toMatchObject({
				revision: 2,
				comparisons: 0,
				coveredCompanies: 0
			});

			await excludeCompany(replaced.profiles[0]!.companyId, 'Issuer removed during lifecycle test');
			const excludedSummary = await getReadinessSummary();
			expect(excludedSummary).toMatchObject({
				total: 1,
				ready: 1,
				revision: 3,
				comparisons: 0
			});
			const [{ count }] = await cleanup<
				Array<{ count: number }>
			>`select count(*)::int as count from portrait po join leadership_member lm on lm.person_id = po.person_id join leadership_slate ls on ls.id = lm.slate_id where ls.company_id = ${replaced.profiles[0]!.companyId}`;
			expect(count).toBe(0);

			const addedIssuer = issuer('cik:0000000003', 'GAMM', 'Gamma Corporation', 750_000_000);
			vi.stubGlobal(
				'fetch',
				async () =>
					new Response(Uint8Array.from(portraitBytes).buffer, {
						status: 200,
						headers: { 'content-type': 'image/png' }
					})
			);
			const added = await createCompanyWithProfile(
				{
					issuerKey: addedIssuer.issuerKey,
					cik: addedIssuer.cik,
					name: addedIssuer.name,
					description: addedIssuer.description,
					homepageUrl: addedIssuer.homepageUrl,
					canonicalTicker: addedIssuer.canonicalTicker,
					primaryExchange: 'XNAS',
					marketCap: addedIssuer.marketCap
				},
				profile(addedIssuer, 'Gia Gamma', 'https://example.com/gamma')
			);
			vi.unstubAllGlobals();
			expect(added.companyId).toBeTruthy();
			expect(await getReadinessSummary()).toMatchObject({
				total: 2,
				ready: 2,
				revision: 4
			});
		} finally {
			await connection.close();
		}
	});
});

function issuer(
	issuerKey: string,
	ticker: string,
	name: string,
	marketCap: number
): NormalizedIssuer {
	return {
		issuerKey,
		cik: issuerKey.slice(4),
		name,
		description: `${name} makes durable products for its customers.`,
		homepageUrl: `https://example.com/${ticker.toLowerCase()}`,
		sicCode: '3571',
		sicDescription: 'Electronic Computers',
		canonicalTicker: ticker,
		marketCap,
		included: true,
		exclusionReason: null,
		listings: [
			{
				ticker,
				name,
				primaryExchange: 'XNAS',
				type: 'CS',
				active: true,
				compositeFigi: `BBG${ticker}`,
				shareClassFigi: `BBG${ticker}SHARE`,
				marketCap,
				lastUpdatedAt: '2026-07-26T10:00:00Z',
				isCanonical: true
			}
		]
	};
}

function universeSnapshot(issuers: NormalizedIssuer[]) {
	return createNormalizedUniverseSnapshot(
		issuers,
		'2026-07-26',
		new Date('2026-07-26T12:00:00.000Z')
	);
}

function profile(
	issuerRecord: NormalizedIssuer,
	leaderName: string,
	sourceRoot: string,
	summarySuffix = ''
): ExecutiveProfile {
	const source = {
		url: `${sourceRoot}/leadership`,
		title: `${issuerRecord.name} leadership`,
		publisher: issuerRecord.name,
		retrieved_at: '2026-07-26',
		kind: 'official_company' as const
	};
	const summary = Array.from(
		{ length: 84 },
		(_, index) => `${leaderName.split(' ')[0]}${index + 1}`
	).join(' ');
	return {
		schema_version: 2,
		issuer_key: issuerRecord.issuerKey,
		canonical_ticker: issuerRecord.canonicalTicker,
		company_name: issuerRecord.name,
		leadership_as_of: '2026-07-26',
		leaders: [
			{
				name: leaderName,
				title: 'Chief Executive Officer',
				role_kind: 'ceo',
				is_interim: false,
				summary: `${summary} ${summarySuffix}`.trim(),
				summary_sources: [source],
				role_source: source,
				portraits: [
					{
						image_url: `${sourceRoot}/portrait.png`,
						alt_text: `Portrait of ${leaderName}`,
						is_real_person: true,
						source
					}
				],
				facts: [
					{
						category: 'education',
						value: `${leaderName} completed a university degree.`,
						sources: [source]
					}
				]
			}
		]
	};
}
