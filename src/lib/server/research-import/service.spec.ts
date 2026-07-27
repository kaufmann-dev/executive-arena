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
const resolvePortraitAddresses = async () => ['93.184.216.34'];
const officialSource: ResearchSource = {
	url: 'https://example.com/leadership',
	title: 'Leadership',
	publisher: 'Example Company'
};

describe('research import service', () => {
	it('validates and transforms every portrait before one repository batch write', async () => {
		const inputImages = await Promise.all([
			portraitImage('#5271ff'),
			portraitImage('#ff7152'),
			portraitImage('#71ff52'),
			portraitImage('#5271ff')
		]);
		const fetchPortrait = vi.fn();
		for (const inputImage of inputImages) {
			fetchPortrait.mockResolvedValueOnce(new Response(inputImage, { status: 200 }));
		}
		const writeProfiles = vi.fn<ResearchImportRepository['writeProfiles']>(
			async (profiles, context) => ({
				profiles: profiles.map(({ profile }, index) => ({
					issuerKey: profile.issuer_key,
					companyId: `company-${index}`,
					slateId: `slate-${index}`,
					slateVersion: 1,
					action: 'created',
					cohortRevision: null,
					readinessStatus: profiles[index]!.portraits.length > 0 ? 'ready' : 'missing_image',
					acceptedPortraitCount: profiles[index]!.portraits.length,
					portraitDiagnostics: profiles[index]!.portraitDiagnostics
				})),
				importedAt: context.importedAt
			})
		);
		const service = createResearchImportService(fakeRepository({ writeProfiles }), {
			fetchPortrait,
			resolvePortraitAddresses,
			now: () => NOW,
			pairingSeed: () => SEED,
			portraitConcurrency: 2
		});
		const profiles = [validProfile(1), validProfile(2)];
		const firstPortrait = profiles[0]!.leaders[0]!.portraits[0]!;
		profiles[0]!.leaders[0]!.portraits.push(
			{ ...firstPortrait, image_url: 'https://example.com/ada-1-secondary.png' },
			{ ...firstPortrait, image_url: 'https://example.com/ada-1-tertiary.png' }
		);

		const result = await service.importProfiles(profiles);

		expect(result.profiles).toHaveLength(2);
		expect(fetchPortrait).toHaveBeenCalledTimes(4);
		expect(writeProfiles).toHaveBeenCalledTimes(1);
		const prepared = writeProfiles.mock.calls[0]![0];
		expect(prepared).toHaveLength(2);
		expect(prepared[0]!.portraits[0]!.portrait).toMatchObject({
			contentType: 'image/webp',
			width: 240,
			height: 300
		});
		expect(prepared[0]!.portraits[0]!.portrait.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(prepared[0]!.portraits.map(({ portraitIndex }) => portraitIndex)).toEqual([0, 1, 2]);
		expect(writeProfiles.mock.calls[0]![1]).toEqual({
			importedAt: NOW,
			claimCheckedAt: NOW,
			pairingSeed: SEED,
			publicationClaims: null,
			submittedByApiKeyId: null
		});
	});

	it('publishes the text profile when a required-position portrait download fails', async () => {
		const inputImage = await portraitImage();
		const fetchPortrait = vi
			.fn()
			.mockResolvedValueOnce(new Response(inputImage, { status: 200 }))
			.mockResolvedValueOnce(new Response(null, { status: 404 }));
		const writeProfiles = vi.fn<ResearchImportRepository['writeProfiles']>();
		const service = createResearchImportService(fakeRepository({ writeProfiles }), {
			fetchPortrait,
			resolvePortraitAddresses,
			now: () => NOW,
			pairingSeed: () => SEED,
			portraitConcurrency: 1,
			portraitDiagnostic: vi.fn()
		});

		await expect(
			service.importProfiles([validProfile(1), validProfile(2)])
		).resolves.toBeUndefined();
		expect(writeProfiles).toHaveBeenCalledOnce();
		expect(writeProfiles.mock.calls[0]![0][1]!.profile.leaders[0]!.portraits).toEqual([]);
	});

	it('discards failed optional downloads and reindexes remaining valid portraits', async () => {
		const firstImage = await portraitImage('#5271ff');
		const thirdImage = await portraitImage('#71ff52');
		const fetchPortrait = vi
			.fn()
			.mockResolvedValueOnce(new Response(firstImage, { status: 200 }))
			.mockResolvedValueOnce(
				new Response(null, {
					status: 404,
					headers: { 'content-type': 'text/html' }
				})
			)
			.mockResolvedValueOnce(new Response(thirdImage, { status: 200 }));
		const portraitDiagnostic = vi.fn();
		const writeProfiles = vi.fn<ResearchImportRepository['writeProfiles']>(
			async (_profiles, context) => ({ profiles: [], importedAt: context.importedAt })
		);
		const service = createResearchImportService(fakeRepository({ writeProfiles }), {
			fetchPortrait,
			resolvePortraitAddresses,
			pairingSeed: () => SEED,
			portraitConcurrency: 1,
			portraitDiagnostic
		});
		const profile = validProfile(1);
		const firstPortrait = profile.leaders[0]!.portraits[0]!;
		profile.leaders[0]!.portraits.push(
			{ ...firstPortrait, image_url: 'https://example.com/optional-broken.jpg' },
			{ ...firstPortrait, image_url: 'https://example.com/optional-valid.jpg' }
		);

		await expect(service.importProfiles([profile])).resolves.toMatchObject({ profiles: [] });

		const [prepared] = writeProfiles.mock.calls[0]![0];
		expect(prepared!.profile.leaders[0]!.portraits.map((portrait) => portrait.image_url)).toEqual([
			'https://example.com/ada-1.png',
			'https://example.com/optional-valid.jpg'
		]);
		expect(prepared!.portraits.map(({ portraitIndex }) => portraitIndex)).toEqual([0, 1]);
		expect(portraitDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({
				code: 'portrait_download_failed',
				portraitIndex: 1,
				httpStatus: 404,
				contentType: 'text/html',
				finalLocation: 'https://example.com/optional-broken.jpg'
			})
		);
	});

	it('discards optional submission failures before downloading the required portrait', async () => {
		const fetchPortrait = vi.fn(async () => new Response(await portraitImage(), { status: 200 }));
		const portraitDiagnostic = vi.fn();
		const writeProfiles = vi.fn<ResearchImportRepository['writeProfiles']>(
			async (_profiles, context) => ({ profiles: [], importedAt: context.importedAt })
		);
		const service = createResearchImportService(fakeRepository({ writeProfiles }), {
			fetchPortrait,
			resolvePortraitAddresses,
			pairingSeed: () => SEED,
			portraitDiagnostic
		});
		const profile = validProfile(1);
		const firstPortrait = profile.leaders[0]!.portraits[0]!;
		const unattributablePortrait = {
			...firstPortrait,
			image_url: 'https://example.com/optional-unattributable.jpg'
		};
		(unattributablePortrait as { is_real_person: boolean }).is_real_person = false;
		profile.leaders[0]!.portraits.push(
			{ ...firstPortrait, image_url: 'http://example.com/optional-http.jpg' },
			unattributablePortrait
		);

		await expect(service.importProfiles([profile])).resolves.toMatchObject({ profiles: [] });

		expect(fetchPortrait).toHaveBeenCalledOnce();
		expect(writeProfiles.mock.calls[0]![0][0]!.profile.leaders[0]!.portraits).toHaveLength(1);
		expect(portraitDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ code: 'portrait_not_https', portraitIndex: 1 })
		);
		expect(portraitDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ code: 'portrait_unattributable', portraitIndex: 2 })
		);
	});

	it('accepts AVIF through the complete publication preparation path', async () => {
		const avif = await sharp({
			create: { width: 240, height: 300, channels: 3, background: '#5271ff' }
		})
			.avif()
			.toBuffer();
		const writeProfiles = vi.fn<ResearchImportRepository['writeProfiles']>(
			async (_profiles, context) => ({ profiles: [], importedAt: context.importedAt })
		);
		const service = createResearchImportService(fakeRepository({ writeProfiles }), {
			fetchPortrait: vi.fn(
				async () =>
					new Response(avif, {
						status: 200,
						headers: { 'content-type': 'image/avif' }
					})
			),
			resolvePortraitAddresses,
			pairingSeed: () => SEED
		});

		await expect(service.importProfiles([validProfile(1)])).resolves.toMatchObject({
			profiles: []
		});
		expect(writeProfiles.mock.calls[0]![0][0]!.portraits[0]!.portrait).toMatchObject({
			originalFormat: 'avif',
			sourceContentType: 'image/avif',
			contentType: 'image/webp'
		});
	});

	it.each([
		{
			name: 'a non-HTTPS portrait',
			mutate: (profile: ExecutiveProfile) => {
				profile.leaders[0]!.portraits[0]!.image_url = 'http://example.com/ada.png';
			},
			code: 'portrait_not_https'
		},
		{
			name: 'a portrait without a real-person attestation',
			mutate: (profile: ExecutiveProfile) => {
				(profile.leaders[0]!.portraits[0] as { is_real_person: boolean }).is_real_person = false;
			},
			code: 'portrait_unattributable'
		}
	])('returns a stable code for $name before downloading', async ({ mutate, code }) => {
		const fetchPortrait = vi.fn();
		const portraitDiagnostic = vi.fn();
		const writeProfiles = vi.fn<ResearchImportRepository['writeProfiles']>();
		const service = createResearchImportService(fakeRepository({ writeProfiles }), {
			fetchPortrait,
			pairingSeed: () => SEED,
			portraitDiagnostic
		});
		const profile = validProfile(1);
		mutate(profile);

		await expect(service.importProfiles([profile])).resolves.toBeUndefined();
		expect(fetchPortrait).not.toHaveBeenCalled();
		expect(writeProfiles).toHaveBeenCalledOnce();
		expect(portraitDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'portrait_rejected',
				code,
				issuerKey: profile.issuer_key,
				leaderName: profile.leaders[0]!.name,
				stage: 'validation'
			})
		);
	});

	it('discards duplicate normalized portrait content before writing', async () => {
		const inputImage = await portraitImage();
		const fetchPortrait = vi.fn(async () => new Response(inputImage, { status: 200 }));
		const portraitDiagnostic = vi.fn();
		const writeProfiles = vi.fn<ResearchImportRepository['writeProfiles']>();
		const service = createResearchImportService(fakeRepository({ writeProfiles }), {
			fetchPortrait,
			resolvePortraitAddresses,
			pairingSeed: () => SEED,
			portraitDiagnostic
		});
		const profile = validProfile(1);
		profile.leaders[0]!.portraits.push({
			...profile.leaders[0]!.portraits[0]!,
			image_url: 'https://example.com/ada-duplicate.png'
		});

		await expect(service.importProfiles([profile])).resolves.toBeUndefined();
		expect(writeProfiles).toHaveBeenCalledOnce();
		expect(writeProfiles.mock.calls[0]![0][0]!.portraits).toHaveLength(1);
		expect(portraitDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({
				code: 'portrait_duplicate',
				originalWidth: 240,
				originalHeight: 300
			})
		);
	});

	it('accepts a reputable secondary portrait source', async () => {
		const profile = validProfile(1);
		profile.leaders[0]!.portraits[0] = {
			...profile.leaders[0]!.portraits[0]!,
			image_url: 'https://cdn.news.example.com/ada.png',
			source: {
				url: 'https://news.example.com/profiles/ada',
				title: 'Ada Example profile',
				publisher: 'Example News'
			}
		};
		const service = createResearchImportService(fakeRepository(), {
			fetchPortrait: vi.fn(async () => new Response(await portraitImage(), { status: 200 })),
			resolvePortraitAddresses,
			pairingSeed: () => SEED,
			portraitDiagnostic: vi.fn()
		});

		await expect(service.importProfiles([profile])).resolves.toMatchObject({
			profiles: []
		});
	});

	it('sanitizes portrait failure diagnostics', async () => {
		const tinyImage = await sharp({
			create: { width: 32, height: 32, channels: 3, background: 'white' }
		})
			.png()
			.toBuffer();
		const portraitDiagnostic = vi.fn();
		const profile = validProfile(1);
		profile.leaders[0]!.portraits[0] = {
			...profile.leaders[0]!.portraits[0]!,
			image_url: 'https://cdn.news.example.com/ada.png?token=secret-value'
		};
		const service = createResearchImportService(fakeRepository(), {
			fetchPortrait: vi.fn(async () => new Response(tinyImage, { status: 200 })),
			resolvePortraitAddresses,
			pairingSeed: () => SEED,
			portraitDiagnostic
		});

		await expect(service.importProfiles([profile])).resolves.toMatchObject({ profiles: [] });
		expect(portraitDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({
				code: 'portrait_unusable_resolution',
				imageLocation: 'https://cdn.news.example.com/ada.png',
				originalWidth: 32,
				originalHeight: 32
			})
		);
		expect(JSON.stringify(portraitDiagnostic.mock.calls)).not.toContain('secret-value');
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
				portraitCount: 0,
				profileSourceCount: 0
			}),
			readinessRow({
				issuerKey: 'issuer:empty',
				companyName: 'Empty',
				slateId: null,
				personId: null,
				portraitCount: 0,
				profileSourceCount: 0
			})
		]);

		expect(issues.map((issue) => issue.message)).toEqual(
			expect.arrayContaining([
				expect.stringContaining('no portrait'),
				expect.stringContaining('no profile source'),
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
		schema_version: 4,
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
				sources: [officialSource],
				portraits: [
					{
						image_url: `https://example.com/ada-${index}.png`,
						alt_text: `Portrait of Ada Example ${index}`,
						is_real_person: true,
						source: officialSource
					}
				],
				facts: [
					{
						category: 'education',
						value: 'Attended Example University.'
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
		slateId: 'slate-1',
		personId: 'person-1',
		portraitCount: 1,
		profileSourceCount: 1,
		...overrides
	};
}

async function portraitImage(background = '#5271ff'): Promise<Blob> {
	const image = await sharp({
		create: {
			width: 240,
			height: 300,
			channels: 3,
			background
		}
	})
		.png()
		.toBuffer();
	return new Blob([Uint8Array.from(image)], { type: 'image/png' });
}
