import type { ResearchSourceKind } from '$lib/server/db/schema';
import { z } from 'zod';
import { fetchPublicResource } from './safe-fetch';

const SOURCE_MAX_BYTES = 5 * 1024 * 1024;
const SOURCE_TIMEOUT_MS = 25_000;
const SOURCE_TEXT_CHARACTERS = 80_000;
const MAX_COMPANY_PAGES = 5;
const MAX_SEC_FILINGS = 3;
const MAX_IMAGE_CANDIDATES = 40;

export interface ResearchCompanyInput {
	issuerKey: string;
	cik: string | null;
	canonicalTicker: string;
	name: string;
	description: string;
	homepageUrl: string | null;
	universeAsOf: string;
}

export const researchCompanyInputSchema = z.strictObject({
	issuerKey: z.string().min(1),
	cik: z.string().nullable(),
	canonicalTicker: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	homepageUrl: z.string().nullable(),
	universeAsOf: z.iso.date()
});

export interface DiscoveredSource {
	url: string;
	title: string;
	publisher: string;
	kind: Extract<ResearchSourceKind, 'official_company' | 'sec_filing'>;
	retrieved_at: string;
	content: string;
}

export interface PortraitCandidate {
	image_url: string;
	alt_text: string;
	source_url: string;
}

export interface ResearchSourceBundle {
	sources: DiscoveredSource[];
	portraits: PortraitCandidate[];
	warnings: string[];
}

interface ParsedPage {
	source: DiscoveredSource;
	links: Array<{ url: string; label: string }>;
	images: PortraitCandidate[];
}

interface SecSubmissions {
	filings?: {
		recent?: {
			accessionNumber?: unknown[];
			form?: unknown[];
			primaryDocument?: unknown[];
			filingDate?: unknown[];
		};
	};
}

export async function discoverResearchSources(
	company: ResearchCompanyInput,
	now = new Date(),
	fetcher: typeof fetch = globalThis.fetch
): Promise<ResearchSourceBundle> {
	const retrievedAt = now.toISOString().slice(0, 10);
	const warnings: string[] = [];
	const pages: ParsedPage[] = [];
	const userAgent = researchUserAgent();

	if (company.homepageUrl) {
		try {
			const homepage = await fetchCompanyPage(
				company.homepageUrl,
				company.name,
				retrievedAt,
				userAgent,
				fetcher
			);
			pages.push(homepage);
			const candidates = homepage.links
				.filter((link) => isSameSite(homepage.source.url, link.url))
				.map((link) => ({ ...link, score: leadershipLinkScore(link) }))
				.filter((link) => link.score > 0)
				.sort((left, right) => right.score - left.score)
				.slice(0, MAX_COMPANY_PAGES - 1);
			const settled = await Promise.allSettled(
				candidates.map((candidate) =>
					fetchCompanyPage(candidate.url, company.name, retrievedAt, userAgent, fetcher)
				)
			);
			for (const result of settled) {
				if (result.status === 'fulfilled') pages.push(result.value);
				else warnings.push(errorMessage(result.reason));
			}
		} catch (cause) {
			warnings.push(`Company website: ${errorMessage(cause)}`);
		}
	}

	if (company.cik) {
		try {
			const filingUrls = await discoverSecFilingUrls(company.cik, userAgent, fetcher);
			const settled = await Promise.allSettled(
				filingUrls
					.slice(0, MAX_SEC_FILINGS)
					.map((filing) => fetchSecPage(filing.url, filing.title, retrievedAt, userAgent, fetcher))
			);
			for (const result of settled) {
				if (result.status === 'fulfilled') pages.push(result.value);
				else warnings.push(errorMessage(result.reason));
			}
		} catch (cause) {
			warnings.push(`SEC filings: ${errorMessage(cause)}`);
		}
	}

	const sources = [...new Map(pages.map((page) => [page.source.url, page.source])).values()];
	const portraits = [
		...new Map(
			pages
				.flatMap((page) => page.images)
				.filter((image) => image.image_url.startsWith('https://'))
				.map((image) => [image.image_url, image])
		).values()
	]
		.sort((left, right) => portraitScore(right) - portraitScore(left))
		.slice(0, MAX_IMAGE_CANDIDATES);
	return { sources, portraits, warnings: [...new Set(warnings)].slice(0, 20) };
}

async function fetchCompanyPage(
	url: string,
	companyName: string,
	retrievedAt: string,
	userAgent: string,
	fetcher: typeof fetch
): Promise<ParsedPage> {
	const response = await fetchPublicResource(url, {
		accept: 'text/html, text/plain;q=0.8',
		maxBytes: SOURCE_MAX_BYTES,
		timeoutMs: SOURCE_TIMEOUT_MS,
		userAgent,
		fetcher
	});
	if (!isTextContent(response.contentType)) {
		throw new Error(`Company page returned unsupported content type ${response.contentType}`);
	}
	const html = response.body.toString('utf8');
	const finalUrl = response.finalUrl.toString();
	return {
		source: {
			url: finalUrl,
			title: extractTitle(html) || companyName,
			publisher: companyName,
			kind: 'official_company',
			retrieved_at: retrievedAt,
			content: htmlToText(html).slice(0, SOURCE_TEXT_CHARACTERS)
		},
		links: extractLinks(html, response.finalUrl),
		images: extractImages(html, response.finalUrl, finalUrl)
	};
}

async function fetchSecPage(
	url: string,
	title: string,
	retrievedAt: string,
	userAgent: string,
	fetcher: typeof fetch
): Promise<ParsedPage> {
	const response = await fetchPublicResource(url, {
		accept: 'text/html, text/plain;q=0.8',
		maxBytes: SOURCE_MAX_BYTES,
		timeoutMs: SOURCE_TIMEOUT_MS,
		userAgent,
		fetcher
	});
	if (!isTextContent(response.contentType)) {
		throw new Error(`SEC filing returned unsupported content type ${response.contentType}`);
	}
	const html = response.body.toString('utf8');
	const finalUrl = response.finalUrl.toString();
	return {
		source: {
			url: finalUrl,
			title: extractTitle(html) || title,
			publisher: 'U.S. Securities and Exchange Commission',
			kind: 'sec_filing',
			retrieved_at: retrievedAt,
			content: htmlToText(html).slice(0, SOURCE_TEXT_CHARACTERS)
		},
		links: [],
		images: []
	};
}

async function discoverSecFilingUrls(
	cik: string,
	userAgent: string,
	fetcher: typeof fetch
): Promise<Array<{ url: string; title: string }>> {
	const paddedCik = cik.padStart(10, '0');
	const response = await fetchPublicResource(
		`https://data.sec.gov/submissions/CIK${paddedCik}.json`,
		{
			accept: 'application/json',
			maxBytes: SOURCE_MAX_BYTES,
			timeoutMs: SOURCE_TIMEOUT_MS,
			userAgent,
			fetcher
		}
	);
	const submissions = JSON.parse(response.body.toString('utf8')) as SecSubmissions;
	const recent = submissions.filings?.recent;
	if (!recent) return [];
	const rows = Array.from({ length: recent.form?.length ?? 0 }, (_, index) => ({
		form: stringAt(recent.form, index),
		accession: stringAt(recent.accessionNumber, index),
		document: stringAt(recent.primaryDocument, index),
		date: stringAt(recent.filingDate, index),
		index
	}))
		.filter(
			(row) =>
				row.accession &&
				row.document &&
				['DEF 14A', '8-K', '10-K', '20-F', '6-K'].includes(row.form)
		)
		.filter(
			(row, index, candidates) =>
				candidates.findIndex((candidate) => candidate.form === row.form) === index
		)
		.sort(
			(left, right) =>
				filingFormScore(right.form) - filingFormScore(left.form) || left.index - right.index
		)
		.slice(0, MAX_SEC_FILINGS);
	const numericCik = String(Number(paddedCik));
	return rows.map((row) => ({
		url: `https://www.sec.gov/Archives/edgar/data/${numericCik}/${row.accession.replaceAll('-', '')}/${encodeURIComponent(row.document)}`,
		title: `${row.form} filed ${row.date}`
	}));
}

function extractLinks(html: string, baseUrl: URL): Array<{ url: string; label: string }> {
	const links: Array<{ url: string; label: string }> = [];
	const pattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
	for (const match of html.matchAll(pattern)) {
		const href = match[1] ?? match[2] ?? match[3] ?? '';
		try {
			const url = new URL(decodeHtml(href), baseUrl);
			if (!['http:', 'https:'].includes(url.protocol)) continue;
			url.hash = '';
			links.push({ url: url.toString(), label: htmlToText(match[4] ?? '').slice(0, 200) });
		} catch {
			// Ignore malformed links.
		}
	}
	return [...new Map(links.map((link) => [link.url, link])).values()];
}

export function extractImages(html: string, baseUrl: URL, sourceUrl: string): PortraitCandidate[] {
	const output: PortraitCandidate[] = [];
	const addCandidate = (rawUrl: string | null, altText: string) => {
		if (!rawUrl) return;
		try {
			const imageUrl = new URL(decodeHtml(rawUrl), baseUrl);
			if (imageUrl.protocol !== 'https:') return;
			output.push({
				image_url: imageUrl.toString(),
				alt_text: decodeHtml(altText).trim().slice(0, 250),
				source_url: sourceUrl
			});
		} catch {
			// Ignore malformed image URLs.
		}
	};

	for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
		const attributes = match[1] ?? '';
		addCandidate(bestImageAttribute(attributes), attribute(attributes, 'alt') ?? '');
	}

	for (const match of html.matchAll(/<picture\b[^>]*>([\s\S]*?)<\/picture>/gi)) {
		const picture = match[1] ?? '';
		const imageAttributes = /<img\b([^>]*)>/i.exec(picture)?.[1] ?? '';
		const altText = attribute(imageAttributes, 'alt') ?? '';
		const sourceCandidates = [...picture.matchAll(/<source\b([^>]*)>/gi)].flatMap((sourceMatch) =>
			imageAttributeCandidates(sourceMatch[1] ?? '')
		);
		addCandidate(bestImageCandidate(sourceCandidates), altText);
	}

	const openGraphImage = metaContent(html, 'property', 'og:image');
	const openGraphAlt = metaContent(html, 'property', 'og:image:alt') ?? '';
	addCandidate(openGraphImage, openGraphAlt);

	for (const match of html.matchAll(
		/<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi
	)) {
		try {
			collectStructuredImages(JSON.parse(match[1] ?? ''), addCandidate);
		} catch {
			// Ignore malformed structured data.
		}
	}
	return [...new Map(output.map((candidate) => [candidate.image_url, candidate])).values()];
}

function attribute(attributes: string, name: string): string | null {
	const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(
		attributes
	);
	return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

interface ImageCandidate {
	url: string;
	score: number;
}

function bestImageAttribute(attributes: string): string | null {
	return bestImageCandidate(imageAttributeCandidates(attributes));
}

function imageAttributeCandidates(attributes: string): ImageCandidate[] {
	const directAttributes = ['src', 'data-src', 'data-lazy-src', 'data-original'];
	const candidates = directAttributes.flatMap((name) => {
		const value = attribute(attributes, name);
		return value ? [{ url: value, score: 0 }] : [];
	});
	for (const name of ['srcset', 'data-srcset', 'data-lazy-srcset']) {
		const srcset = attribute(attributes, name);
		if (!srcset) continue;
		candidates.push(...parseSrcset(srcset));
	}
	return candidates;
}

function parseSrcset(value: string): ImageCandidate[] {
	return value.split(',').flatMap((entry) => {
		const [url, descriptor = ''] = entry.trim().split(/\s+/, 2);
		if (!url) return [];
		const numeric = Number.parseFloat(descriptor);
		const score = Number.isFinite(numeric)
			? descriptor.endsWith('x')
				? numeric * 1_000
				: numeric
			: 0;
		return [{ url, score }];
	});
}

function bestImageCandidate(candidates: ImageCandidate[]): string | null {
	return [...candidates].sort((left, right) => right.score - left.score)[0]?.url ?? null;
}

function metaContent(html: string, key: string, value: string): string | null {
	for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
		const attributes = match[1] ?? '';
		if (attribute(attributes, key)?.toLocaleLowerCase('en-US') === value) {
			return attribute(attributes, 'content');
		}
	}
	return null;
}

function collectStructuredImages(
	value: unknown,
	addCandidate: (url: string | null, altText: string) => void,
	inheritedName = ''
): void {
	if (Array.isArray(value)) {
		for (const item of value) collectStructuredImages(item, addCandidate, inheritedName);
		return;
	}
	if (!value || typeof value !== 'object') return;
	const record = value as Record<string, unknown>;
	const name = typeof record.name === 'string' ? record.name : inheritedName;
	const image = record.image;
	if (typeof image === 'string') addCandidate(image, name);
	else if (Array.isArray(image)) {
		for (const item of image) {
			if (typeof item === 'string') addCandidate(item, name);
			else collectStructuredImages(item, addCandidate, name);
		}
	} else if (image && typeof image === 'object') {
		const imageRecord = image as Record<string, unknown>;
		const url =
			typeof imageRecord.url === 'string'
				? imageRecord.url
				: typeof imageRecord.contentUrl === 'string'
					? imageRecord.contentUrl
					: null;
		addCandidate(url, typeof imageRecord.caption === 'string' ? imageRecord.caption : name);
	}
	for (const nested of Object.values(record)) {
		if (nested !== image) collectStructuredImages(nested, addCandidate, name);
	}
}

function extractTitle(html: string): string {
	const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	return match ? htmlToText(match[1]!).slice(0, 300) : '';
}

export function htmlToText(html: string): string {
	return decodeHtml(
		html
			.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
			.replace(/<!--[\s\S]*?-->/g, ' ')
			.replace(/<\/?(?:p|div|section|article|header|footer|main|li|tr|h[1-6]|br)\b[^>]*>/gi, '\n')
			.replace(/<[^>]+>/g, ' ')
	)
		.replace(/\r/g, '')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function decodeHtml(value: string): string {
	return value
		.replace(/&nbsp;|&#160;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
			String.fromCodePoint(Number.parseInt(code, 16))
		);
}

function leadershipLinkScore(link: { url: string; label: string }): number {
	const value = `${link.label} ${link.url}`.toLocaleLowerCase('en-US');
	let score = 0;
	for (const token of ['leadership', 'management', 'executive', 'team', 'governance', 'people']) {
		if (value.includes(token)) score += token === 'leadership' ? 8 : 4;
	}
	for (const token of ['privacy', 'terms', 'careers', 'products', 'contact', 'login']) {
		if (value.includes(token)) score -= 5;
	}
	return score;
}

function portraitScore(candidate: PortraitCandidate): number {
	const value = `${candidate.alt_text} ${candidate.image_url}`.toLocaleLowerCase('en-US');
	let score = candidate.alt_text ? 4 : 0;
	for (const token of ['headshot', 'portrait', 'leadership', 'management', 'executive', 'bio']) {
		if (value.includes(token)) score += 3;
	}
	for (const token of ['logo', 'icon', 'banner', 'hero', 'favicon', 'sprite']) {
		if (value.includes(token)) score -= 8;
	}
	return score;
}

function filingFormScore(form: string): number {
	return { 'DEF 14A': 5, '8-K': 4, '10-K': 3, '20-F': 2, '6-K': 1 }[form] ?? 0;
}

function stringAt(values: unknown[] | undefined, index: number): string {
	const value = values?.[index];
	return typeof value === 'string' ? value : '';
}

function isSameSite(left: string, right: string): boolean {
	try {
		const leftHost = new URL(left).hostname.replace(/^www\./, '');
		const rightHost = new URL(right).hostname.replace(/^www\./, '');
		return (
			leftHost === rightHost ||
			leftHost.endsWith(`.${rightHost}`) ||
			rightHost.endsWith(`.${leftHost}`)
		);
	} catch {
		return false;
	}
}

function isTextContent(contentType: string): boolean {
	return (
		contentType === '' ||
		contentType === 'text/html' ||
		contentType === 'text/plain' ||
		contentType === 'application/xhtml+xml'
	);
}

function researchUserAgent(): string {
	const origin = process.env.ORIGIN?.trim() || 'https://executive-arena.invalid';
	return `ExecutiveArena/1.0 (${origin})`;
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
