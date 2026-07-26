import { describe, expect, it } from 'vitest';
import { extractImages, htmlToText } from './source-discovery';

describe('research source discovery', () => {
	it('extracts readable text while removing executable and styling content', () => {
		const text = htmlToText(`
			<html>
				<head><style>.hidden { display: none }</style><script>alert("no")</script></head>
				<body><h1>Leadership &amp; governance</h1><p>Jane Doe<br>Chief Executive Officer</p></body>
			</html>
		`);

		expect(text).toContain('Leadership & governance');
		expect(text).toContain('Jane Doe');
		expect(text).not.toContain('alert');
		expect(text).not.toContain('display: none');
	});

	it('extracts and deduplicates responsive, lazy, Open Graph, and structured portrait images', () => {
		const candidates = extractImages(
			`
				<meta property="og:image" content="/images/open-graph.jpg">
				<meta property="og:image:alt" content="Jane Doe">
				<img
					src="/images/jane-small.jpg"
					srcset="/images/jane-medium.jpg 600w, /images/jane-large.jpg 1200w"
					alt="Jane Doe, Chief Executive Officer"
				>
				<picture>
					<source data-srcset="/images/jane-team-small.webp 400w, /images/jane-team.webp 900w">
					<img data-lazy-src="/images/jane-team-fallback.jpg" alt="Jane Doe">
				</picture>
				<script type="application/ld+json">
					{"@type":"Person","name":"Jane Doe","image":{"contentUrl":"/images/jane-profile.jpg"}}
				</script>
			`,
			new URL('https://example.com/leadership'),
			'https://example.com/leadership'
		);

		expect(candidates.map(({ image_url }) => image_url)).toEqual(
			expect.arrayContaining([
				'https://example.com/images/jane-large.jpg',
				'https://example.com/images/jane-team.webp',
				'https://example.com/images/open-graph.jpg',
				'https://example.com/images/jane-profile.jpg'
			])
		);
		expect(new Set(candidates.map(({ image_url }) => image_url)).size).toBe(candidates.length);
	});
});
