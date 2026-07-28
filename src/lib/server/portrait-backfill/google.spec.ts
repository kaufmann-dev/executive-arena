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
		).toBe('Cheung Lui - CEO of 707 Cayman (JEM)');
	});

	it('normalizes quoted terms and non-CEO roles without exact-match operators', () => {
		expect(
			portraitSearchQuery({
				personName: '"Thomas Tarala"',
				title: 'Executive Chairman',
				companyName: 'AiRWA Inc. Common Stock',
				ticker: 'YYAI'
			})
		).toBe('Thomas Tarala - Executive Chair of AiRWA (YYAI)');
	});

	it('removes a class and common-shares suffix before shortening the legal name', () => {
		expect(
			portraitSearchQuery({
				personName: 'Li Guo',
				title: 'Chief Executive Officer',
				companyName: 'AIOS Tech Inc. Class A Common Shares',
				ticker: 'AIOS'
			})
		).toBe('Li Guo - CEO of AIOS Tech (AIOS)');
	});

	it('creates a Google Images URL', () => {
		const query = 'Cheung Lui - CEO of 707 Cayman (JEM)';
		const url = new URL(googleImageSearchUrl(query));

		expect(url.origin).toBe('https://www.google.com');
		expect(url.pathname).toBe('/search');
		expect(url.searchParams.get('tbm')).toBe('isch');
		expect(url.searchParams.get('q')).toBe(query);
	});
});
