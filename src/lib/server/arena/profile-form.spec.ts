import { describe, expect, it } from 'vitest';
import { parseExecutiveProfileForm, profileFormErrors } from './profile-form';

const identity = {
	issuerKey: 'cik:0000000001',
	canonicalTicker: 'EXMP',
	companyName: 'Example Corporation'
};

describe('executive profile form parser', () => {
	it('builds a complete schema-version-3 profile from named form fields', () => {
		const result = parseExecutiveProfileForm(validForm(), identity);

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toMatchObject({
			schema_version: 3,
			issuer_key: identity.issuerKey,
			canonical_ticker: identity.canonicalTicker,
			company_name: identity.companyName,
			leaders: [
				{
					name: 'Ada Example',
					role_kind: 'ceo',
					is_interim: false,
					summary_sources: [expect.objectContaining({ url: 'https://example.com/summary' })],
					portraits: [expect.objectContaining({ image_url: 'https://example.com/ada.jpg' })],
					facts: [expect.objectContaining({ category: 'career' })]
				}
			]
		});
	});

	it('maps nested schema errors back to the structured form field path', () => {
		const form = validForm();
		form.set('leaders.0.summary', 'Too short');
		form.set('leaders.0.roleSource.url', 'not a URL');
		const result = parseExecutiveProfileForm(form, identity);

		expect(result.success).toBe(false);
		if (result.success) return;
		const errors = profileFormErrors(result.error);
		expect(errors['leaders.0.summary']).toContain('50-100 words');
		expect(errors['leaders.0.roleSource.url']).toContain('URL');
	});
});

function validForm(): FormData {
	const form = new FormData();
	form.set('leadershipAsOf', '2026-07-27');
	form.set('leaders.0.name', 'Ada Example');
	form.set('leaders.0.title', 'Chief Executive Officer');
	form.set('leaders.0.roleKind', 'ceo');
	form.set(
		'leaders.0.summary',
		Array.from({ length: 60 }, (_, index) => `word${index + 1}`).join(' ')
	);
	appendSource(form, 'leaders.0.roleSource', 'https://example.com/role');
	appendSource(form, 'leaders.0.summarySources.0', 'https://example.com/summary');
	form.set('leaders.0.portraits.0.imageUrl', 'https://example.com/ada.jpg');
	form.set('leaders.0.portraits.0.altText', 'Portrait of Ada Example');
	appendSource(form, 'leaders.0.portraits.0.source', 'https://example.com/portrait');
	form.set('leaders.0.facts.0.category', 'career');
	form.set(
		'leaders.0.facts.0.value',
		'Ada Example led the company before becoming chief executive.'
	);
	appendSource(form, 'leaders.0.facts.0.sources.0', 'https://example.com/fact');
	return form;
}

function appendSource(form: FormData, prefix: string, url: string) {
	form.set(`${prefix}.url`, url);
	form.set(`${prefix}.title`, 'Example source');
	form.set(`${prefix}.publisher`, 'Example Corporation');
	form.set(`${prefix}.retrievedAt`, '2026-07-27');
}
