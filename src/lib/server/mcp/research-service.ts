import { and, asc, desc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { importCompanyProfile } from '$lib/server/arena/admin-service';
import { resolvedCompanyReadinessStatus } from '$lib/server/readiness';
import {
	cohortState,
	company,
	executiveResearchIssue,
	leadershipSlate,
	researchSnapshot
} from '$lib/server/db/schema';
import {
	executiveProfileSchema,
	executiveReviewArtifactSchema,
	type ExecutiveProfile,
	type ExecutiveReviewArtifact
} from '$lib/research/schemas';
import { profilePayloadHash } from '$lib/server/research-import/drizzle-repository';
import { createDatabaseResearchImportService } from '$lib/server/research-import';
import type { AuthenticatedMcpApiKey } from './api-keys';

export type McpCompanyStatus = 'all' | 'pending' | 'ready' | 'excluded';
export type McpReviewStatus = 'all' | 'clear' | 'needs_review';

export interface ListResearchCompaniesInput {
	status: McpCompanyStatus;
	review: McpReviewStatus;
	query?: string;
	cursor?: string;
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

export async function getResearchCoverage() {
	const readinessStatus = resolvedCompanyReadinessStatus();
	const [counts, universe, reviewCount, cohort] = await Promise.all([
		db
			.select({
				included: sql<number>`count(*) filter (where ${company.included})::int`,
				ready: sql<number>`count(*) filter (where ${company.included} and ${readinessStatus} = 'ready')::int`,
				pending: sql<number>`count(*) filter (where ${company.included} and ${readinessStatus} = 'pending')::int`,
				excluded: sql<number>`count(*) filter (where not ${company.included} or ${readinessStatus} = 'excluded')::int`
			})
			.from(company)
			.then((rows) => rows[0]),
		db
			.select({ asOf: researchSnapshot.asOf })
			.from(researchSnapshot)
			.where(eq(researchSnapshot.source, 'massive'))
			.orderBy(desc(researchSnapshot.createdAt), desc(researchSnapshot.id))
			.limit(1)
			.then((rows) => rows[0]),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(executiveResearchIssue)
			.where(isNull(executiveResearchIssue.resolvedAt))
			.then((rows) => rows[0]?.count ?? 0),
		db
			.select({ revision: cohortState.revision, frozenAt: cohortState.frozenAt })
			.from(cohortState)
			.where(eq(cohortState.id, 1))
			.limit(1)
			.then((rows) => rows[0])
	]);

	return {
		included: counts?.included ?? 0,
		ready: counts?.ready ?? 0,
		pending: counts?.pending ?? 0,
		excluded: counts?.excluded ?? 0,
		needsReview: reviewCount,
		universeAsOf: universe?.asOf.toISOString().slice(0, 10) ?? null,
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

export async function listResearchCompanies(input: ListResearchCompaniesInput) {
	const cursor = input.cursor ? decodeCompanyCursor(input.cursor) : null;
	const search = input.query?.trim().slice(0, 100);
	const readinessStatus = resolvedCompanyReadinessStatus();
	const normalizedName = sql<string>`lower(${company.name})`;
	const statusFilter =
		input.status === 'pending'
			? and(eq(company.included, true), sql`${readinessStatus} = 'pending'`)
			: input.status === 'ready'
				? and(eq(company.included, true), sql`${readinessStatus} = 'ready'`)
				: input.status === 'excluded'
					? sql`${readinessStatus} = 'excluded'`
					: undefined;
	const reviewFilter =
		input.review === 'needs_review'
			? sql`${executiveResearchIssue.id} is not null`
			: input.review === 'clear'
				? sql`${executiveResearchIssue.id} is null`
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
			issueId: executiveResearchIssue.id
		})
		.from(company)
		.leftJoin(
			executiveResearchIssue,
			and(
				eq(executiveResearchIssue.companyId, company.id),
				isNull(executiveResearchIssue.resolvedAt)
			)
		)
		.where(
			and(
				statusFilter,
				reviewFilter,
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
		readinessStatus: row.included ? row.readinessStatus : ('excluded' as const),
		reviewStatus: row.issueId ? ('needs_review' as const) : ('clear' as const)
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

export async function getExecutiveResearchTask(companyId: string) {
	const [stored, universe, snapshot, issue] = await Promise.all([
		db
			.select({
				id: company.id,
				issuerKey: company.issuerKey,
				cik: company.cik,
				canonicalTicker: company.canonicalTicker,
				name: company.name,
				description: company.description,
				homepageUrl: company.homepageUrl,
				sicCode: company.sicCode,
				sicDescription: company.sicDescription,
				included: company.included,
				readinessStatus: resolvedCompanyReadinessStatus()
			})
			.from(company)
			.where(eq(company.id, companyId))
			.limit(1)
			.then((rows) => rows[0]),
		db
			.select({ asOf: researchSnapshot.asOf })
			.from(researchSnapshot)
			.where(eq(researchSnapshot.source, 'massive'))
			.orderBy(desc(researchSnapshot.createdAt), desc(researchSnapshot.id))
			.limit(1)
			.then((rows) => rows[0]),
		db
			.select({ payload: researchSnapshot.payload, asOf: researchSnapshot.asOf })
			.from(researchSnapshot)
			.innerJoin(
				company,
				eq(researchSnapshot.source, sql`'executive_profile:' || ${company.issuerKey}`)
			)
			.where(eq(company.id, companyId))
			.orderBy(desc(researchSnapshot.createdAt), desc(researchSnapshot.id))
			.limit(1)
			.then((rows) => rows[0]),
		db
			.select({
				payload: executiveResearchIssue.payload,
				updatedAt: executiveResearchIssue.updatedAt
			})
			.from(executiveResearchIssue)
			.where(
				and(
					eq(executiveResearchIssue.companyId, companyId),
					isNull(executiveResearchIssue.resolvedAt)
				)
			)
			.limit(1)
			.then((rows) => rows[0])
	]);
	if (!stored) throw new McpResearchError('company_not_found', 'Company not found');

	const currentProfile = snapshot ? executiveProfileSchema.safeParse(snapshot.payload) : null;
	const openIssue = issue ? executiveReviewArtifactSchema.safeParse(issue.payload) : null;
	return {
		company: {
			companyId: stored.id,
			issuerKey: stored.issuerKey,
			cik: stored.cik,
			canonicalTicker: stored.canonicalTicker,
			name: stored.name,
			description: stored.description,
			homepageUrl: stored.homepageUrl,
			sicCode: stored.sicCode,
			sicDescription: stored.sicDescription,
			included: stored.included,
			readinessStatus: stored.included ? stored.readinessStatus : ('excluded' as const)
		},
		universeAsOf: universe?.asOf.toISOString().slice(0, 10) ?? null,
		currentProfile: currentProfile?.success ? currentProfile.data : null,
		currentProfileImportedAt: snapshot?.asOf.toISOString() ?? null,
		openIssue: openIssue?.success ? openIssue.data : null,
		requirements: {
			schemaVersion: 2,
			summaryWords: { minimum: 80, maximum: 200 },
			roleSourceKinds: ['official_company', 'sec_filing'],
			portraits: {
				minimum: 1,
				maximum: 3,
				httpsRequired: true,
				realPersonRequired: true,
				minimumDimensionPixels: 200
			},
			everyFactRequiresSources: true,
			multipleLeadersMustAllBeCoCeo: true
		}
	};
}

export async function publishExecutiveProfile(
	apiKey: AuthenticatedMcpApiKey,
	companyId: string,
	value: unknown,
	now = new Date()
) {
	const profile = executiveProfileSchema.parse(value);
	const stored = await requireMcpWritableCompany(companyId, profile);
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
	if (duplicate) {
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
		submittedByApiKeyId: apiKey.id
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

export async function reportExecutiveResearchIssue(
	apiKey: AuthenticatedMcpApiKey,
	companyId: string,
	value: unknown,
	now = new Date()
) {
	return writeExecutiveResearchIssue(apiKey.id, companyId, value, now);
}

export async function reportAutomatedExecutiveResearchIssue(
	companyId: string,
	value: unknown,
	now = new Date()
) {
	return writeExecutiveResearchIssue(null, companyId, value, now);
}

async function writeExecutiveResearchIssue(
	reportedByApiKeyId: string | null,
	companyId: string,
	value: unknown,
	now: Date
) {
	const artifact = executiveReviewArtifactSchema.parse(value);
	const stored = await requireMatchingCompanyIdentity(companyId, artifact);
	if (!stored.included) {
		throw new McpResearchError(
			'company_excluded',
			'Excluded companies cannot receive research issues'
		);
	}

	return db.transaction(async (transaction) => {
		await transaction
			.select({ id: company.id })
			.from(company)
			.where(eq(company.id, companyId))
			.for('update')
			.limit(1);
		await transaction
			.update(executiveResearchIssue)
			.set({ resolvedAt: now, updatedAt: now })
			.where(
				and(
					eq(executiveResearchIssue.companyId, companyId),
					isNull(executiveResearchIssue.resolvedAt)
				)
			);
		const [created] = await transaction
			.insert(executiveResearchIssue)
			.values({
				companyId,
				reportedByApiKeyId,
				payload: artifact,
				createdAt: now,
				updatedAt: now
			})
			.returning({ id: executiveResearchIssue.id });
		if (!created) throw new Error('Research issue creation did not return a record');
		return {
			issueId: created.id,
			companyId,
			status: 'needs_review' as const,
			reportedAt: now.toISOString()
		};
	});
}

async function requireMcpWritableCompany(companyId: string, profile: ExecutiveProfile) {
	const stored = await requireMatchingCompanyIdentity(companyId, profile);
	if (!stored.included || stored.readinessStatus === 'excluded') {
		throw new McpResearchError(
			'company_excluded',
			'API keys cannot publish profiles for excluded companies'
		);
	}
	return stored;
}

async function requireMatchingCompanyIdentity(
	companyId: string,
	value: Pick<
		ExecutiveProfile | ExecutiveReviewArtifact,
		'issuer_key' | 'canonical_ticker' | 'company_name'
	>
) {
	const [stored] = await db
		.select({
			id: company.id,
			issuerKey: company.issuerKey,
			canonicalTicker: company.canonicalTicker,
			name: company.name,
			included: company.included,
			readinessStatus: company.readinessStatus
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
