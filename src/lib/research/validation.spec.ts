import { describe, expect, it } from 'vitest';
import type { ExecutiveProfile, ResearchSource } from './schemas';
import { collectProfileSources } from './validation';

const source: ResearchSource = {
	url: 'https://example.com/source',
	title: 'Source',
	publisher: 'Example',
	retrieved_at: '2026-07-26'
};

function profile(): ExecutiveProfile {
	return {
		schema_version: 3,
		issuer_key: 'cik:0000000001',
		canonical_ticker: 'EX',
		company_name: 'Example Company',
		leadership_as_of: '2026-07-26',
		leaders: [
			{
				name: 'Ada Example',
				title: 'CEO',
				role_kind: 'ceo',
				is_interim: false,
				summary: Array.from({ length: 80 }, () => 'word').join(' '),
				summary_sources: [source],
				role_source: source,
				portraits: [
					{
						image_url: 'https://example.com/portrait.jpg',
						alt_text: 'Portrait of Ada Example',
						is_real_person: true,
						source
					}
				],
				facts: [{ category: 'career', value: 'Led the company.', sources: [source] }]
			}
		]
	};
}

describe('profile validation helpers', () => {
	it('deduplicates profile sources by URL', () => {
		expect(collectProfileSources(profile())).toEqual([source]);
	});
});
