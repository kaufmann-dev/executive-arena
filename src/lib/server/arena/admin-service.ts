import { eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { executiveProfileSchema } from '$lib/research/schemas';
import {
	cohortState,
	company,
	leadershipMember,
	leadershipSlate,
	pairPresentation,
	portrait,
	securityListing
} from '$lib/server/db/schema';
import { createDatabaseResearchImportService } from '$lib/server/research-import';
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
	submittedByApiKeyId?: string;
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
		submittedByApiKeyId: options.submittedByApiKeyId
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
