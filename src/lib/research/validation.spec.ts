import { describe, expect, it } from 'vitest';
import type { ExecutiveProfile, ResearchSource } from './schemas';
import type { ResearchTask } from './tasks';
import {
	collectProfileSources,
	validateExecutiveProfile,
	validateProfileCoverage,
	validateProfileForTask
} from './validation';

const source: ResearchSource = {
	url: 'https://example.com/source',
	title: 'Source',
	publisher: 'Example',
	retrieved_at: '2026-07-26',
	kind: 'official_company'
};

const task: ResearchTask = {
	issuer_key: 'cik:0000000001',
	canonical_ticker: 'EX',
	company_name: 'Example Company',
	description: '',
	homepage_url: null,
	cik: '0000000001'
};

function profile(): ExecutiveProfile {
	return {
		schema_version: 1,
		issuer_key: task.issuer_key,
		canonical_ticker: task.canonical_ticker,
		company_name: task.company_name,
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
				portrait: {
					image_url: 'https://example.com/portrait.jpg',
					alt_text: 'Portrait of Ada Example',
					is_real_person: true,
					source
				},
				facts: [{ category: 'career', value: 'Led the company.', sources: [source] }]
			}
		]
	};
}

describe('profile validation helpers', () => {
	it('returns CLI-ready errors rather than throwing', () => {
		const result = validateExecutiveProfile({ schema_version: 1 });

		expect(result.success).toBe(false);
		expect(result.success ? [] : result.errors).toContain(
			'issuer_key: Invalid input: expected string, received undefined'
		);
	});

	it('checks immutable task identity fields', () => {
		const input = profile();
		input.canonical_ticker = 'WRONG';

		const result = validateProfileForTask(input, task);

		expect(result.success).toBe(false);
		expect(result.success ? [] : result.errors).toEqual([
			'canonical_ticker: expected "EX", received "WRONG"'
		]);
	});

	it('deduplicates profile sources by URL', () => {
		expect(collectProfileSources(profile())).toEqual([source]);
	});

	it('proves exact task-manifest coverage and reports coverage defects', () => {
		const secondTask: ResearchTask = {
			...task,
			issuer_key: 'cik:0000000002',
			canonical_ticker: 'TWO',
			company_name: 'Second Company',
			cik: '0000000002'
		};
		const secondProfile = {
			...profile(),
			issuer_key: secondTask.issuer_key,
			canonical_ticker: secondTask.canonical_ticker,
			company_name: secondTask.company_name
		};

		expect(
			validateProfileCoverage(
				[
					{ label: 'one.json', value: profile() },
					{ label: 'two.json', value: secondProfile }
				],
				[task, secondTask]
			)
		).toMatchObject({
			exact: true,
			expected: 2,
			valid: 2,
			invalid: [],
			needsReview: [],
			missing: [],
			duplicates: [],
			unexpected: []
		});

		const unexpected = {
			...profile(),
			issuer_key: 'cik:9999999999',
			canonical_ticker: 'NEW',
			company_name: 'Unexpected Company'
		};
		const result = validateProfileCoverage(
			[
				{ label: 'one.json', value: profile() },
				{ label: 'duplicate.json', value: profile() },
				{ label: 'unexpected.json', value: unexpected },
				{ label: 'invalid.json', value: { schema_version: 1 } }
			],
			[task, secondTask]
		);

		expect(result).toMatchObject({
			exact: false,
			expected: 2,
			valid: 0,
			missing: [secondTask.issuer_key]
		});
		expect(result.invalid).toHaveLength(1);
		expect(result.duplicates).toHaveLength(1);
		expect(result.unexpected).toHaveLength(1);
	});

	it('treats a structured research blocker as unresolved coverage without calling it missing', () => {
		const result = validateProfileCoverage(
			[
				{
					label: 'needs-review.json',
					value: {
						schema_version: 1,
						status: 'needs_review',
						issuer_key: task.issuer_key,
						canonical_ticker: task.canonical_ticker,
						company_name: task.company_name,
						reasons: ['No official company or SEC source identifies a current top executive.'],
						candidate_sources: []
					}
				}
			],
			[task]
		);

		expect(result).toMatchObject({
			exact: false,
			expected: 1,
			valid: 0,
			invalid: [],
			missing: [],
			duplicates: [],
			unexpected: []
		});
		expect(result.needsReview).toEqual([
			{
				label: 'needs-review.json',
				errors: [
					'manual review required: No official company or SEC source identifies a current top executive.'
				]
			}
		]);
	});
});
