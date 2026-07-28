import { describe, expect, it, vi } from 'vitest';
import type { MassiveTicker } from './schemas';
import {
	createNormalizedUniverseSnapshot,
	fetchMassiveUniverse,
	isExplicitBlankCheckDescription,
	normalizeUniverse,
	normalizedUniverseSnapshotSchema
} from './universe';

function ticker(overrides: Partial<MassiveTicker> = {}): MassiveTicker {
	return {
		active: true,
		locale: 'us',
		market: 'stocks',
		name: 'Example Holdings',
		ticker: 'EX',
		type: 'CS',
		...overrides
	};
}

describe('universe normalization', () => {
	it('filters cohort membership and deduplicates share classes by normalized CIK', () => {
		const universe = normalizeUniverse(
			[
				ticker({ ticker: 'EX.A', cik: '123', market_cap: 100 }),
				ticker({ ticker: 'EXB', cik: '0000000123', market_cap: 200 }),
				ticker({ ticker: 'ETF', cik: '456', type: 'ETF' }),
				ticker({ ticker: 'OLD', cik: '789', active: false }),
				ticker({ ticker: 'FX', cik: '999', market: 'fx' }),
				ticker({ ticker: 'FOREIGN', cik: '1000', locale: 'global' })
			],
			{}
		);

		expect(universe).toHaveLength(1);
		expect(universe[0]).toMatchObject({
			issuerKey: 'cik:0000000123',
			canonicalTicker: 'EXB',
			marketCap: 200
		});
		expect(universe[0]!.listings.map((listing) => listing.ticker)).toEqual(['EXB', 'EX.A']);
		expect(universe[0]!.listings.filter((listing) => listing.isCanonical)).toHaveLength(1);
	});

	it('uses market cap, ticker length, and lexicographic order as canonical tie-breakers', () => {
		const [issuer] = normalizeUniverse(
			[
				ticker({ ticker: 'ZZ', cik: '1', market_cap: 50 }),
				ticker({ ticker: 'B', cik: '1', market_cap: 50 }),
				ticker({ ticker: 'A', cik: '1', market_cap: 50 })
			],
			{}
		);

		expect(issuer?.canonicalTicker).toBe('A');
	});

	it('requires reviewed aliases for no-CIK listings and can group reviewed share classes', () => {
		const records = [
			ticker({ ticker: 'EX.A', composite_figi: 'bbg000classa', market_cap: 100 }),
			ticker({ ticker: 'EX.B', composite_figi: 'bbg000classb', market_cap: 200 })
		];

		expect(() => normalizeUniverse(records, {})).toThrow('no CIK');

		const universe = normalizeUniverse(records, {
			'EX.A': 'alias:example-holdings',
			'EX.B': 'alias:example-holdings'
		});
		expect(universe).toHaveLength(1);
		expect(universe[0]).toMatchObject({
			issuerKey: 'alias:example-holdings',
			cik: null,
			canonicalTicker: 'EX.B'
		});
	});

	it('creates a self-verifying dated snapshot envelope', () => {
		const issuers = normalizeUniverse([ticker({ cik: '1', market_cap: 100 })], {});
		const snapshot = createNormalizedUniverseSnapshot(
			issuers,
			'2026-07-25',
			new Date('2026-07-26T09:30:00.000Z')
		);

		expect(snapshot).toMatchObject({
			schemaVersion: 1,
			provider: 'massive',
			asOf: '2026-07-25',
			retrievedAt: '2026-07-26T09:30:00.000Z',
			issuerCount: 1,
			includedCount: 1,
			excludedCount: 0,
			listingCount: 1
		});
		expect(snapshot.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(
			normalizedUniverseSnapshotSchema.safeParse({ ...snapshot, issuerCount: 2 }).success
		).toBe(false);
	});

	it('excludes SIC 6770 and explicit blank-check descriptions while retaining listings', () => {
		const universe = normalizeUniverse(
			[
				ticker({ ticker: 'SIC', cik: '1', sic_code: '6770' }),
				ticker({
					ticker: 'SPAC',
					cik: '2',
					description: 'The issuer is a blank check company formed to complete a merger.'
				}),
				ticker({
					ticker: 'ADVISER',
					cik: '3',
					description: 'The company provides legal advice to special purpose acquisition companies.'
				})
			],
			{}
		);

		expect(universe.find((issuer) => issuer.canonicalTicker === 'SIC')).toMatchObject({
			included: false,
			universeExclusionReason: 'blank_check_or_shell_company'
		});
		expect(universe.find((issuer) => issuer.canonicalTicker === 'SPAC')).toMatchObject({
			included: false,
			universeExclusionReason: 'blank_check_or_shell_company'
		});
		expect(universe.find((issuer) => issuer.canonicalTicker === 'ADVISER')).toMatchObject({
			included: true,
			universeExclusionReason: null
		});
		expect(universe.every((issuer) => issuer.listings.length === 1)).toBe(true);
		expect(
			isExplicitBlankCheckDescription(
				'The company provides legal advice to special purpose acquisition companies.'
			)
		).toBe(false);
		expect(isExplicitBlankCheckDescription('A blank check company.')).toBe(true);
		expect(isExplicitBlankCheckDescription('We are a blank check company.')).toBe(true);
		expect(
			isExplicitBlankCheckDescription('The company is a newly organized blank check company.')
		).toBe(true);
		expect(
			isExplicitBlankCheckDescription(
				'The issuer, a special purpose acquisition company, has not selected a target.'
			)
		).toBe(true);
		expect(
			isExplicitBlankCheckDescription(
				'The operating business was previously a blank check company before its merger.'
			)
		).toBe(false);
	});
});

describe('Massive universe fetch', () => {
	it('follows list pagination and enriches every ticker with overview fields', async () => {
		const requests: URL[] = [];
		const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(input.toString());
			requests.push(url);
			expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
			expect(init?.signal).toBeInstanceOf(AbortSignal);

			if (url.pathname === '/v3/reference/tickers' && !url.searchParams.has('cursor')) {
				return Response.json({
					status: 'OK',
					results: [ticker({ ticker: 'A', cik: '1' })],
					next_url: 'https://api.massive.com/v3/reference/tickers?cursor=next'
				});
			}
			if (url.pathname === '/v3/reference/tickers' && url.searchParams.get('cursor') === 'next') {
				return Response.json({
					status: 'OK',
					results: [ticker({ ticker: 'B', cik: '2' })]
				});
			}
			const requestedTicker = decodeURIComponent(url.pathname.split('/').at(-1)!);
			return Response.json({
				status: 'OK',
				results: ticker({
					ticker: requestedTicker,
					cik: requestedTicker === 'A' ? '1' : '2',
					market_cap: requestedTicker === 'A' ? 100 : 200,
					sic_code: '3571'
				})
			});
		});

		const records = await fetchMassiveUniverse({
			apiKey: 'secret',
			asOf: '2026-07-25',
			fetch: fetcher,
			detailConcurrency: 2
		});

		expect(records).toHaveLength(2);
		expect(records.map((record) => record.market_cap)).toEqual([100, 200]);
		expect(requests[0]?.searchParams.get('locale')).toBe('us');
		expect(requests.every((url) => url.searchParams.get('date') === '2026-07-25')).toBe(true);
		expect(requests.filter((url) => url.pathname === '/v3/reference/tickers')).toHaveLength(2);
		expect(requests.filter((url) => url.pathname.includes('/v3/reference/tickers/'))).toHaveLength(
			2
		);
	});

	it('does not forward the API key to an off-origin pagination URL', async () => {
		const fetcher = vi.fn(async () =>
			Response.json({
				status: 'OK',
				results: [],
				next_url: 'https://attacker.example/steal'
			})
		);

		await expect(
			fetchMassiveUniverse({ apiKey: 'secret', asOf: '2026-07-25', fetch: fetcher })
		).rejects.toThrow('unexpected origin');
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('retries bounded transient HTTP failures using Retry-After', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 429,
					headers: { 'retry-after': '0' }
				})
			)
			.mockResolvedValueOnce(
				Response.json({
					status: 'OK',
					results: []
				})
			);

		await expect(
			fetchMassiveUniverse({ apiKey: 'secret', asOf: '2026-07-25', fetch: fetcher })
		).resolves.toEqual([]);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('stops after four transient HTTP attempts', async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(null, {
				status: 503,
				headers: { 'retry-after': '0' }
			})
		);

		await expect(
			fetchMassiveUniverse({ apiKey: 'secret', asOf: '2026-07-25', fetch: fetcher })
		).rejects.toThrow('HTTP 503');
		expect(fetcher).toHaveBeenCalledTimes(4);
	});

	it('rejects invalid as-of dates before making a request', async () => {
		const fetcher = vi.fn<typeof fetch>();

		await expect(
			fetchMassiveUniverse({ apiKey: 'secret', asOf: '07/25/2026', fetch: fetcher })
		).rejects.toThrow();
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('stops repeated pagination URLs before refetching them', async () => {
		const fetcher = vi.fn(async (input: RequestInfo | URL) =>
			Response.json({
				status: 'OK',
				results: [],
				next_url: input.toString()
			})
		);

		await expect(
			fetchMassiveUniverse({ apiKey: 'secret', asOf: '2026-07-25', fetch: fetcher })
		).rejects.toThrow('pagination loop');
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('resumes overview enrichment from validated per-ticker cached details', async () => {
		const fetcher = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(input.toString());
			if (url.pathname === '/v3/reference/tickers') {
				return Response.json({
					status: 'OK',
					results: [ticker({ ticker: 'CACHED', cik: '1' })]
				});
			}
			throw new Error('Overview request should have been served from the checkpoint');
		});
		const saveDetail = vi.fn();
		const onRequestId = vi.fn();

		const records = await fetchMassiveUniverse({
			apiKey: 'secret',
			asOf: '2026-07-25',
			fetch: fetcher,
			loadCachedDetail: async () => ({
				record: ticker({ ticker: 'CACHED', cik: '1', market_cap: 321, sic_code: '3571' }),
				requestId: 'cached-overview-request'
			}),
			saveDetail,
			onRequestId
		});

		expect(records[0]).toMatchObject({ ticker: 'CACHED', market_cap: 321 });
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(saveDetail).not.toHaveBeenCalled();
		expect(onRequestId).toHaveBeenCalledWith('cached-overview-request');
	});
});
