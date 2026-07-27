import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const COMPANY_CLAIM_DURATION_MS = 45 * 60 * 1_000;
export const MAX_COMPANY_CLAIM_BATCH_SIZE = 10;

const CLAIM_TOKEN_PREFIX = 'eac_';
const CLAIM_TOKEN_PATTERN = /^eac_[A-Za-z0-9_-]{43}$/;

export type CompanyClaimErrorCode = 'claim_required' | 'claim_token_invalid' | 'claim_expired';

export class CompanyClaimError extends Error {
	constructor(
		readonly code: CompanyClaimErrorCode,
		message: string
	) {
		super(message);
	}
}

export interface ProfilePublicationClaim {
	companyId: string;
	tokenHash: string | null;
}

export function createCompanyClaimToken(): string {
	return `${CLAIM_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashCompanyClaimToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function parseCompanyClaimToken(token: string | undefined): string | null {
	if (token === undefined) return null;
	if (!CLAIM_TOKEN_PATTERN.test(token)) {
		throw new CompanyClaimError('claim_token_invalid', 'The company claim token is invalid');
	}
	return hashCompanyClaimToken(token);
}

export function companyClaimTokenMatches(storedHash: string, candidateHash: string): boolean {
	const stored = Buffer.from(storedHash, 'hex');
	const candidate = Buffer.from(candidateHash, 'hex');
	return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

export function companyClaimExpiry(now: Date): Date {
	return new Date(now.getTime() + COMPANY_CLAIM_DURATION_MS);
}
