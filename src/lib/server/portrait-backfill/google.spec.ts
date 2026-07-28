import { describe, expect, it } from 'vitest';
import { googleImageSearchUrl, portraitSearchQuery } from './google';

describe('manual portrait search', () => {
	it('builds an unquoted query with the shortened company name and ticker', () => {
		expect(
			portraitSearchQuery({
				personName: 'Cheung Lui',
				title: 'Chief Executive Officer',
				companyName: '707 Cayman Holdings Limited Ordinary Shares',
				ticker: 'JEM'
			})
		).toBe('Cheung Lui 707 Cayman JEM CEO -site:people.equilar.com');
	});

	it('normalizes quoted terms and non-CEO roles without exact-match operators', () => {
		expect(
			portraitSearchQuery({
				personName: '"Thomas Tarala"',
				title: 'Executive Chairman',
				companyName: 'AiRWA Inc. Common Stock',
				ticker: 'YYAI'
			})
		).toBe('Thomas Tarala AiRWA YYAI Executive Chair -site:people.equilar.com');
	});

	it('creates a Google Images URL', () => {
		const query = 'Cheung Lui 707 Cayman JEM CEO -site:people.equilar.com';
		const url = new URL(googleImageSearchUrl(query));

		expect(url.origin).toBe('https://www.google.com');
		expect(url.pathname).toBe('/search');
		expect(url.searchParams.get('tbm')).toBe('isch');
		expect(url.searchParams.get('q')).toBe(query);
	});
});
