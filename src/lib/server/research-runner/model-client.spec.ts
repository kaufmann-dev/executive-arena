import { describe, expect, it } from 'vitest';
import { buildResearchMessages, requestExecutiveResearch } from './model-client';

describe('research model prompt', () => {
	it('includes exact company identity, evidence, and portrait candidates', () => {
		const messages = buildResearchMessages(
			{
				issuerKey: 'cik:0000000001',
				cik: '0000000001',
				canonicalTicker: 'TEST',
				name: 'Test Company',
				description: 'A test company.',
				homepageUrl: 'https://example.com',
				universeAsOf: '2026-07-26'
			},
			{
				sources: [
					{
						url: 'https://example.com/leadership',
						title: 'Leadership',
						publisher: 'Test Company',
						kind: 'official_company',
						retrieved_at: '2026-07-26',
						content: 'Jane Doe is CEO.'
					}
				],
				portraits: [
					{
						image_url: 'https://example.com/jane.jpg',
						alt_text: 'Jane Doe',
						source_url: 'https://example.com/leadership'
					}
				],
				warnings: []
			},
			new Date('2026-07-26T12:00:00Z')
		);

		expect(messages[1].content).toContain('"issuerKey":"cik:0000000001"');
		expect(messages[1].content).toContain('https://example.com/leadership');
		expect(messages[1].content).toContain('https://example.com/jane.jpg');
		expect(messages[1].content).toContain('"schema_version": 2');
		expect(messages[1].content).toContain('"portraits":');
	});

	it('rejects model citations that were not in the supplied evidence', async () => {
		const modelResponse = {
			schema_version: 2,
			status: 'needs_review',
			issuer_key: 'cik:0000000001',
			canonical_ticker: 'TEST',
			company_name: 'Test Company',
			reasons: ['Evidence is incomplete.'],
			candidate_sources: [
				{
					url: 'https://invented.example/source',
					title: 'Invented',
					publisher: 'Invented',
					retrieved_at: '2026-07-26',
					kind: 'reputable_news'
				}
			]
		};

		await expect(
			requestExecutiveResearch(
				{
					baseUrl: 'https://inference.example/v1',
					model: 'test-model',
					apiKey: 'secret-key',
					requestTimeoutMs: 10_000,
					maxOutputTokens: 2_000,
					userId: '63c06829-0428-4964-a083-91d43f019088'
				},
				{
					issuerKey: 'cik:0000000001',
					cik: '0000000001',
					canonicalTicker: 'TEST',
					name: 'Test Company',
					description: 'A test company.',
					homepageUrl: 'https://example.com',
					universeAsOf: '2026-07-26'
				},
				{ sources: [], portraits: [], warnings: [] },
				new Date('2026-07-26T12:00:00Z'),
				async () =>
					Response.json({
						choices: [
							{
								finish_reason: 'stop',
								message: { content: JSON.stringify(modelResponse) }
							}
						]
					})
			)
		).rejects.toThrow('unsupplied source');
	});
});
