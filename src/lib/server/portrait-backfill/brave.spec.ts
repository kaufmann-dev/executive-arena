import { describe, expect, it, vi } from 'vitest';
import { BraveImageSearchError, portraitSearchQuery, searchBravePortraits } from './brave';

describe('Brave portrait search', () => {
	it('builds a precise executive query', () => {
		expect(
			portraitSearchQuery({
				personName: 'Thomas Tarala',
				title: 'Chief Executive Officer',
				companyName: 'AiRWA Inc. Common Stock',
				ticker: 'YYAI'
			})
		).toBe('Thomas Tarala AiRWA YYAI CEO -stock -logo -chart -analysis');
	});

	it('uses a concise non-CEO title and strips class and legal suffixes', () => {
		expect(
			portraitSearchQuery({
				personName: '  Ada “Augusta” Lovelace ',
				title: 'President and Director',
				companyName: 'Analytical Engines, Inc. Class B Ordinary Shares',
				ticker: 'ADA'
			})
		).toBe('Ada Augusta Lovelace Analytical Engines ADA President -stock -logo -chart -analysis');
	});

	it('requests strict worldwide results and returns the first distinct usable candidates', async () => {
		const fetcher = vi.fn<typeof globalThis.fetch>();
		fetcher.mockResolvedValue(
			Response.json({
				type: 'images',
				query: { original: 'Ada' },
				results: [
					result({
						originalUrl: 'https://media.example.com/ada.jpg',
						thumbnailUrl: 'https://imgs.search.brave.com/ada',
						thumbnailWidth: 200,
						thumbnailHeight: 150
					}),
					result({
						originalUrl: 'https://media.example.com/ada.jpg',
						thumbnailUrl: 'https://imgs.search.brave.com/duplicate',
						thumbnailWidth: 300,
						thumbnailHeight: 200
					}),
					result({
						originalUrl: 'https://media.example.com/tiny.jpg',
						thumbnailUrl: 'https://imgs.search.brave.com/tiny',
						thumbnailWidth: 90,
						thumbnailHeight: 90
					}),
					result({
						originalUrl: 'https://media.example.com/untrusted-thumbnail.jpg',
						thumbnailUrl: 'https://cdn.example.com/thumbnail.jpg',
						thumbnailWidth: 300,
						thumbnailHeight: 200
					})
				],
				extra: { might_be_offensive: false }
			})
		);

		await expect(searchBravePortraits('Ada', { apiKey: 'secret', fetcher })).resolves.toEqual([
			expect.objectContaining({
				originalUrl: 'https://media.example.com/ada.jpg',
				thumbnailUrl: 'https://imgs.search.brave.com/ada'
			})
		]);
		const [requestedUrl, init] = fetcher.mock.calls[0]!;
		expect(requestedUrl).toBeInstanceOf(URL);
		expect((requestedUrl as URL).searchParams.get('country')).toBe('ALL');
		expect((requestedUrl as URL).searchParams.get('count')).toBe('20');
		expect((requestedUrl as URL).searchParams.get('safesearch')).toBe('strict');
		expect((requestedUrl as URL).searchParams.get('spellcheck')).toBe('false');
		expect(init?.headers).toEqual(expect.objectContaining({ 'x-subscription-token': 'secret' }));
	});

	it('reports missing credentials and rate-limit reset metadata without exposing a token', async () => {
		await expect(searchBravePortraits('Ada', { apiKey: null })).rejects.toMatchObject({
			message: 'BRAVE_SEARCH_API_KEY is not configured for portrait backfill',
			status: null
		});
		const fetcher = vi.fn<typeof globalThis.fetch>();
		fetcher.mockResolvedValue(
			new Response(null, {
				status: 429,
				headers: { 'x-ratelimit-reset': '2, 1000' }
			})
		);

		await expect(searchBravePortraits('Ada', { apiKey: 'secret', fetcher })).rejects.toEqual(
			expect.objectContaining<Partial<BraveImageSearchError>>({
				message: 'Brave Image Search rate limit reached',
				status: 429,
				retryAfterSeconds: 2
			})
		);
	});
});

function result(input: {
	originalUrl: string;
	thumbnailUrl: string;
	thumbnailWidth: number;
	thumbnailHeight: number;
}) {
	return {
		type: 'image_result',
		title: 'Ada Lovelace portrait',
		url: 'https://example.com/leadership/ada',
		source: 'example.com',
		confidence: 'high',
		thumbnail: {
			src: input.thumbnailUrl,
			width: input.thumbnailWidth,
			height: input.thumbnailHeight
		},
		properties: {
			url: input.originalUrl,
			width: 1200,
			height: 1600
		}
	};
}
