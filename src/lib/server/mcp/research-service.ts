import { and, asc, desc, eq, gt, ilike, lte, notExists, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { importCompanyProfile } from '$lib/server/arena/admin-service';
import { resolvedCompanyReadinessStatus } from '$lib/server/readiness';
import {
	cohortState,
	company,
	executiveResearchClaim,
	leadershipSlate,
	massiveUniverseSync,
	researchSnapshot
} from '$lib/server/db/schema';
import type { ExecutiveProfile } from '$lib/research/schemas';
import { getCompanyProfileDocument } from '$lib/server/arena/read-model';
import { profilePayloadHash } from '$lib/server/research-import/drizzle-repository';
import { createDatabaseResearchImportService } from '$lib/server/research-import';
import {
	logPortraitDiagnostic,
	parseExecutiveProfileForPublication
} from '$lib/server/research-import/service';
import {
	CompanyClaimError,
	companyClaimExpiry,
	companyClaimTokenMatches,
	createCompanyClaimToken,
	hashCompanyClaimToken,
	MAX_COMPANY_CLAIM_BATCH_SIZE,
	parseCompanyClaimToken
} from '$lib/server/research-claims';
import { activeCompanyClaimExists } from '$lib/server/research-claim-query';
import type { AuthenticatedMcpApiKey } from './api-keys';

export type McpCompanyStatus = 'all' | 'not_ready' | 'ready' | 'excluded';

export interface ListResearchCompaniesInput {
	status: McpCompanyStatus;
	query?: string;
	cursor?: string;
	limit: number;
}

export interface ClaimResearchCompaniesInput {
	limit: number;
}

export class McpResearchError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
	}
}

export async function getCohortStatus(now = new Date()) {
	const readinessStatus = resolvedCompanyReadinessStatus();
	const [counts] = await db
		.select({
			included: sql<number>`count(*) filter (where ${company.included})::int`,
			ready: sql<number>`count(*) filter (where ${company.included} and ${readinessStatus} = 'ready')::int`,
			notReady: sql<number>`count(*) filter (where ${company.included} and ${readinessStatus} = 'not_ready')::int`,
			excluded: sql<number>`count(*) filter (where not ${company.included})::int`,
			claimed: sql<number>`count(*) filter (
				where ${company.included}
					and ${readinessStatus} = 'not_ready'
					and ${activeCompanyClaimExists(now)}
			)::int`
		})
		.from(company);
	const [universe] = await db
		.select({ asOfDate: massiveUniverseSync.asOf })
		.from(massiveUniverseSync)
		.orderBy(desc(massiveUniverseSync.asOf))
		.limit(1);
	const [cohort] = await db.select().from(cohortState).limit(1);

	return {
		included: counts?.included ?? 0,
		ready: counts?.ready ?? 0,
		notReady: counts?.notReady ?? 0,
		excluded: counts?.excluded ?? 0,
		claimed: counts?.claimed ?? 0,
		available: Math.max(0, (counts?.notReady ?? 0) - (counts?.claimed ?? 0)),
		universeAsOf: universe?.asOfDate.toISOString().slice(0, 10) ?? null,
		cohortRevision: cohort?.revision ?? 1,
		cohortFrozenAt: cohort?.frozenAt?.toISOString() ?? null
	};
}

export async function freezeCohort(now = new Date()) {
	const result = await createDatabaseResearchImportService(db, { now: () => now }).freeze();
	return {
		includedCount: result.includedCount,
		revision: result.revision,
		frozenAt: result.frozenAt.toISOString(),
		alreadyFrozen: result.alreadyFrozen
	};
}

export async function listCompanies(input: ListResearchCompaniesInput, now = new Date()) {
	const cursor = input.cursor ? decodeCompanyCursor(input.cursor) : null;
	const search = input.query?.trim().slice(0, 100);
	const readinessStatus = resolvedCompanyReadinessStatus();
	const normalizedName = sql<string>`lower(${company.name})`;
	const statusFilter =
		input.status === 'not_ready'
			? and(eq(company.included, true), sql`${readinessStatus} = 'not_ready'`)
			: input.status === 'ready'
				? and(eq(company.included, true), sql`${readinessStatus} = 'ready'`)
				: input.status === 'excluded'
					? sql`${readinessStatus} = 'excluded'`
					: undefined;
	const cursorFilter = cursor
		? or(
				gt(normalizedName, cursor.name),
				and(eq(normalizedName, cursor.name), gt(company.id, cursor.id))
			)
		: undefined;

	const rows = await db
		.select({
			id: company.id,
			issuerKey: company.issuerKey,
			cik: company.cik,
			ticker: company.canonicalTicker,
			name: company.name,
			included: company.included,
			readinessStatus: readinessStatus,
			claimExpiresAt: executiveResearchClaim.expiresAt
		})
		.from(company)
		.leftJoin(
			executiveResearchClaim,
			and(
				eq(executiveResearchClaim.companyId, company.id),
				gt(executiveResearchClaim.expiresAt, now)
			)
		)
		.where(
			and(
				statusFilter,
				search
					? or(ilike(company.name, `%${search}%`), ilike(company.canonicalTicker, `%${search}%`))
					: undefined,
				cursorFilter
			)
		)
		.orderBy(asc(normalizedName), asc(company.id))
		.limit(input.limit + 1);
	const hasMore = rows.length > input.limit;
	const items = rows.slice(0, input.limit).map((row) => ({
		companyId: row.id,
		issuerKey: row.issuerKey,
		cik: row.cik,
		ticker: row.ticker,
		name: row.name,
		included: row.included,
		status: row.included ? row.readinessStatus : ('excluded' as const),
		claim: row.claimExpiresAt ? { expiresAt: row.claimExpiresAt.toISOString() } : null
	}));
	const last = items.at(-1);
	return {
		items,
		nextCursor:
			hasMore && last
				? encodeCompanyCursor(last.name.toLocaleLowerCase('en-US'), last.companyId)
				: null
	};
}

export async function getCompanyProfile(companyId: string, now = new Date()) {
	const [record] = await db
		.select({
			id: company.id,
			issuerKey: company.issuerKey,
			cik: company.cik,
			name: company.name,
			included: company.included,
			status: resolvedCompanyReadinessStatus(),
			ticker: company.canonicalTicker,
			claimExpiresAt: executiveResearchClaim.expiresAt
		})
		.from(company)
		.leftJoin(
			executiveResearchClaim,
			and(
				eq(executiveResearchClaim.companyId, company.id),
				gt(executiveResearchClaim.expiresAt, now)
			)
		)
		.where(eq(company.id, companyId))
		.limit(1);
	if (!record) throw new McpResearchError('not_found', 'Company not found');

	const [universe, currentProfile, [snapshot]] = await Promise.all([
		db
			.select({ asOfDate: massiveUniverseSync.asOf })
			.from(massiveUniverseSync)
			.orderBy(desc(massiveUniverseSync.asOf))
			.limit(1),
		getCompanyProfileDocument(companyId),
		db
			.select({ createdAt: researchSnapshot.createdAt })
			.from(researchSnapshot)
			.where(eq(researchSnapshot.source, `executive_profile:${record.issuerKey}`))
			.orderBy(desc(researchSnapshot.createdAt), desc(researchSnapshot.id))
			.limit(1)
	]);

	return {
		company: {
			companyId: record.id,
			issuerKey: record.issuerKey,
			cik: record.cik,
			ticker: record.ticker,
			name: record.name,
			status: record.included ? record.status : ('excluded' as const),
			claim: record.claimExpiresAt ? { expiresAt: record.claimExpiresAt.toISOString() } : null
		},
		universeAsOf: universe[0]?.asOfDate.toISOString().slice(0, 10) ?? null,
		currentProfile,
		currentProfileImportedAt: snapshot?.createdAt.toISOString() ?? null,
		requirements: {
			schemaVersion: 3 as const,
			summaryWords: { minimum: 50, maximum: 100 },
			citationsRequiredFor: ['role', 'summary', 'facts', 'portraits'] as const,
			portraits: {
				minimum: 1,
				targetMinimum: 2,
				maximum: 3,
				mustBeRealHttpsImages: true,
				singleAllowedAfterReasonableSearch: true,
				venues: [
					'official sites',
					'SEC exhibits',
					'press releases',
					'conference and speaker biographies',
					'reputable news',
					'professional biographies'
				]
			},
			multipleLeaders: 'Include every current person when the top role is genuinely shared.'
		}
	};
}

export async function claimCompanies(
	apiKey: AuthenticatedMcpApiKey,
	input: ClaimResearchCompaniesInput,
	now = new Date()
) {
	if (input.limit < 1 || input.limit > MAX_COMPANY_CLAIM_BATCH_SIZE) {
		throw new McpResearchError(
			'validation_error',
			`Company claims are limited to 1-${MAX_COMPANY_CLAIM_BATCH_SIZE} companies`
		);
	}
	const expiresAt = companyClaimExpiry(now);
	const claimed = await db.transaction(
		async (tx) => {
			await tx.delete(executiveResearchClaim).where(lte(executiveResearchClaim.expiresAt, now));
			const activeSlate = tx
				.select({ value: sql`1` })
				.from(leadershipSlate)
				.where(
					and(eq(leadershipSlate.companyId, company.id), eq(leadershipSlate.status, 'active'))
				);
			const activeClaim = tx
				.select({ value: sql`1` })
				.from(executiveResearchClaim)
				.where(eq(executiveResearchClaim.companyId, company.id));
			const candidates = await tx
				.select({ companyId: company.id })
				.from(company)
				.where(and(eq(company.included, true), notExists(activeSlate), notExists(activeClaim)))
				.orderBy(asc(company.cohortOrder), asc(company.id))
				.limit(input.limit)
				.for('update', { of: company, skipLocked: true });
			if (candidates.length === 0) return [];

			const claims = candidates.map(({ companyId }) => {
				const claimToken = createCompanyClaimToken();
				return {
					companyId,
					claimToken,
					tokenHash: hashCompanyClaimToken(claimToken)
				};
			});
			await tx.insert(executiveResearchClaim).values(
				claims.map((claim) => ({
					companyId: claim.companyId,
					tokenHash: claim.tokenHash,
					claimedByApiKeyId: apiKey.id,
					claimedAt: now,
					expiresAt
				}))
			);
			return claims;
		},
		{ isolationLevel: 'read committed', accessMode: 'read write' }
	);

	return {
		claims: await Promise.all(
			claimed.map(async ({ companyId, claimToken }) => ({
				companyId,
				claimToken,
				claimedAt: now.toISOString(),
				expiresAt: expiresAt.toISOString(),
				task: await getCompanyProfile(companyId, now)
			}))
		)
	};
}

export async function renewCompanyClaim(companyId: string, claimToken: string, now = new Date()) {
	const tokenHash = parseCompanyClaimToken(claimToken)!;
	return db.transaction(async (tx) => {
		const [claim] = await tx
			.select({
				tokenHash: executiveResearchClaim.tokenHash,
				expiresAt: executiveResearchClaim.expiresAt
			})
			.from(executiveResearchClaim)
			.where(eq(executiveResearchClaim.companyId, companyId))
			.for('update')
			.limit(1);
		if (!claim || !companyClaimTokenMatches(claim.tokenHash, tokenHash)) {
			throw new CompanyClaimError('claim_token_invalid', 'The company claim token is invalid');
		}
		if (claim.expiresAt <= now) {
			throw new CompanyClaimError('claim_expired', 'The company claim has expired');
		}
		const expiresAt = companyClaimExpiry(now);
		await tx
			.update(executiveResearchClaim)
			.set({ expiresAt })
			.where(eq(executiveResearchClaim.companyId, companyId));
		return { companyId, expiresAt: expiresAt.toISOString() };
	});
}

export async function releaseCompanyClaim(companyId: string, claimToken: string, now = new Date()) {
	const tokenHash = parseCompanyClaimToken(claimToken)!;
	return db.transaction(async (tx) => {
		const [claim] = await tx
			.select({
				tokenHash: executiveResearchClaim.tokenHash,
				expiresAt: executiveResearchClaim.expiresAt
			})
			.from(executiveResearchClaim)
			.where(eq(executiveResearchClaim.companyId, companyId))
			.for('update')
			.limit(1);
		if (!claim) return { companyId, released: false };
		if (!companyClaimTokenMatches(claim.tokenHash, tokenHash)) {
			throw new CompanyClaimError('claim_token_invalid', 'The company claim token is invalid');
		}
		await tx.delete(executiveResearchClaim).where(eq(executiveResearchClaim.companyId, companyId));
		return { companyId, released: claim.expiresAt > now };
	});
}

export async function publishExecutiveProfile(
	apiKey: AuthenticatedMcpApiKey,
	companyId: string,
	value: unknown,
	now = new Date(),
	claimToken?: string,
	claimClock: () => Date = () => new Date()
) {
	const profile = parseExecutiveProfileForPublication(value, logPortraitDiagnostic);
	const stored = await requireMcpWritableCompany(companyId, profile);
	const tokenHash = parseCompanyClaimToken(claimToken);
	const hasLiveClaim = await preflightCompanyClaim(companyId, tokenHash, now);
	const payloadHash = profilePayloadHash(profile);
	const [duplicate] = await db
		.select({ id: researchSnapshot.id })
		.from(researchSnapshot)
		.where(
			and(
				eq(researchSnapshot.source, `executive_profile:${profile.issuer_key}`),
				eq(researchSnapshot.payloadHash, payloadHash)
			)
		)
		.orderBy(desc(researchSnapshot.createdAt), desc(researchSnapshot.id))
		.limit(1);
	if (duplicate && !hasLiveClaim) {
		const [slate] = await db
			.select({ id: leadershipSlate.id, version: leadershipSlate.version })
			.from(leadershipSlate)
			.where(and(eq(leadershipSlate.companyId, companyId), eq(leadershipSlate.status, 'active')))
			.limit(1);
		if (slate) {
			return {
				action: 'unchanged' as const,
				companyId,
				slateId: slate.id,
				slateVersion: slate.version,
				cohortRevision: null,
				companyPath: `/admin/companies/${companyId}`
			};
		}
	}

	const imported = await importCompanyProfile(stored.id, profile, {
		now,
		claimClock,
		submittedByApiKeyId: apiKey.id,
		publicationClaims: [{ companyId, tokenHash }]
	});
	return {
		action: imported.action,
		companyId: imported.companyId,
		slateId: imported.slateId,
		slateVersion: imported.slateVersion,
		cohortRevision: imported.cohortRevision,
		companyPath: `/admin/companies/${imported.companyId}`
	};
}

async function preflightCompanyClaim(
	companyId: string,
	tokenHash: string | null,
	now: Date
): Promise<boolean> {
	const [claim] = await db
		.select({
			tokenHash: executiveResearchClaim.tokenHash,
			expiresAt: executiveResearchClaim.expiresAt
		})
		.from(executiveResearchClaim)
		.where(eq(executiveResearchClaim.companyId, companyId))
		.limit(1);
	if (!claim) {
		if (tokenHash) {
			throw new CompanyClaimError(
				'claim_token_invalid',
				'The company has no active claim for this token'
			);
		}
		return false;
	}
	const tokenMatches = tokenHash !== null && companyClaimTokenMatches(claim.tokenHash, tokenHash);
	if (claim.expiresAt <= now) {
		if (tokenMatches) {
			throw new CompanyClaimError('claim_expired', 'The company claim has expired');
		}
		if (tokenHash) {
			throw new CompanyClaimError('claim_token_invalid', 'The company claim token is invalid');
		}
		return false;
	}
	if (!tokenHash) {
		throw new CompanyClaimError(
			'claim_required',
			'This company is actively claimed; provide its claim token to publish'
		);
	}
	if (!tokenMatches) {
		throw new CompanyClaimError('claim_token_invalid', 'The company claim token is invalid');
	}
	return true;
}

async function requireMcpWritableCompany(companyId: string, profile: ExecutiveProfile) {
	const stored = await requireMatchingCompanyIdentity(companyId, profile);
	if (!stored.included) {
		throw new McpResearchError(
			'company_excluded',
			'API keys cannot publish profiles for excluded companies'
		);
	}
	return stored;
}

async function requireMatchingCompanyIdentity(
	companyId: string,
	value: Pick<ExecutiveProfile, 'issuer_key' | 'canonical_ticker' | 'company_name'>
) {
	const [stored] = await db
		.select({
			id: company.id,
			issuerKey: company.issuerKey,
			canonicalTicker: company.canonicalTicker,
			name: company.name,
			included: company.included
		})
		.from(company)
		.where(eq(company.id, companyId))
		.limit(1);
	if (!stored) throw new McpResearchError('company_not_found', 'Company not found');
	if (
		value.issuer_key !== stored.issuerKey ||
		value.canonical_ticker !== stored.canonicalTicker ||
		value.company_name !== stored.name
	) {
		throw new McpResearchError(
			'company_identity_mismatch',
			'Profile issuer key, ticker, and company name must match the selected company'
		);
	}
	return stored;
}

function encodeCompanyCursor(name: string, id: string): string {
	return Buffer.from(JSON.stringify({ name, id })).toString('base64url');
}

function decodeCompanyCursor(value: string): { name: string; id: string } {
	try {
		const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
		if (
			typeof decoded === 'object' &&
			decoded !== null &&
			'name' in decoded &&
			typeof decoded.name === 'string' &&
			'id' in decoded &&
			typeof decoded.id === 'string' &&
			/^[0-9a-f-]{36}$/i.test(decoded.id)
		) {
			return { name: decoded.name, id: decoded.id };
		}
	} catch {
		// Fall through to the stable public error.
	}
	throw new McpResearchError('invalid_cursor', 'The company cursor is invalid');
}
