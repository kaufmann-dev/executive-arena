import { describe, expect, it } from 'vitest';
import {
	countWords,
	executiveProfileSchema,
	type ExecutiveProfile,
	type ResearchSource
} from './schemas';

const officialSource: ResearchSource = {
	url: 'https://example.com/leadership',
	title: 'Leadership',
	publisher: 'Example Company',
	retrieved_at: '2026-07-26'
};

function words(count: number): string {
	return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(' ');
}

function validProfile(): ExecutiveProfile {
	return {
		schema_version: 3,
		issuer_key: 'cik:0000000001',
		canonical_ticker: 'EX',
		company_name: 'Example Company',
		leadership_as_of: '2026-07-26',
		leaders: [
			{
				name: 'Ada Example',
				title: 'Chief Executive Officer',
				role_kind: 'ceo',
				is_interim: false,
				summary: words(80),
				summary_sources: [officialSource],
				role_source: officialSource,
				portraits: [
					{
						image_url: 'https://example.com/ada.jpg',
						alt_text: 'Portrait of Ada Example',
						is_real_person: true,
						source: officialSource
					}
				],
				facts: [
					{
						category: 'education',
						value: 'Attended Example University.',
						sources: [officialSource]
					}
				]
			}
		]
	};
}

describe('executive profile schema', () => {
	it('accepts a fully sourced CEO profile with an 80-word summary', () => {
		const profile = validProfile();

		expect(executiveProfileSchema.parse(profile)).toEqual(profile);
		expect(countWords(profile.leaders[0]!.summary)).toBe(80);
	});

	it('accepts one to three ordered portraits and rejects duplicate or excess images', () => {
		const profile = validProfile();
		const first = profile.leaders[0]!.portraits[0]!;
		profile.leaders[0]!.portraits.push(
			{ ...first, image_url: 'https://example.com/ada-2.jpg' },
			{ ...first, image_url: 'https://example.com/ada-3.jpg' }
		);
		expect(executiveProfileSchema.safeParse(profile).success).toBe(true);

		profile.leaders[0]!.portraits.push({
			...first,
			image_url: 'https://example.com/ada-4.jpg'
		});
		expect(executiveProfileSchema.safeParse(profile).success).toBe(false);

		profile.leaders[0]!.portraits = [first, { ...first }];
		const duplicate = executiveProfileSchema.safeParse(profile);
		expect(duplicate.success).toBe(false);
		expect(
			duplicate.success ? '' : duplicate.error.issues.map((issue) => issue.message).join(' ')
		).toContain('may appear only once');
	});

	it('rejects summaries outside the 50–100 word boundary', () => {
		const short = validProfile();
		short.leaders[0]!.summary = words(49);
		const long = validProfile();
		long.leaders[0]!.summary = words(101);

		expect(executiveProfileSchema.safeParse(short).success).toBe(false);
		expect(executiveProfileSchema.safeParse(long).success).toBe(false);
	});

	it.each(['ceo', 'president'] as const)(
		'accepts a relevant HTTP source for a %s role',
		(roleKind) => {
			const profile = validProfile();
			profile.leaders[0]!.role_kind = roleKind;
			profile.leaders[0]!.role_source = {
				...officialSource,
				url: 'https://news.example.com/profile'
			};

			const result = executiveProfileSchema.safeParse(profile);

			expect(result.success).toBe(true);
		}
	);

	it('requires all members of a multiple-person slate to be co-CEOs', () => {
		const profile = validProfile();
		profile.leaders.push({
			...profile.leaders[0]!,
			name: 'Grace Example',
			portraits: [
				{
					...profile.leaders[0]!.portraits[0]!,
					image_url: 'https://example.com/grace.jpg',
					alt_text: 'Portrait of Grace Example'
				}
			]
		});

		expect(executiveProfileSchema.safeParse(profile).success).toBe(false);
		profile.leaders[0]!.role_kind = 'co_ceo';
		profile.leaders[1]!.role_kind = 'co_ceo';
		expect(executiveProfileSchema.safeParse(profile).success).toBe(true);
	});

	it('rejects unknown fields and uncited facts', () => {
		const profile = validProfile() as ExecutiveProfile & { unsupported?: string };
		profile.unsupported = 'not allowed';
		profile.leaders[0]!.facts[0]!.sources = [];

		const result = executiveProfileSchema.safeParse(profile);

		expect(result.success).toBe(false);
		expect(result.success ? [] : result.error.issues).toHaveLength(2);
	});
});
