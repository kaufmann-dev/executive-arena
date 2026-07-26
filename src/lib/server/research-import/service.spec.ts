import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutiveProfile, ResearchSource } from '../../research/schemas';
import { createNormalizedUniverseSnapshot } from '../../research/universe';
import {
	createResearchImportService,
	inspectFreezeReadiness,
	leadershipMembershipMatches,
	MAX_PROFILE_IMPORT_BATCH_SIZE
} from './service';
import type { FreezeReadinessRow, ResearchImportRepository } from './types';

const NOW = new Date('2026-07-26T12:00:00.000Z');
const SEED = 'ab'.repeat(32);
const officialSource: ResearchSource = {
	url: 'https://example.com/leadership',
	title: 'Leadership',
	publisher: 'Example Company',
	retrieved_at: '2026-07-26',
	kind: 'official_company'
};

describe('research import service', () => {
	it('validates and transforms every portrait before one repository batch write', async () => {
		const inputImage = await portraitImage();
		const fetchPortrait = vi.fn(async () => new Response(inputImage, { status: 200 }));
		const writeProfiles = vi.fn<ResearchImportRepository['writeProfiles']>(
			async (profiles, context) => ({
				profiles: profiles.map(({ profile }, index) => ({
					issuerKey: profile.issuer_key,
					companyId: `company-${index}`,
					slateId: `slate-${index}`,
					slateVersion: 1,
					action: 'created',
					cohortRevision: null
				})),
				importedAt: context.importedAt
			})
		);
		const service = createResearchImportService(fakeRepository({ writeProfiles }), {
			fetchPortrait,
			now: () => NOW,
			pairingSeed: () => SEED,
			portraitConcurrency: 2
		});
		const profiles = [validProfile(1), validProfile(2)];

		const result = await service.importProfiles(profiles);

		expect(result.profiles).toHaveLength(2);
		expect(fetchPortrait).toHaveBeenCalledTimes(2);
		expect(writeProfiles).toHaveBeenCalledTimes(1);
		const prepared = writeProfiles.mock.calls[0]![0];
		expect(prepared).toHaveLength(2);
		expect(prepared[0]!.portraits[0]!.portrait).toMatchObject({
			contentType: 'image/webp',
			width: 240,
			height: 300
		});
		expect(prepared[0]!.portraits[0]!.portrait.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(writeProfiles.mock.calls[0]![1]).toEqual({
			importedAt: NOW,
			pairingSeed: SEED
		});
	});

	it('does not start a repository write when any portrait in the batch fails', async () => {
		const inputImage = await portraitImage();
		const fetchPortrait = vi
			.fn()
			.mockResolvedValueOnce(new Response(inputImage, { status: 200 }))
			.mockResolvedValueOnce(new Response(null, { status: 404 }));
		const writeProfiles = vi.fn<ResearchImportRepository['writeProfiles']>();
		const service = createResearchImportService(fakeRepository({ writeProfiles }), {
			fetchPortrait,
			now: () => NOW,
			pairingSeed: () => SEED,
			portraitConcurrency: 1
		});

		await expect(service.importProfiles([validProfile(1), validProfile(2)])).rejects.toThrow(
			'HTTP 404'
		);
		expect(writeProfiles).not.toHaveBeenCalled();
	});

	it('rejects duplicate issuers before downloading portraits', async () => {
		const fetchPortrait = vi.fn();
		const writeProfiles = vi.fn<ResearchImportRepository['writeProfiles']>();
		const service = createResearchImportService(fakeRepository({ writeProfiles }), {
			fetchPortrait,
			pairingSeed: () => SEED
		});
		const profile = validProfile(1);

		await expect(service.importProfiles([profile, profile])).rejects.toThrow(
			'duplicate issuer_key'
		);
		expect(fetchPortrait).not.toHaveBeenCalled();
		expect(writeProfiles).not.toHaveBeenCalled();
	});

	it('rejects an oversized profile batch before validation or portrait downloads', async () => {
		const fetchPortrait = vi.fn();
		const writeProfiles = vi.fn<ResearchImportRepository['writeProfiles']>();
		const service = createResearchImportService(fakeRepository({ writeProfiles }), {
			fetchPortrait,
			pairingSeed: () => SEED
		});
		const profiles = Array.from({ length: MAX_PROFILE_IMPORT_BATCH_SIZE + 1 }, (_, index) =>
			validProfile(index + 1)
		);

		await expect(service.importProfiles(profiles)).rejects.toThrow(
			`limited to ${MAX_PROFILE_IMPORT_BATCH_SIZE} profiles per batch`
		);
		expect(fetchPortrait).not.toHaveBeenCalled();
		expect(writeProfiles).not.toHaveBeenCalled();
	});

	it('delegates a validated normalized universe as one write', async () => {
		const writeUniverse = vi.fn<ResearchImportRepository['writeUniverse']>(
			async (universe, context) => ({
				issuerCount: universe.length,
				includedCount: 1,
				excludedCount: 0,
				listingCount: 1,
				importedAt: context.importedAt
			})
		);
		const service = createResearchImportService(fakeRepository({ writeUniverse }), {
			now: () => NOW
		});

		await expect(service.importUniverse(validUniverse())).resolves.toMatchObject({
			issuerCount: 1,
			listingCount: 1
		});
		expect(writeUniverse).toHaveBeenCalledTimes(1);
		expect(writeUniverse.mock.calls[0]![1]).toMatchObject({
			importedAt: NOW,
			asOf: new Date('2026-07-26T00:00:00.000Z'),
			snapshot: { provider: 'massive', asOf: '2026-07-26', issuerCount: 1 }
		});
	});

	it('rejects internally inconsistent normalized-universe input before writing', async () => {
		const writeUniverse = vi.fn<ResearchImportRepository['writeUniverse']>();
		const service = createResearchImportService(fakeRepository({ writeUniverse }));
		const valid = validUniverse();
		const universe = createNormalizedUniverseSnapshot(
			[...valid.issuers, structuredClone(valid.issuers[0]!)],
			valid.asOf,
			NOW
		);

		await expect(service.importUniverse(universe)).rejects.toThrow('duplicate issuerKey');
		expect(writeUniverse).not.toHaveBeenCalled();
	});

	it('passes a cryptographic seed and timestamp to cohort freeze', async () => {
		const freeze = vi.fn<ResearchImportRepository['freeze']>(async (context) => ({
			includedCount: 2,
			revision: 1,
			pairingSeed: context.pairingSeed,
			frozenAt: context.frozenAt,
			alreadyFrozen: false
		}));
		const service = createResearchImportService(fakeRepository({ freeze }), {
			now: () => NOW,
			pairingSeed: () => SEED
		});

		await expect(service.freeze()).resolves.toMatchObject({
			pairingSeed: SEED,
			frozenAt: NOW
		});
		expect(freeze).toHaveBeenCalledWith({ frozenAt: NOW, pairingSeed: SEED });
	});
});

describe('leadership membership comparison', () => {
	it('ignores member order but rejects additions, removals, and replacements', () => {
		expect(leadershipMembershipMatches(['person-a', 'person-b'], ['person-b', 'person-a'])).toBe(
			true
		);
		expect(leadershipMembershipMatches(['person-a'], ['person-a', 'person-b'])).toBe(false);
		expect(leadershipMembershipMatches(['person-a'], ['person-b'])).toBe(false);
	});
});

describe('freeze readiness inspection', () => {
	it('accepts complete sourced members and reports every missing integrity requirement', () => {
		const complete = readinessRow({ issuerKey: 'issuer:one', companyName: 'One' });

		expect(inspectFreezeReadiness([complete])).toEqual([]);

		const issues = inspectFreezeReadiness([
			readinessRow({
				issuerKey: 'issuer:broken',
				companyName: 'Broken',
				readinessStatus: 'pending',
				portraitId: null,
				summarySourceCount: 0,
				roleSourceCount: 0,
				factCount: 2,
				citedFactCount: 1
			}),
			readinessRow({
				issuerKey: 'issuer:empty',
				companyName: 'Empty',
				slateId: null,
				personId: null,
				portraitId: null,
				summarySourceCount: 0,
				roleSourceCount: 0,
				factCount: 0,
				citedFactCount: 0
			})
		]);

		expect(issues.map((issue) => issue.message)).toEqual(
			expect.arrayContaining([
				expect.stringContaining('not ready'),
				expect.stringContaining('no portrait'),
				expect.stringContaining('no summary source'),
				expect.stringContaining('no role source'),
				expect.stringContaining('uncited facts'),
				expect.stringContaining('exactly one active leadership slate'),
				expect.stringContaining('no active leadership members')
			])
		);
	});
});

function fakeRepository(
	overrides: Partial<ResearchImportRepository> = {}
): ResearchImportRepository {
	return {
		writeUniverse:
			overrides.writeUniverse ??
			(async (_universe, context) => ({
				issuerCount: 0,
				includedCount: 0,
				excludedCount: 0,
				listingCount: 0,
				importedAt: context.importedAt
			})),
		writeProfiles:
			overrides.writeProfiles ??
			(async (_profiles, context) => ({
				profiles: [],
				importedAt: context.importedAt
			})),
		freeze:
			overrides.freeze ??
			(async (context) => ({
				includedCount: 2,
				revision: 1,
				pairingSeed: context.pairingSeed,
				frozenAt: context.frozenAt,
				alreadyFrozen: false
			}))
	};
}

function validProfile(index: number): ExecutiveProfile {
	return {
		schema_version: 1,
		issuer_key: `cik:${String(index).padStart(10, '0')}`,
		canonical_ticker: `EX${index}`,
		company_name: `Example Company ${index}`,
		leadership_as_of: '2026-07-26',
		leaders: [
			{
				name: `Ada Example ${index}`,
				title: 'Chief Executive Officer',
				role_kind: 'ceo',
				is_interim: false,
				summary: Array.from({ length: 80 }, (_, wordIndex) => `word${wordIndex + 1}`).join(' '),
				summary_sources: [officialSource],
				role_source: officialSource,
				portrait: {
					image_url: `https://example.com/ada-${index}.png`,
					alt_text: `Portrait of Ada Example ${index}`,
					is_real_person: true,
					source: officialSource
				},
				facts: [
					{
						category: 'education',
						value: 'Attended Example University.',
						sources: [officialSource]
					}
				]
			}
		]
	};
}

function validUniverse() {
	return createNormalizedUniverseSnapshot(
		[
			{
				issuerKey: 'cik:0000000001',
				cik: '0000000001',
				name: 'Example Company',
				description: 'An operating company.',
				homepageUrl: 'https://example.com',
				sicCode: '1234',
				sicDescription: 'Examples',
				canonicalTicker: 'EX',
				marketCap: 100,
				included: true,
				exclusionReason: null,
				listings: [
					{
						ticker: 'EX',
						name: 'Example Company',
						primaryExchange: 'XNYS',
						type: 'CS',
						active: true,
						compositeFigi: 'BBG000EXAMPLE',
						shareClassFigi: 'BBG001EXAMPLE',
						marketCap: 100,
						lastUpdatedAt: '2026-07-26T00:00:00Z',
						isCanonical: true
					}
				]
			}
		],
		'2026-07-26',
		NOW
	);
}

function readinessRow(overrides: Partial<FreezeReadinessRow> = {}): FreezeReadinessRow {
	return {
		issuerKey: 'issuer:example',
		companyName: 'Example',
		readinessStatus: 'ready',
		slateId: 'slate-1',
		personId: 'person-1',
		portraitId: 'portrait-1',
		summarySourceCount: 1,
		roleSourceCount: 1,
		factCount: 1,
		citedFactCount: 1,
		...overrides
	};
}

async function portraitImage(): Promise<Blob> {
	const image = await sharp({
		create: {
			width: 240,
			height: 300,
			channels: 3,
			background: '#5271ff'
		}
	})
		.png()
		.toBuffer();
	return new Blob([Uint8Array.from(image)], { type: 'image/png' });
}
