import { z } from 'zod';
import {
	MIN_PORTRAIT_PIXELS,
	MIN_PORTRAIT_SIDE,
	PORTRAIT_BROWSER_USER_AGENT
} from '$lib/research/portrait';

const BRAVE_IMAGE_SEARCH_URL = 'https://api.search.brave.com/res/v1/images/search';
const BRAVE_SEARCH_TIMEOUT_MS = 15_000;
const BRAVE_RESULT_COUNT = 20;
const BRAVE_DISPLAY_COUNT = 10;

const nullableString = z.string().nullable().optional();
const nullableInteger = z.number().int().nonnegative().nullable().optional();

const braveImageResponseSchema = z.object({
	results: z.array(
		z.object({
			title: nullableString,
			url: nullableString,
			source: nullableString,
			confidence: nullableString,
			thumbnail: z
				.object({
					src: nullableString,
					width: nullableInteger,
					height: nullableInteger
				})
				.optional(),
			properties: z
				.object({
					url: nullableString,
					width: nullableInteger,
					height: nullableInteger
				})
				.optional()
		})
	)
});

export interface BravePortraitCandidate {
	title: string;
	sourcePageUrl: string;
	publisher: string;
	confidence: string | null;
	originalUrl: string;
	originalWidth: number | null;
	originalHeight: number | null;
	thumbnailUrl: string;
	thumbnailWidth: number | null;
	thumbnailHeight: number | null;
}

export interface BraveImageSearchOptions {
	apiKey?: string | null;
	fetcher?: typeof globalThis.fetch;
}

export class BraveImageSearchError extends Error {
	constructor(
		message: string,
		readonly status: number | null,
		readonly retryAfterSeconds: number | null = null,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'BraveImageSearchError';
	}
}

export function portraitSearchQuery(input: {
	personName: string;
	title: string;
	companyName: string;
	ticker: string;
}): string {
	return `"${input.personName}" "${input.companyName}" ${input.title} ${input.ticker} portrait`;
}

export async function searchBravePortraits(
	query: string,
	options: BraveImageSearchOptions = {}
): Promise<BravePortraitCandidate[]> {
	const apiKey =
		options.apiKey === undefined
			? process.env.BRAVE_SEARCH_API_KEY?.trim()
			: options.apiKey?.trim();
	if (!apiKey) {
		throw new BraveImageSearchError(
			'BRAVE_SEARCH_API_KEY is not configured for portrait backfill',
			null
		);
	}
	const url = new URL(BRAVE_IMAGE_SEARCH_URL);
	url.searchParams.set('q', query);
	url.searchParams.set('country', 'ALL');
	url.searchParams.set('search_lang', 'en');
	url.searchParams.set('count', String(BRAVE_RESULT_COUNT));
	url.searchParams.set('safesearch', 'strict');
	url.searchParams.set('spellcheck', 'false');

	let response: Response;
	try {
		response = await (options.fetcher ?? globalThis.fetch)(url, {
			headers: {
				accept: 'application/json',
				'user-agent': PORTRAIT_BROWSER_USER_AGENT,
				'x-subscription-token': apiKey
			},
			signal: AbortSignal.timeout(BRAVE_SEARCH_TIMEOUT_MS)
		});
	} catch (cause) {
		throw new BraveImageSearchError('Brave Image Search could not be reached', null, null, {
			cause
		});
	}
	if (!response.ok) {
		const retryAfterSeconds =
			response.status === 429 ? firstRateLimitReset(response.headers) : null;
		throw new BraveImageSearchError(
			response.status === 429
				? 'Brave Image Search rate limit reached'
				: `Brave Image Search failed with HTTP ${response.status}`,
			response.status,
			retryAfterSeconds
		);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (cause) {
		throw new BraveImageSearchError(
			'Brave Image Search returned invalid JSON',
			response.status,
			null,
			{
				cause
			}
		);
	}
	const parsed = braveImageResponseSchema.safeParse(payload);
	if (!parsed.success) {
		throw new BraveImageSearchError(
			'Brave Image Search returned an unsupported response shape',
			response.status
		);
	}

	const candidates: BravePortraitCandidate[] = [];
	const seenOriginalUrls = new Set<string>();
	for (const result of parsed.data.results) {
		const originalUrl = httpsUrl(result.properties?.url);
		const thumbnailUrl = braveThumbnailUrl(result.thumbnail?.src);
		const sourcePageUrl = httpUrl(result.url);
		if (!originalUrl || !thumbnailUrl || !sourcePageUrl) continue;
		if (
			knownDimensionsAreTooSmall(result.thumbnail?.width, result.thumbnail?.height) ||
			seenOriginalUrls.has(originalUrl)
		) {
			continue;
		}
		seenOriginalUrls.add(originalUrl);
		const sourceUrl = new URL(sourcePageUrl);
		candidates.push({
			title: result.title?.trim() || `Portrait result from ${sourceUrl.hostname}`,
			sourcePageUrl,
			publisher: result.source?.trim() || sourceUrl.hostname.replace(/^www\./, ''),
			confidence: result.confidence?.trim() || null,
			originalUrl,
			originalWidth: result.properties?.width ?? null,
			originalHeight: result.properties?.height ?? null,
			thumbnailUrl,
			thumbnailWidth: result.thumbnail?.width ?? null,
			thumbnailHeight: result.thumbnail?.height ?? null
		});
		if (candidates.length === BRAVE_DISPLAY_COUNT) break;
	}
	return candidates;
}

function knownDimensionsAreTooSmall(
	width: number | null | undefined,
	height: number | null | undefined
): boolean {
	if (width === null || width === undefined || height === null || height === undefined) {
		return false;
	}
	return (
		width < MIN_PORTRAIT_SIDE || height < MIN_PORTRAIT_SIDE || width * height < MIN_PORTRAIT_PIXELS
	);
}

function httpsUrl(value: string | null | undefined): string | null {
	const url = parsedUrl(value);
	return url?.protocol === 'https:' ? url.toString() : null;
}

function braveThumbnailUrl(value: string | null | undefined): string | null {
	const url = parsedUrl(value);
	return url?.protocol === 'https:' && url.hostname === 'imgs.search.brave.com'
		? url.toString()
		: null;
}

function httpUrl(value: string | null | undefined): string | null {
	const url = parsedUrl(value);
	return url && (url.protocol === 'http:' || url.protocol === 'https:') ? url.toString() : null;
}

function parsedUrl(value: string | null | undefined): URL | null {
	if (!value) return null;
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

function firstRateLimitReset(headers: Headers): number | null {
	const value = headers.get('x-ratelimit-reset') ?? headers.get('retry-after');
	if (!value) return null;
	const first = Number.parseInt(value.split(',', 1)[0]!.trim(), 10);
	return Number.isFinite(first) && first >= 0 ? first : null;
}
