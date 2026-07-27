import { describe, expect, it } from 'vitest';
import {
	CompanyClaimError,
	companyClaimExpiry,
	companyClaimTokenMatches,
	createCompanyClaimToken,
	hashCompanyClaimToken,
	parseCompanyClaimToken
} from './research-claims';

describe('company research claim tokens', () => {
	it('creates distinct 256-bit opaque bearer tokens and stable hashes', () => {
		const first = createCompanyClaimToken();
		const second = createCompanyClaimToken();

		expect(first).toMatch(/^eac_[A-Za-z0-9_-]{43}$/);
		expect(second).toMatch(/^eac_[A-Za-z0-9_-]{43}$/);
		expect(second).not.toBe(first);
		expect(hashCompanyClaimToken(first)).toMatch(/^[a-f0-9]{64}$/);
		expect(parseCompanyClaimToken(first)).toBe(hashCompanyClaimToken(first));
		expect(
			companyClaimTokenMatches(hashCompanyClaimToken(first), hashCompanyClaimToken(first))
		).toBe(true);
		expect(
			companyClaimTokenMatches(hashCompanyClaimToken(first), hashCompanyClaimToken(second))
		).toBe(false);
	});

	it('uses a fixed 45-minute lease and rejects malformed tokens', () => {
		const now = new Date('2026-07-27T12:00:00.000Z');

		expect(companyClaimExpiry(now).toISOString()).toBe('2026-07-27T12:45:00.000Z');
		expect(parseCompanyClaimToken(undefined)).toBeNull();
		expect(() => parseCompanyClaimToken('not-a-token')).toThrowError(
			expect.objectContaining<Partial<CompanyClaimError>>({ code: 'claim_token_invalid' })
		);
	});
});
