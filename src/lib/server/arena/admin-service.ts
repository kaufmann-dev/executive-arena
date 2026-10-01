import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { latestSourceRetrievedAt } from '#lib/server/db/source-query.js';
import { executiveProfileSchema } from '#lib/research/schemas.js';
import { transformPortrait, type TransformedPortrait } from '#lib/research/portrait.js';
import {
	manualCompanyExclusionReasonSchema,
	type ManualExclusionReason
} from '#lib/company-exclusion.js';
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
} from '#lib/server/db/schema.js';
import { resolvedCompanyReadinessStatus, type ReadinessStatus } from '#lib/server/readiness.js';
import { createDatabaseResearchImportService } from '#lib/server/research-import/index.js';
import type { ProfilePublicationClaim } from '#lib/server/research-claims.js';
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

export interface PortraitBatchUploadInput {
	personId: string;
	images: readonly {
		bytes: Uint8Array;
		altText?: string;
	}[];
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

export interface CompanyExclusionInput {
	companyId: string;
	reason: ManualExclusionReason;
	retainedCompanyId?: string | null;
}

export interface CompanyExclusionResult {
	companyId: string;
	action: 'excluded' | 'unchanged';
	reason: ManualExclusionReason;
	retainedCompanyId: string | null;
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

export async function excludeCompanies(
	inputs: readonly CompanyExclusionInput[],
	options: { now?: Date } = {}
): Promise<{ results: CompanyExclusionResult[]; cohortRevision: number | null }> {
	if (inputs.length === 0 || inputs.length > 25) {
		throw new Error('Exclude between one and 25 companies at a time');
	}
	const now = options.now ?? new Date();
	const normalized = inputs.map((input) => {
		const reason = manualCompanyExclusionReasonSchema.parse(input.reason);
		const retainedCompanyId = input.retainedCompanyId ?? null;
		if (reason === 'overlapping_executive_coverage') {
			if (!retainedCompanyId) {
				throw new Error('Overlapping executive coverage requires a retained company');
			}
			if (retainedCompanyId === input.companyId) {
				throw new Error('An excluded company cannot also be the retained company');
			}
		} else if (retainedCompanyId) {
			throw new Error('A retained company applies only to overlapping executive coverage');
		}
		return { companyId: input.companyId, reason, retainedCompanyId };
	});
	const companyIds = normalized.map((input) => input.companyId);
	if (new Set(companyIds).size !== companyIds.length) {
		throw new Error('Each company may appear only once in an exclusion batch');
	}

	let shouldRefit = false;
	let cohortRevision: number | null = null;

	const results = await db.transaction(async (transaction) => {
		const [state] = await transaction
			.select({ frozenAt: cohortState.frozenAt, revision: cohortState.revision })
			.from(cohortState)
			.where(eq(cohortState.id, 1))
			.for('update')
			.limit(1);
		const storedRows = await transaction
			.select({
				id: company.id,
				included: company.included,
				archivedAt: company.archivedAt,
				universeExclusionReason: company.universeExclusionReason,
				manualExclusionReason: company.manualExclusionReason,
				exclusionReferenceCompanyId: company.exclusionReferenceCompanyId
			})
			.from(company)
			.where(inArray(company.id, companyIds))
			.orderBy(asc(company.id))
			.for('update');
		const storedById = new Map(storedRows.map((stored) => [stored.id, stored]));
		for (const input of normalized) {
			const stored = storedById.get(input.companyId);
			if (!stored) throw new Error(`Company ${input.companyId} not found`);
			if (stored.archivedAt) throw new Error('Archived companies cannot be excluded');
			if (stored.universeExclusionReason) {
				throw new Error('Universe-managed exclusions cannot be changed manually');
			}
			if (
				stored.manualExclusionReason &&
				(stored.manualExclusionReason !== input.reason ||
					stored.exclusionReferenceCompanyId !== input.retainedCompanyId)
			) {
				throw new Error('Company is already excluded for a different reason');
			}
			if (!stored.included && !stored.manualExclusionReason) {
				throw new Error('Company is not currently eligible for manual exclusion');
			}
		}
		const [retainedByExistingExclusion] = await transaction
			.select({ id: company.id })
			.from(company)
			.where(
				and(
					inArray(company.exclusionReferenceCompanyId, companyIds),
					eq(company.manualExclusionReason, 'overlapping_executive_coverage'),
					isNull(company.universeExclusionReason),
					isNull(company.archivedAt)
				)
			)
			.limit(1);
		if (retainedByExistingExclusion) {
			throw new Error(
				'Company cannot be excluded while its executive coverage is retained by another exclusion'
			);
		}

		const retainedCompanyIds = [
			...new Set(
				normalized.flatMap((input) => (input.retainedCompanyId ? [input.retainedCompanyId] : []))
			)
		];
		if (retainedCompanyIds.some((id) => companyIds.includes(id))) {
			throw new Error('A retained company cannot be excluded in the same batch');
		}
		if (retainedCompanyIds.length > 0) {
			const retainedRows = await transaction
				.select({
					id: company.id,
					included: company.included,
					archivedAt: company.archivedAt
				})
				.from(company)
				.where(inArray(company.id, retainedCompanyIds))
				.orderBy(asc(company.id))
				.for('update');
			const retainedById = new Map(retainedRows.map((retained) => [retained.id, retained]));
			for (const retainedCompanyId of retainedCompanyIds) {
				const retained = retainedById.get(retainedCompanyId);
				if (!retained || !retained.included || retained.archivedAt) {
					throw new Error('The retained company must be active and included');
				}
			}
		}

		const changedIds: string[] = [];
		const transactionResults: CompanyExclusionResult[] = [];
		for (const input of normalized) {
			const stored = storedById.get(input.companyId)!;
			if (stored.manualExclusionReason) {
				transactionResults.push({ ...input, action: 'unchanged' });
				continue;
			}
			await transaction
				.update(company)
				.set({
					included: false,
					manualExclusionReason: input.reason,
					exclusionReferenceCompanyId: input.retainedCompanyId,
					updatedAt: now
				})
				.where(eq(company.id, input.companyId));
			changedIds.push(input.companyId);
			transactionResults.push({ ...input, action: 'excluded' });
		}
		if (changedIds.length > 0) {
			await transaction
				.delete(executiveResearchClaim)
				.where(inArray(executiveResearchClaim.companyId, changedIds));
		}

		if (state?.frozenAt && changedIds.length > 0) {
			shouldRefit = true;
			const [updated] = await transaction
				.update(cohortState)
				.set({
					revision: sql`${cohortState.revision} + 1`,
					updatedAt: now
				})
				.where(eq(cohortState.id, 1))
				.returning({ revision: cohortState.revision });
			cohortRevision = updated?.revision ?? state.revision + 1;
			await transaction
				.update(pairPresentation)
				.set({ consumedAt: now })
				.where(isNull(pairPresentation.consumedAt));
		}
		return transactionResults;
	});

	if (shouldRefit) scheduleActiveRankingRefresh(now);
	return { results, cohortRevision };
}

export async function includeCompany(
	companyId: string,
	now = new Date()
): Promise<{ readinessStatus: ReadinessStatus; cohortRevision: number | null }> {
	let shouldRefit = false;
	let cohortRevision: number | null = null;
	const readinessStatus = await db.transaction(async (transaction) => {
		const [state] = await transaction
			.select({ frozenAt: cohortState.frozenAt, revision: cohortState.revision })
			.from(cohortState)
			.where(eq(cohortState.id, 1))
			.for('update')
			.limit(1);
		const [stored] = await transaction
			.select({
				included: company.included,
				archivedAt: company.archivedAt,
				universeExclusionReason: company.universeExclusionReason,
				manualExclusionReason: company.manualExclusionReason
			})
			.from(company)
			.where(eq(company.id, companyId))
			.for('update')
			.limit(1);
		if (!stored) throw new Error('Company not found');
		if (stored.archivedAt) throw new Error('Archived companies cannot be included');
		if (stored.universeExclusionReason) {
			throw new Error('Universe-managed exclusions cannot be manually included');
		}
		if (stored.included || !stored.manualExclusionReason) {
			throw new Error('Company is not manually excluded');
		}
		await transaction
			.update(company)
			.set({
				included: true,
				manualExclusionReason: null,
				exclusionReferenceCompanyId: null,
				updatedAt: now
			})
			.where(eq(company.id, companyId));
		const [current] = await transaction
			.select({ readinessStatus: resolvedCompanyReadinessStatus() })
			.from(company)
			.where(eq(company.id, companyId))
			.limit(1);
		if (state?.frozenAt) {
			shouldRefit = true;
			const [updated] = await transaction
				.update(cohortState)
				.set({
					revision: sql`${cohortState.revision} + 1`,
					updatedAt: now
				})
				.where(eq(cohortState.id, 1))
				.returning({ revision: cohortState.revision });
			cohortRevision = updated?.revision ?? state.revision + 1;
			await transaction
				.update(pairPresentation)
				.set({ consumedAt: now })
				.where(isNull(pairPresentation.consumedAt));
		}
		return current?.readinessStatus ?? 'not_ready';
	});
	if (shouldRefit) scheduleActiveRankingRefresh(now);
	return { readinessStatus, cohortRevision };
}

export async function importCompanyProfile(
	companyId: string,
	profile: unknown,
	options: ProfileImportOptions = {}
) {
	const now = options.now ?? new Date();
	const validatedProfile = await assertProfileMatchesCompany(companyId, profile);
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
	const cohortRevision = imported.cohortRevision;
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

export async function saveExecutivePortraitBatch(
	companyId: string,
	inputs: readonly PortraitBatchUploadInput[],
	now = new Date()
): Promise<{ portraitIds: string[]; readinessStatus: ReadinessStatus }> {
	const uploads = await Promise.all(
		inputs.flatMap((input) =>
			input.images.map(async (image) => ({
				personId: input.personId,
				altText: image.altText,
				portrait: await transformPortrait(image.bytes)
			}))
		)
	);
	if (uploads.length === 0) throw new Error('Paste or select at least one image');

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

		const personIds = [...new Set(uploads.map((upload) => upload.personId))];
		const members = await transaction
			.select({ personId: person.id, name: person.canonicalName })
			.from(leadershipSlate)
			.innerJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
			.innerJoin(person, eq(person.id, leadershipMember.personId))
			.where(
				and(
					eq(leadershipSlate.companyId, companyId),
					eq(leadershipSlate.status, 'active'),
					inArray(leadershipMember.personId, personIds)
				)
			);
		const memberNames = new Map(members.map((member) => [member.personId, member.name]));
		for (const personId of personIds) {
			if (!memberNames.has(personId)) {
				throw new Error('Executive is not part of this company’s active leadership');
			}
		}

		const existing =
			personIds.length === 0
				? []
				: await transaction
						.select({
							personId: portrait.personId,
							displayOrder: portrait.displayOrder,
							sha256: portrait.sha256
						})
						.from(portrait)
						.where(inArray(portrait.personId, personIds))
						.orderBy(asc(portrait.personId), asc(portrait.displayOrder));
		const existingByPerson = new Map<string, Array<{ displayOrder: number; sha256: string }>>();
		for (const stored of existing) {
			const portraits = existingByPerson.get(stored.personId) ?? [];
			portraits.push({ displayOrder: stored.displayOrder, sha256: stored.sha256 });
			existingByPerson.set(stored.personId, portraits);
		}

		const pendingCounts = new Map<string, number>();
		const seenHashes = new Map<string, Set<string>>();
		for (const upload of uploads) {
			const stored = existingByPerson.get(upload.personId) ?? [];
			const pendingCount = pendingCounts.get(upload.personId) ?? 0;
			if (stored.length + pendingCount >= 3) {
				throw new Error('An executive can have at most three portraits');
			}
			const hashes =
				seenHashes.get(upload.personId) ?? new Set(stored.map((candidate) => candidate.sha256));
			if (hashes.has(upload.portrait.sha256)) throw new DuplicatePortraitError();
			hashes.add(upload.portrait.sha256);
			seenHashes.set(upload.personId, hashes);
			pendingCounts.set(upload.personId, pendingCount + 1);
		}

		const nextDisplayOrder = new Map(
			personIds.map((personId) => [personId, existingByPerson.get(personId)?.length ?? 0])
		);
		const values = uploads.map((upload) => {
			const displayOrder = nextDisplayOrder.get(upload.personId) ?? 0;
			nextDisplayOrder.set(upload.personId, displayOrder + 1);
			return {
				personId: upload.personId,
				displayOrder,
				image: upload.portrait.data,
				imageUrl: null,
				contentType: upload.portrait.contentType,
				width: upload.portrait.width,
				height: upload.portrait.height,
				byteLength: upload.portrait.byteLength,
				sha256: upload.portrait.sha256,
				altText: upload.altText?.trim() || `Portrait of ${memberNames.get(upload.personId) ?? ''}`,
				sourceId: null,
				createdAt: now
			};
		});
		const storedPortraits = await transaction
			.insert(portrait)
			.values(values)
			.returning({ id: portrait.id });
		if (storedPortraits.length !== uploads.length) throw new Error('Failed to save portrait batch');
		await transaction
			.update(company)
			.set({ portraitBackfillSkippedAt: null })
			.where(eq(company.id, companyId));

		const readinessStatus = await updateRevisionForReadinessChange(
			transaction,
			companyId,
			state.readinessStatus,
			state.frozenAt,
			now
		);
		shouldRefit = state.frozenAt !== null && state.readinessStatus !== readinessStatus;
		return {
			portraitIds: storedPortraits.map((storedPortrait) => storedPortrait.id),
			readinessStatus
		};
	});
	if (shouldRefit) scheduleActiveRankingRefresh(now);
	return result;
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
					manualExclusionReason: 'executive_profile_incomplete',
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
				manualExclusionReason: null,
				exclusionReferenceCompanyId: null,
				updatedAt: now
			})
			.where(
				and(
					eq(company.id, companyId),
					isNull(company.archivedAt),
					isNull(company.universeExclusionReason),
					eq(company.manualExclusionReason, 'executive_profile_incomplete')
				)
			)
			.returning({ id: company.id });
		if (!activated) throw new Error('Staged company could not be activated');
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
				retrievedAt: latestSourceRetrievedAt(retrievedAt)
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
