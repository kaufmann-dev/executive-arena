import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
	massiveTickerListResponseSchema,
	massiveTickerOverviewResponseSchema,
	massiveTickerSchema,
	type MassiveTicker
} from './schemas';

export const exclusionReasonSchema = z.enum(['sic_6770', 'blank_check_description']);
export type ExclusionReason = z.infer<typeof exclusionReasonSchema>;

export interface NormalizedListing {
	ticker: string;
	name: string;
	primaryExchange: string | null;
	type: string;
	active: boolean;
	compositeFigi: string | null;
	shareClassFigi: string | null;
	marketCap: number | null;
	lastUpdatedAt: string | null;
	isCanonical: boolean;
}

export interface NormalizedIssuer {
	issuerKey: string;
	cik: string | null;
	name: string;
	description: string;
	homepageUrl: string | null;
	sicCode: string | null;
	sicDescription: string | null;
	canonicalTicker: string;
	marketCap: number | null;
	included: boolean;
	exclusionReason: ExclusionReason | null;
	listings: NormalizedListing[];
}

export const normalizedListingSchema = z.strictObject({
	ticker: z.string().min(1),
	name: z.string().min(1),
	primaryExchange: z.string().nullable(),
	type: z.string().min(1),
	active: z.boolean(),
	compositeFigi: z.string().nullable(),
	shareClassFigi: z.string().nullable(),
	marketCap: z.number().finite().nonnegative().nullable(),
	lastUpdatedAt: z.string().nullable(),
	isCanonical: z.boolean()
});

export const normalizedIssuerSchema = z
	.strictObject({
		issuerKey: z.string().min(1),
		cik: z.string().nullable(),
		name: z.string().min(1),
		description: z.string(),
		homepageUrl: z.string().nullable(),
		sicCode: z.string().nullable(),
		sicDescription: z.string().nullable(),
		canonicalTicker: z.string().min(1),
		marketCap: z.number().finite().nonnegative().nullable(),
		included: z.boolean(),
		exclusionReason: exclusionReasonSchema.nullable(),
		listings: z.array(normalizedListingSchema).min(1)
	})
	.superRefine((issuer, context) => {
		const canonical = issuer.listings.filter((listing) => listing.isCanonical);
		if (canonical.length !== 1 || canonical[0]?.ticker !== issuer.canonicalTicker) {
			context.addIssue({
				code: 'custom',
				path: ['listings'],
				message: 'Exactly one listing must be canonical and match canonicalTicker'
			});
		}
	});

export const normalizedUniverseSchema = z.array(normalizedIssuerSchema).min(1);

export const normalizedUniverseSnapshotSchema = z
	.strictObject({
		schemaVersion: z.literal(1),
		provider: z.literal('massive'),
		asOf: z.iso.date(),
		retrievedAt: z.iso.datetime({ offset: true }),
		issuerCount: z.number().int().positive(),
		includedCount: z.number().int().nonnegative(),
		excludedCount: z.number().int().nonnegative(),
		listingCount: z.number().int().positive(),
		requestIds: z.array(z.string().trim().min(1)),
		payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
		issuers: normalizedUniverseSchema
	})
	.superRefine((snapshot, context) => {
		const includedCount = snapshot.issuers.filter((issuer) => issuer.included).length;
		const listingCount = snapshot.issuers.reduce(
			(total, issuer) => total + issuer.listings.length,
			0
		);
		const expected = {
			issuerCount: snapshot.issuers.length,
			includedCount,
			excludedCount: snapshot.issuers.length - includedCount,
			listingCount,
			payloadSha256: hashNormalizedUniverse(snapshot.issuers)
		};
		for (const [field, value] of Object.entries(expected)) {
			if (snapshot[field as keyof typeof expected] !== value) {
				context.addIssue({
					code: 'custom',
					path: [field],
					message: `${field} does not match the normalized issuer payload`
				});
			}
		}
		const canonicalRequestIds = [...new Set(snapshot.requestIds)].sort(compareStrings);
		if (
			canonicalRequestIds.length !== snapshot.requestIds.length ||
			canonicalRequestIds.some((requestId, index) => requestId !== snapshot.requestIds[index])
		) {
			context.addIssue({
				code: 'custom',
				path: ['requestIds'],
				message: 'requestIds must be unique and sorted'
			});
		}
	});

export type NormalizedUniverseSnapshot = z.infer<typeof normalizedUniverseSnapshotSchema>;

export const reviewedIssuerAliasesSchema = z
	.record(
		z.string(),
		z
			.string()
			.trim()
			.regex(
				/^alias:[a-z0-9][a-z0-9._-]{0,93}$/,
				'Issuer aliases must use the form alias:reviewed-stable-id'
			)
	)
	.superRefine((aliases, context) => {
		for (const ticker of Object.keys(aliases)) {
			if (ticker !== ticker.trim().toUpperCase()) {
				context.addIssue({
					code: 'custom',
					path: [ticker],
					message: 'Reviewed issuer alias ticker keys must be trimmed uppercase symbols'
				});
			}
		}
	});

export type ReviewedIssuerAliases = z.infer<typeof reviewedIssuerAliasesSchema>;

const blankCheckPatterns = [
	/^(?:an?\s+)?(?:(?:newly|recently)\s+)?(?:(?:formed|incorporated|created|organized|established)\s+)?(?:blank[- ]check|special purpose acquisition) company\b/i,
	/\b(?:we\s+are|(?:the|this)\s+(?:company|corporation|issuer)\s+(?:is|remains|operates as|is incorporated as))\s+(?:an?\s+)?(?:(?:newly|recently)\s+)?(?:(?:formed|incorporated|created|organized|established)\s+)?(?:blank[- ]check|special purpose acquisition) company\b/i,
	/\b(?:the|this)\s+(?:company|corporation|issuer)\s*,\s+(?:an?\s+)?(?:(?:newly|recently)\s+)?(?:(?:formed|incorporated|created|organized|established)\s+)?(?:blank[- ]check|special purpose acquisition) company\b/i,
	/\b(?:is|operates as|is incorporated as) (?:an?\s+)?(?:blank[- ]check|special purpose acquisition) company\b/i,
	/\bblank[- ]check compan(?:y|ies) (?:formed|incorporated|created|organized|established)\b/i,
	/(?:^|[.!?]\s+)(?:a )?special purpose acquisition company (?:formed|incorporated|created|organized|established)\b/i,
	/\bformed (?:for|with) the (?:business )?purpose of (?:effecting|completing) (?:a )?(?:merger|business combination)\b/i,
	/\bhas no significant operations\b.*\b(?:merger|business combination)\b/i
];

const MASSIVE_REQUEST_TIMEOUT_MS = 20_000;
const MASSIVE_MAX_ATTEMPTS = 4;
const MASSIVE_MAX_RETRY_DELAY_MS = 30_000;
const MASSIVE_TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function normalizeCik(value: string | null | undefined): string | null {
	if (!value) return null;
	const digits = value.replace(/^0+/, '') || '0';
	return digits.padStart(10, '0');
}

export function isExplicitBlankCheckDescription(description: string | null | undefined): boolean {
	if (!description) return false;
	return blankCheckPatterns.some((pattern) => pattern.test(description));
}

export function issuerKeyFor(
	record: MassiveTicker,
	reviewedAliases: ReviewedIssuerAliases
): string {
	const cik = normalizeCik(record.cik);
	if (cik) return `cik:${cik}`;

	const ticker = record.ticker.toUpperCase();
	const reviewedAlias = reviewedAliases[ticker];
	if (!reviewedAlias) {
		throw new Error(
			`Ticker ${ticker} has no CIK; add it to the reviewed issuer alias file before normalizing the universe`
		);
	}
	return reviewedAlias;
}

export function normalizeUniverse(
	records: readonly unknown[],
	reviewedAliasesValue: unknown
): NormalizedIssuer[] {
	const parsedRecords = records.map((record) => massiveTickerSchema.parse(record));
	const reviewedAliases = reviewedIssuerAliasesSchema.parse(reviewedAliasesValue);
	const eligibleListings = parsedRecords.filter(
		(record) =>
			record.active &&
			record.locale.toLocaleLowerCase('en-US') === 'us' &&
			record.market === 'stocks' &&
			record.type === 'CS'
	);
	const groups = Map.groupBy(eligibleListings, (record) => issuerKeyFor(record, reviewedAliases));

	return [...groups.entries()]
		.map(([issuerKey, listings]) => normalizeIssuer(issuerKey, listings))
		.sort(
			(left, right) =>
				compareStrings(left.canonicalTicker, right.canonicalTicker) ||
				compareStrings(left.issuerKey, right.issuerKey)
		);
}

function normalizeIssuer(issuerKey: string, records: MassiveTicker[]): NormalizedIssuer {
	const sorted = [...records].sort(compareCanonicalCandidates);
	const canonical = sorted[0]!;
	const exclusionReason = determineExclusionReason(records);

	return {
		issuerKey,
		cik: normalizeCik(canonical.cik),
		name: canonical.name,
		description: canonical.description ?? '',
		homepageUrl: canonical.homepage_url ?? null,
		sicCode: canonical.sic_code ?? null,
		sicDescription: canonical.sic_description ?? null,
		canonicalTicker: canonical.ticker,
		marketCap: canonical.market_cap ?? null,
		included: exclusionReason === null,
		exclusionReason,
		listings: sorted.map((record, index) => ({
			ticker: record.ticker,
			name: record.name,
			primaryExchange: record.primary_exchange ?? null,
			type: record.type,
			active: record.active,
			compositeFigi: record.composite_figi ?? null,
			shareClassFigi: record.share_class_figi ?? null,
			marketCap: record.market_cap ?? null,
			lastUpdatedAt: record.last_updated_utc ?? null,
			isCanonical: index === 0
		}))
	};
}

function compareCanonicalCandidates(left: MassiveTicker, right: MassiveTicker): number {
	const leftCap = left.market_cap ?? Number.NEGATIVE_INFINITY;
	const rightCap = right.market_cap ?? Number.NEGATIVE_INFINITY;
	if (leftCap !== rightCap) return rightCap - leftCap;
	if (left.ticker.length !== right.ticker.length) return left.ticker.length - right.ticker.length;
	return compareStrings(left.ticker, right.ticker);
}

function determineExclusionReason(records: readonly MassiveTicker[]): ExclusionReason | null {
	if (records.some((record) => normalizeSicCode(record.sic_code) === '6770')) return 'sic_6770';
	if (records.some((record) => isExplicitBlankCheckDescription(record.description))) {
		return 'blank_check_description';
	}
	return null;
}

function normalizeSicCode(value: string | null | undefined): string | null {
	if (!value) return null;
	return value.padStart(4, '0');
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export interface MassiveUniverseFetchOptions {
	apiKey: string;
	asOf: string;
	fetch?: typeof globalThis.fetch;
	baseUrl?: string;
	detailConcurrency?: number;
	signal?: AbortSignal;
	loadCachedDetail?: (
		ticker: string,
		asOf: string
	) => Promise<{ record: unknown; requestId: string | null } | null>;
	saveDetail?: (record: MassiveTicker, asOf: string, requestId: string | null) => Promise<void>;
	onRequestId?: (requestId: string) => void;
	onListComplete?: (listingCount: number) => void | Promise<void>;
	onDetailProgress?: (progress: {
		completed: number;
		total: number;
		ticker: string;
		cached: boolean;
	}) => void | Promise<void>;
}

/**
 * Fetches the active common-stock universe on one explicit date, then enriches
 * every list record with a same-date Ticker Overview because list responses
 * omit SIC, description, and market capitalization.
 */
export async function fetchMassiveUniverse(
	options: MassiveUniverseFetchOptions
): Promise<MassiveTicker[]> {
	const asOf = z.iso.date().parse(options.asOf);
	const fetcher = options.fetch ?? globalThis.fetch;
	const baseUrl = new URL(options.baseUrl ?? 'https://api.massive.com');
	const initialUrl = new URL('/v3/reference/tickers', baseUrl);
	initialUrl.searchParams.set('market', 'stocks');
	initialUrl.searchParams.set('locale', 'us');
	initialUrl.searchParams.set('type', 'CS');
	initialUrl.searchParams.set('active', 'true');
	initialUrl.searchParams.set('limit', '1000');
	initialUrl.searchParams.set('sort', 'ticker');
	initialUrl.searchParams.set('order', 'asc');
	initialUrl.searchParams.set('date', asOf);

	const listRecords: MassiveTicker[] = [];
	const visitedPageUrls = new Set<string>();
	let pageUrl: URL | null = initialUrl;
	while (pageUrl) {
		assertSameOrigin(pageUrl, baseUrl);
		if (visitedPageUrls.has(pageUrl.href)) {
			throw new Error(`Massive pagination loop detected at ${pageUrl.href}`);
		}
		visitedPageUrls.add(pageUrl.href);
		const response = await fetchJson(pageUrl, options.apiKey, fetcher, options.signal);
		const page = massiveTickerListResponseSchema.parse(response);
		if (page.request_id) options.onRequestId?.(page.request_id);
		listRecords.push(...page.results);
		if (page.next_url) {
			pageUrl = new URL(page.next_url, baseUrl);
			pageUrl.searchParams.set('date', asOf);
		} else {
			pageUrl = null;
		}
	}
	await options.onListComplete?.(listRecords.length);

	const concurrency = options.detailConcurrency ?? 8;
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
		throw new Error('detailConcurrency must be an integer from 1 through 32');
	}

	let completed = 0;
	return mapConcurrent(listRecords, concurrency, async (listRecord) => {
		const cached = await options.loadCachedDetail?.(listRecord.ticker, asOf);
		if (cached !== undefined && cached !== null) {
			const parsed = massiveTickerSchema.parse(cached.record);
			if (parsed.ticker !== listRecord.ticker) {
				throw new Error(
					`Cached Massive detail ${parsed.ticker} does not match requested ticker ${listRecord.ticker}`
				);
			}
			if (cached.requestId) options.onRequestId?.(cached.requestId);
			await options.onDetailProgress?.({
				completed: ++completed,
				total: listRecords.length,
				ticker: listRecord.ticker,
				cached: true
			});
			return { ...listRecord, ...parsed };
		}

		const detailUrl = new URL(
			`/v3/reference/tickers/${encodeURIComponent(listRecord.ticker)}`,
			baseUrl
		);
		detailUrl.searchParams.set('date', asOf);
		const response = await fetchJson(detailUrl, options.apiKey, fetcher, options.signal);
		const overview = massiveTickerOverviewResponseSchema.parse(response);
		if (overview.request_id) options.onRequestId?.(overview.request_id);
		const detail = overview.results;
		if (detail.ticker !== listRecord.ticker) {
			throw new Error(
				`Massive returned ${detail.ticker} while enriching requested ticker ${listRecord.ticker}`
			);
		}
		await options.saveDetail?.(detail, asOf, overview.request_id ?? null);
		await options.onDetailProgress?.({
			completed: ++completed,
			total: listRecords.length,
			ticker: listRecord.ticker,
			cached: false
		});
		return { ...listRecord, ...detail };
	});
}

export function createNormalizedUniverseSnapshot(
	issuersValue: readonly NormalizedIssuer[],
	asOf: string,
	retrievedAt = new Date(),
	requestIds: readonly string[] = []
): NormalizedUniverseSnapshot {
	const issuers = normalizedUniverseSchema.parse(issuersValue);
	const includedCount = issuers.filter((issuer) => issuer.included).length;
	return normalizedUniverseSnapshotSchema.parse({
		schemaVersion: 1,
		provider: 'massive',
		asOf,
		retrievedAt: retrievedAt.toISOString(),
		issuerCount: issuers.length,
		includedCount,
		excludedCount: issuers.length - includedCount,
		listingCount: issuers.reduce((total, issuer) => total + issuer.listings.length, 0),
		requestIds: [...new Set(requestIds)].sort(compareStrings),
		payloadSha256: hashNormalizedUniverse(issuers),
		issuers
	});
}

export function hashNormalizedUniverse(issuers: readonly NormalizedIssuer[]): string {
	return createHash('sha256').update(JSON.stringify(issuers)).digest('hex');
}

async function fetchJson(
	url: URL,
	apiKey: string,
	fetcher: typeof globalThis.fetch,
	signal?: AbortSignal
): Promise<unknown> {
	for (let attempt = 1; attempt <= MASSIVE_MAX_ATTEMPTS; attempt++) {
		signal?.throwIfAborted();
		let response: Response;
		try {
			response = await fetcher(url, {
				headers: {
					accept: 'application/json',
					authorization: `Bearer ${apiKey}`
				},
				signal: signal
					? AbortSignal.any([signal, AbortSignal.timeout(MASSIVE_REQUEST_TIMEOUT_MS)])
					: AbortSignal.timeout(MASSIVE_REQUEST_TIMEOUT_MS)
			});
		} catch (error) {
			if (attempt === MASSIVE_MAX_ATTEMPTS) {
				throw new Error(
					`Massive request failed after ${MASSIVE_MAX_ATTEMPTS} attempts for ${url.pathname}`,
					{ cause: error }
				);
			}
			await wait(retryDelayMs(null, attempt));
			continue;
		}

		if (response.ok) return response.json();

		if (!MASSIVE_TRANSIENT_STATUS_CODES.has(response.status) || attempt === MASSIVE_MAX_ATTEMPTS) {
			throw new Error(`Massive request failed with HTTP ${response.status} for ${url.pathname}`);
		}

		await response.body?.cancel().catch(() => undefined);
		await wait(retryDelayMs(response.headers.get('retry-after'), attempt));
	}

	throw new Error(`Massive request retry loop ended unexpectedly for ${url.pathname}`);
}

function assertSameOrigin(candidate: URL, expected: URL): void {
	if (candidate.origin !== expected.origin) {
		throw new Error(
			`Refusing to send the Massive API key to unexpected origin ${candidate.origin}`
		);
	}
}

function retryDelayMs(retryAfter: string | null, attempt: number): number {
	if (retryAfter !== null) {
		const seconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) : Number.NaN;
		if (Number.isFinite(seconds)) {
			return Math.min(seconds * 1_000, MASSIVE_MAX_RETRY_DELAY_MS);
		}

		const retryAt = Date.parse(retryAfter);
		if (Number.isFinite(retryAt)) {
			return Math.min(Math.max(0, retryAt - Date.now()), MASSIVE_MAX_RETRY_DELAY_MS);
		}
	}

	return Math.min(250 * 2 ** (attempt - 1), MASSIVE_MAX_RETRY_DELAY_MS);
}

async function wait(milliseconds: number): Promise<void> {
	if (milliseconds === 0) return;
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function mapConcurrent<T, R>(
	values: readonly T[],
	concurrency: number,
	mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
	const output = new Array<R>(values.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < values.length) {
			const index = nextIndex++;
			output[index] = await mapper(values[index]!, index);
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
	return output;
}
