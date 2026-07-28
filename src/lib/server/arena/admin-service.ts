import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { executiveProfileSchema } from '$lib/research/schemas';
import { transformPortrait, type TransformedPortrait } from '$lib/research/portrait';
import {
	cohortState,
	company,
	executiveResearchClaim,
	leadershipMember,
	leadershipSlate,
	pairPresentation,
	person,
	portrait,
	securityListing,
	source
} from '$lib/server/db/schema';
import { resolvedCompanyReadinessStatus, type ReadinessStatus } from '$lib/server/readiness';
import { createDatabaseResearchImportService } from '$lib/server/research-import';
import type { ProfilePublicationClaim } from '$lib/server/research-claims';
import { scheduleActiveRankingRefresh } from './service';

export interface CompanyMetadataInput {
	name: string;
	description: string;
	homepageUrl: string | null;
}

export interface NewCompanyInput extends CompanyMetadataInput {
	issuerKey: string;
	cik: string | null;
	canonicalTicker: string;
	primaryExchange: string | null;
	marketCap: number | null;
}

export interface ProfileImportOptions {
	now?: Date;
	claimClock?: () => Date;
	submittedByApiKeyId?: string;
	publicationClaims?: readonly ProfilePublicationClaim[];
}

export interface PortraitUploadInput {
	personId: string;
	bytes: Uint8Array;
	altText?: string;
	sourceUrl?: string | null;
	sourceTitle?: string | null;
	sourcePublisher?: string | null;
	portraitId?: string | null;
}

export interface PreparedPortraitInput {
	personId: string;
	portrait: TransformedPortrait;
	imageUrl?: string | null;
	altText?: string;
	sourceUrl?: string | null;
	sourceTitle?: string | null;
	sourcePublisher?: string | null;
	portraitId?: string | null;
}

export class DuplicatePortraitError extends Error {
	constructor() {
		super('This executive already has the same portrait');
		this.name = 'DuplicatePortraitError';
	}
}

export async function updateCompanyMetadata(
	companyId: string,
	input: CompanyMetadataInput,
	now = new Date()
): Promise<void> {
	const [updated] = await db
		.update(company)
		.set({
			name: input.name,
			description: input.description,
			homepageUrl: input.homepageUrl,
			updatedAt: now
		})
		.where(eq(company.id, companyId))
		.returning({ id: company.id });
	if (!updated) throw new Error('Company not found');
}

export async function excludeCompany(
	companyId: string,
	reason: string,
	now = new Date()
): Promise<void> {
	let shouldRefit = false;

	await db.transaction(async (transaction) => {
		const [state] = await transaction
			.select({ frozenAt: cohortState.frozenAt })
			.from(cohortState)
			.where(eq(cohortState.id, 1))
			.for('update')
			.limit(1);
		const [stored] = await transaction
			.select({ included: company.included })
			.from(company)
			.where(eq(company.id, companyId))
			.limit(1);
		if (!stored) throw new Error('Company not found');
		if (!stored.included) throw new Error('Company is already excluded');

		const companyMembers = await transaction
			.select({
				slateId: leadershipSlate.id,
				slateStatus: leadershipSlate.status,
				personId: leadershipMember.personId
			})
			.from(leadershipSlate)
			.leftJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
			.where(eq(leadershipSlate.companyId, companyId));
		const slateIds = [
			...new Set(
				companyMembers.filter((row) => row.slateStatus === 'active').map((row) => row.slateId)
			)
		];
		const personIds = companyMembers.flatMap((row) =>
			row.personId === null ? [] : [row.personId]
		);

		if (slateIds.length > 0) {
			await transaction
				.update(leadershipSlate)
				.set({ status: 'retired', retiredAt: now })
				.where(inArray(leadershipSlate.id, slateIds));
		}
		if (personIds.length > 0) {
			await transaction.delete(portrait).where(inArray(portrait.personId, personIds));
		}
		await transaction
			.update(company)
			.set({
				included: false,
				exclusionReason: reason,
				updatedAt: now
			})
			.where(eq(company.id, companyId));
		await transaction
			.delete(executiveResearchClaim)
			.where(eq(executiveResearchClaim.companyId, companyId));

		if (state?.frozenAt) {
			shouldRefit = true;
			await transaction
				.update(cohortState)
				.set({
					revision: sql`${cohortState.revision} + 1`,
					updatedAt: now
				})
				.where(eq(cohortState.id, 1));
			await transaction
				.update(pairPresentation)
				.set({ consumedAt: now })
				.where(isNull(pairPresentation.consumedAt));
		}
	});

	if (shouldRefit) scheduleActiveRankingRefresh(now);
}

export async function importCompanyProfile(
	companyId: string,
	profile: unknown,
	options: ProfileImportOptions = {}
) {
	const now = options.now ?? new Date();
	const validatedProfile = await assertProfileMatchesCompany(companyId, profile);
	const requiresActivation = await companyRequiresActivation(companyId);
	const result = await createDatabaseResearchImportService(db, {
		now: () => now,
		claimClock: options.claimClock,
		submittedByApiKeyId: options.submittedByApiKeyId,
		publicationClaims: options.publicationClaims
	}).importProfiles([validatedProfile]);
	const imported = result.profiles[0];
	if (!imported || imported.companyId !== companyId) {
		throw new Error('Imported profile did not match the managed company');
	}
	const activationRevision = requiresActivation
		? await activateStagedCompany(companyId, now)
		: null;
	const cohortRevision = imported.cohortRevision ?? activationRevision;
	if (cohortRevision !== null) scheduleActiveRankingRefresh(now);
	return { ...imported, cohortRevision };
}

export async function saveExecutivePortrait(
	companyId: string,
	input: PortraitUploadInput,
	now = new Date()
): Promise<{ portraitId: string; readinessStatus: ReadinessStatus }> {
	return savePreparedExecutivePortrait(
		companyId,
		{
			personId: input.personId,
			portrait: await transformPortrait(input.bytes),
			imageUrl: null,
			altText: input.altText,
			sourceUrl: input.sourceUrl,
			sourceTitle: input.sourceTitle,
			sourcePublisher: input.sourcePublisher,
			portraitId: input.portraitId
		},
		now
	);
}

export async function savePreparedExecutivePortrait(
	companyId: string,
	input: PreparedPortraitInput,
	now = new Date()
): Promise<{ portraitId: string; readinessStatus: ReadinessStatus }> {
	let shouldRefit = false;
	const result = await db.transaction(async (transaction) => {
		const [state] = await transaction
			.select({
				frozenAt: cohortState.frozenAt,
				readinessStatus: resolvedCompanyReadinessStatus()
			})
			.from(company)
			.leftJoin(cohortState, eq(cohortState.id, 1))
			.where(eq(company.id, companyId))
			.for('update', { of: company })
			.limit(1);
		if (!state) throw new Error('Company not found');

		const [member] = await transaction
			.select({ name: person.canonicalName })
			.from(leadershipSlate)
			.innerJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
			.innerJoin(person, eq(person.id, leadershipMember.personId))
			.where(
				and(
					eq(leadershipSlate.companyId, companyId),
					eq(leadershipSlate.status, 'active'),
					eq(leadershipMember.personId, input.personId)
				)
			)
			.limit(1);
		if (!member) throw new Error('Executive is not part of this company’s active leadership');

		const existing = await transaction
			.select({
				id: portrait.id,
				displayOrder: portrait.displayOrder,
				personId: portrait.personId
			})
			.from(portrait)
			.where(eq(portrait.personId, input.personId))
			.orderBy(asc(portrait.displayOrder));
		const replacing = input.portraitId
			? existing.find((candidate) => candidate.id === input.portraitId)
			: null;
		if (input.portraitId && !replacing) {
			throw new Error('Portrait does not belong to this executive');
		}
		if (!replacing && existing.length >= 3) {
			throw new Error('An executive can have at most three portraits');
		}
		const duplicatePortrait = await transaction.query.portrait.findFirst({
			where: and(eq(portrait.personId, input.personId), eq(portrait.sha256, input.portrait.sha256)),
			columns: { id: true }
		});
		if (duplicatePortrait && duplicatePortrait.id !== replacing?.id) {
			throw new DuplicatePortraitError();
		}

		const sourceId = input.sourceUrl
			? await upsertPortraitSource(
					transaction,
					input.sourceUrl,
					input.sourceTitle,
					input.sourcePublisher,
					now
				)
			: null;
		const values = {
			personId: input.personId,
			displayOrder: replacing?.displayOrder ?? existing.length,
			image: input.portrait.data,
			imageUrl: input.imageUrl ?? null,
			contentType: input.portrait.contentType,
			width: input.portrait.width,
			height: input.portrait.height,
			byteLength: input.portrait.byteLength,
			sha256: input.portrait.sha256,
			altText: input.altText?.trim() || `Portrait of ${member.name}`,
			sourceId,
			createdAt: now
		};
		const [storedPortrait] = replacing
			? await transaction
					.update(portrait)
					.set(values)
					.where(eq(portrait.id, replacing.id))
					.returning({ id: portrait.id })
			: await transaction.insert(portrait).values(values).returning({ id: portrait.id });
		if (!storedPortrait) throw new Error('Failed to save portrait');

		const readinessStatus = await updateRevisionForReadinessChange(
			transaction,
			companyId,
			state.readinessStatus,
			state.frozenAt,
			now
		);
		shouldRefit = state.frozenAt !== null && state.readinessStatus !== readinessStatus;
		return { portraitId: storedPortrait.id, readinessStatus };
	});
	if (shouldRefit) scheduleActiveRankingRefresh(now);
	return result;
}

export async function deleteExecutivePortrait(
	companyId: string,
	portraitId: string,
	now = new Date()
): Promise<{ readinessStatus: ReadinessStatus }> {
	let shouldRefit = false;
	const result = await db.transaction(async (transaction) => {
		const [state] = await transaction
			.select({
				frozenAt: cohortState.frozenAt,
				readinessStatus: resolvedCompanyReadinessStatus()
			})
			.from(company)
			.leftJoin(cohortState, eq(cohortState.id, 1))
			.where(eq(company.id, companyId))
			.for('update', { of: company })
			.limit(1);
		if (!state) throw new Error('Company not found');
		const [stored] = await transaction
			.select({ personId: portrait.personId, displayOrder: portrait.displayOrder })
			.from(portrait)
			.innerJoin(leadershipMember, eq(leadershipMember.personId, portrait.personId))
			.innerJoin(
				leadershipSlate,
				and(
					eq(leadershipSlate.id, leadershipMember.slateId),
					eq(leadershipSlate.companyId, companyId),
					eq(leadershipSlate.status, 'active')
				)
			)
			.where(eq(portrait.id, portraitId))
			.limit(1);
		if (!stored) throw new Error('Portrait not found for an active executive at this company');
		await transaction.delete(portrait).where(eq(portrait.id, portraitId));
		const following = await transaction
			.select({ id: portrait.id, displayOrder: portrait.displayOrder })
			.from(portrait)
			.where(
				and(
					eq(portrait.personId, stored.personId),
					sql`${portrait.displayOrder} > ${stored.displayOrder}`
				)
			)
			.orderBy(asc(portrait.displayOrder));
		for (const candidate of following) {
			await transaction
				.update(portrait)
				.set({ displayOrder: candidate.displayOrder - 1 })
				.where(eq(portrait.id, candidate.id));
		}
		const readinessStatus = await updateRevisionForReadinessChange(
			transaction,
			companyId,
			state.readinessStatus,
			state.frozenAt,
			now
		);
		shouldRefit = state.frozenAt !== null && state.readinessStatus !== readinessStatus;
		return { readinessStatus };
	});
	if (shouldRefit) scheduleActiveRankingRefresh(now);
	return result;
}

export async function createCompanyWithProfile(
	input: NewCompanyInput,
	profile: unknown,
	now = new Date()
): Promise<{ companyId: string; slateId: string }> {
	const validatedProfile = executiveProfileSchema.parse(profile);
	if (
		validatedProfile.issuer_key !== input.issuerKey ||
		validatedProfile.canonical_ticker !== input.canonicalTicker ||
		validatedProfile.company_name !== input.name
	) {
		throw new Error('Profile issuer key, ticker, and company name must match the new company');
	}
	let companyId: string | null = null;
	let profileImported = false;
	try {
		companyId = await db.transaction(async (transaction) => {
			const [{ nextOrder }] = await transaction
				.select({
					nextOrder: sql<number>`coalesce(${max(company.cohortOrder)}, 0)::int + 1`
				})
				.from(company);
			const [created] = await transaction
				.insert(company)
				.values({
					issuerKey: input.issuerKey,
					cik: input.cik,
					name: input.name,
					description: input.description,
					homepageUrl: input.homepageUrl,
					canonicalTicker: input.canonicalTicker,
					marketCap: input.marketCap,
					included: false,
					cohortOrder: nextOrder,
					updatedAt: now
				})
				.returning({ id: company.id });
			if (!created) throw new Error('Failed to create company');
			await transaction.insert(securityListing).values({
				companyId: created.id,
				ticker: input.canonicalTicker,
				name: input.name,
				primaryExchange: input.primaryExchange,
				type: 'CS',
				active: true,
				marketCap: input.marketCap,
				isCanonical: true
			});
			return created.id;
		});

		const result = await createDatabaseResearchImportService(db, {
			now: () => now
		}).importProfiles([validatedProfile]);
		const imported = result.profiles[0];
		if (!imported || imported.companyId !== companyId) {
			throw new Error('Imported profile did not match the new company');
		}
		profileImported = true;
		const activationRevision = await activateStagedCompany(companyId, now);
		if (imported.cohortRevision !== null || activationRevision !== null) {
			scheduleActiveRankingRefresh(now);
		}
		return { companyId, slateId: imported.slateId };
	} catch (error) {
		if (companyId && !profileImported) {
			await db.delete(company).where(eq(company.id, companyId));
		}
		throw error;
	}
}

async function companyRequiresActivation(companyId: string): Promise<boolean> {
	const [stored] = await db
		.select({ included: company.included })
		.from(company)
		.where(eq(company.id, companyId))
		.limit(1);
	if (!stored) throw new Error('Company not found');
	return !stored.included;
}

async function activateStagedCompany(companyId: string, now: Date): Promise<number | null> {
	return db.transaction(async (transaction) => {
		const [state] = await transaction
			.select({ frozenAt: cohortState.frozenAt })
			.from(cohortState)
			.where(eq(cohortState.id, 1))
			.for('update')
			.limit(1);
		const [activated] = await transaction
			.update(company)
			.set({
				included: true,
				exclusionReason: null,
				updatedAt: now
			})
			.where(eq(company.id, companyId))
			.returning({ id: company.id });
		if (!activated) throw new Error('Company not found');
		if (!state?.frozenAt) return null;
		const [updated] = await transaction
			.update(cohortState)
			.set({
				revision: sql`${cohortState.revision} + 1`,
				updatedAt: now
			})
			.where(eq(cohortState.id, 1))
			.returning({ revision: cohortState.revision });
		await transaction
			.update(pairPresentation)
			.set({ consumedAt: now })
			.where(isNull(pairPresentation.consumedAt));
		return updated?.revision ?? null;
	});
}

async function assertProfileMatchesCompany(companyId: string, value: unknown) {
	const profile = executiveProfileSchema.parse(value);
	const [stored] = await db
		.select({
			issuerKey: company.issuerKey,
			canonicalTicker: company.canonicalTicker,
			name: company.name
		})
		.from(company)
		.where(eq(company.id, companyId))
		.limit(1);
	if (!stored) throw new Error('Company not found');
	if (
		profile.issuer_key !== stored.issuerKey ||
		profile.canonical_ticker !== stored.canonicalTicker ||
		profile.company_name !== stored.name
	) {
		throw new Error('Profile issuer key, ticker, and company name must match this company');
	}
	return profile;
}

type ArenaTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function upsertPortraitSource(
	transaction: ArenaTransaction,
	url: string,
	title: string | null | undefined,
	publisher: string | null | undefined,
	retrievedAt: Date
): Promise<string> {
	const parsed = new URL(url);
	const normalizedPublisher = publisher?.trim() || parsed.hostname.replace(/^www\./, '');
	const pathTitle = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) ?? '')
		.replace(/[-_]+/g, ' ')
		.trim();
	const [stored] = await transaction
		.insert(source)
		.values({
			url,
			title: title?.trim() || pathTitle || normalizedPublisher,
			publisher: normalizedPublisher,
			retrievedAt
		})
		.onConflictDoUpdate({
			target: source.url,
			set: {
				title: title?.trim() || pathTitle || normalizedPublisher,
				publisher: normalizedPublisher,
				retrievedAt: sql`greatest(${source.retrievedAt}, ${retrievedAt})`
			}
		})
		.returning({ id: source.id });
	if (!stored) throw new Error('Failed to store portrait source');
	return stored.id;
}

async function updateRevisionForReadinessChange(
	transaction: ArenaTransaction,
	companyId: string,
	previousStatus: ReadinessStatus,
	frozenAt: Date | null,
	now: Date
): Promise<ReadinessStatus> {
	const [current] = await transaction
		.select({ readinessStatus: resolvedCompanyReadinessStatus() })
		.from(company)
		.where(eq(company.id, companyId))
		.limit(1);
	const readinessStatus = current?.readinessStatus ?? 'not_ready';
	if (!frozenAt || previousStatus === readinessStatus) return readinessStatus;
	await transaction
		.update(cohortState)
		.set({ revision: sql`${cohortState.revision} + 1`, updatedAt: now })
		.where(eq(cohortState.id, 1));
	await transaction
		.update(pairPresentation)
		.set({ consumedAt: now })
		.where(isNull(pairPresentation.consumedAt));
	return readinessStatus;
}
