import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ExecutiveLeader, ExecutiveProfile, ResearchSource } from '../../research/schemas';
import { collectProfileSources } from '../../research/validation';
import * as schema from '../db/schema';
import {
	cohortState,
	company,
	executiveResearchClaim,
	leadershipMember,
	leadershipSlate,
	person,
	personFact,
	personSource,
	pairPresentation,
	portrait,
	researchSnapshot,
	securityListing,
	source
} from '../db/schema';
import { CompanyClaimError, companyClaimTokenMatches } from '../research-claims';
import { resolvedCompanyReadinessStatus } from '../readiness';
import { inspectFreezeReadiness, leadershipMembershipMatches } from './service';
import type {
	FreezeReadinessRow,
	FreezeResult,
	ImportedProfileResult,
	PreparedExecutiveProfile,
	ProfileBatchImportResult,
	ProfileWriteContext,
	ResearchImportRepository,
	UniverseImportResult,
	UniverseWriteContext
} from './types';
import type { NormalizedIssuer } from '../../research/universe';

export type ResearchDatabase = PostgresJsDatabase<typeof schema>;
type ResearchTransaction = Parameters<Parameters<ResearchDatabase['transaction']>[0]>[0];
const RESEARCH_WRITE_BATCH_SIZE = 500;

interface StoredCompany {
	id: string;
	issuerKey: string;
	name: string;
	canonicalTicker: string;
	included: boolean;
}

interface StoredLeader {
	leader: ExecutiveLeader;
	personId: string;
}

export function createDrizzleResearchRepository(
	database: ResearchDatabase
): ResearchImportRepository {
	return {
		writeUniverse(universe, context) {
			return writeUniverse(database, universe, context);
		},
		writeProfiles(profiles, context) {
			return writeProfiles(database, profiles, context);
		},
		freeze(context) {
			return freeze(database, context);
		}
	};
}

async function writeUniverse(
	database: ResearchDatabase,
	universe: NormalizedIssuer[],
	context: UniverseWriteContext
): Promise<UniverseImportResult> {
	return database.transaction(
		async (tx) => {
			await tx.execute(sql`select pg_advisory_xact_lock(187432901)`);
			const [state] = await tx
				.select({ frozenAt: cohortState.frozenAt })
				.from(cohortState)
				.where(eq(cohortState.id, 1))
				.for('update')
				.limit(1);
			if (state?.frozenAt) {
				throw new Error(
					'The normalized universe cannot be imported after the cohort has been frozen'
				);
			}

			let includedOrder = 0;
			const companyRows = universe.map((issuer) => ({
				issuerKey: issuer.issuerKey,
				cik: issuer.cik,
				name: issuer.name,
				description: issuer.description,
				homepageUrl: issuer.homepageUrl,
				sicCode: issuer.sicCode,
				sicDescription: issuer.sicDescription,
				canonicalTicker: issuer.canonicalTicker,
				marketCap: issuer.marketCap,
				included: issuer.included,
				exclusionReason: issuer.exclusionReason,
				cohortOrder: issuer.included ? ++includedOrder : null,
				updatedAt: context.importedAt
			}));
			await tx.update(securityListing).set({ isCanonical: false });
			for (const batch of chunks(companyRows, RESEARCH_WRITE_BATCH_SIZE)) {
				await tx
					.insert(company)
					.values(batch)
					.onConflictDoUpdate({
						target: company.issuerKey,
						set: {
							cik: sql`excluded.cik`,
							name: sql`excluded.name`,
							description: sql`excluded.description`,
							homepageUrl: sql`excluded.homepage_url`,
							sicCode: sql`excluded.sic_code`,
							sicDescription: sql`excluded.sic_description`,
							canonicalTicker: sql`excluded.canonical_ticker`,
							marketCap: sql`excluded.market_cap`,
							included: sql`excluded.included`,
							exclusionReason: sql`excluded.exclusion_reason`,
							cohortOrder: sql`excluded.cohort_order`,
							updatedAt: sql`excluded.updated_at`
						}
					});
			}

			const issuerKeys = universe.map((issuer) => issuer.issuerKey);
			const storedCompanies = await tx
				.select({ id: company.id, issuerKey: company.issuerKey })
				.from(company)
				.where(inArray(company.issuerKey, issuerKeys));
			const companyIds = new Map(storedCompanies.map((stored) => [stored.issuerKey, stored.id]));
			const listingRows = universe.flatMap((issuer) => {
				const companyId = companyIds.get(issuer.issuerKey);
				if (!companyId) throw new Error(`Failed to upsert company ${issuer.issuerKey}`);
				return issuer.listings.map((listing) => ({
					companyId,
					ticker: listing.ticker,
					name: listing.name,
					primaryExchange: listing.primaryExchange,
					type: listing.type,
					active: listing.active,
					compositeFigi: listing.compositeFigi,
					shareClassFigi: listing.shareClassFigi,
					marketCap: listing.marketCap,
					isCanonical: listing.isCanonical,
					lastUpdatedAt: parseOptionalDate(listing.lastUpdatedAt)
				}));
			});
			for (const batch of chunks(listingRows, RESEARCH_WRITE_BATCH_SIZE)) {
				await tx
					.insert(securityListing)
					.values(batch)
					.onConflictDoUpdate({
						target: securityListing.ticker,
						set: {
							companyId: sql`excluded.company_id`,
							name: sql`excluded.name`,
							primaryExchange: sql`excluded.primary_exchange`,
							type: sql`excluded.type`,
							active: sql`excluded.active`,
							compositeFigi: sql`excluded.composite_figi`,
							shareClassFigi: sql`excluded.share_class_figi`,
							marketCap: sql`excluded.market_cap`,
							isCanonical: sql`excluded.is_canonical`,
							lastUpdatedAt: sql`excluded.last_updated_at`
						}
					});
			}

			const listingTickers = universe.flatMap((issuer) =>
				issuer.listings.map((listing) => listing.ticker)
			);
			await tx
				.update(company)
				.set({
					included: false,
					exclusionReason: 'absent_from_latest_universe',
					cohortOrder: null,
					updatedAt: context.importedAt
				})
				.where(notInArray(company.issuerKey, issuerKeys));
			await tx
				.update(securityListing)
				.set({ active: false, isCanonical: false })
				.where(notInArray(securityListing.ticker, listingTickers));
			await tx
				.delete(executiveResearchClaim)
				.where(
					inArray(
						executiveResearchClaim.companyId,
						tx.select({ id: company.id }).from(company).where(eq(company.included, false))
					)
				);

			await tx.insert(researchSnapshot).values({
				source: 'massive',
				asOf: context.asOf,
				payload: context.snapshot,
				payloadHash: context.snapshot.payloadSha256,
				submittedByApiKeyId: context.submittedByApiKeyId
			});

			return {
				issuerCount: universe.length,
				includedCount: universe.filter((issuer) => issuer.included).length,
				excludedCount: universe.filter((issuer) => !issuer.included).length,
				listingCount: listingRows.length,
				importedAt: context.importedAt
			};
		},
		{ isolationLevel: 'serializable', accessMode: 'read write' }
	);
}

async function writeProfiles(
	database: ResearchDatabase,
	profiles: PreparedExecutiveProfile[],
	context: ProfileWriteContext
): Promise<ProfileBatchImportResult> {
	return database.transaction(
		async (tx) => {
			await tx.execute(sql`select pg_advisory_xact_lock(187432901)`);
			await tx
				.select({ id: cohortState.id })
				.from(cohortState)
				.where(eq(cohortState.id, 1))
				.for('update');
			const [latestUniverse] = await tx
				.select({ asOf: researchSnapshot.asOf })
				.from(researchSnapshot)
				.where(eq(researchSnapshot.source, 'massive'))
				.orderBy(desc(researchSnapshot.createdAt), desc(researchSnapshot.id))
				.limit(1);
			if (!latestUniverse) {
				throw new Error('Executive profiles require an imported Massive universe snapshot');
			}
			for (const prepared of profiles) {
				assertProfileFreshness(prepared.profile, latestUniverse.asOf, context.importedAt);
			}
			const imported: ImportedProfileResult[] = [];
			for (const prepared of profiles) {
				imported.push(await writeProfile(tx, prepared, context));
			}
			return { profiles: imported, importedAt: context.importedAt };
		},
		{ isolationLevel: 'serializable', accessMode: 'read write' }
	);
}

async function writeProfile(
	tx: ResearchTransaction,
	prepared: PreparedExecutiveProfile,
	context: ProfileWriteContext
): Promise<ImportedProfileResult> {
	const profile = prepared.profile;
	const storedCompany = await requireMatchingCompany(tx, profile);
	await enforceCompanyClaim(tx, storedCompany.id, context);
	const [stateBefore] = await tx
		.select({
			frozenAt: cohortState.frozenAt,
			readinessStatus: resolvedCompanyReadinessStatus()
		})
		.from(company)
		.leftJoin(cohortState, eq(cohortState.id, 1))
		.where(eq(company.id, storedCompany.id))
		.limit(1);
	const sourceIds = await upsertSources(tx, collectProfileSources(profile), context.importedAt);
	const storedLeaders: StoredLeader[] = [];

	for (const [leaderIndex, leader] of profile.leaders.entries()) {
		const preparedPortraits = prepared.portraits
			.filter((candidate) => candidate.leaderIndex === leaderIndex)
			.sort((left, right) => left.portraitIndex - right.portraitIndex);
		if (preparedPortraits.length !== leader.portraits.length) {
			throw new Error(`Missing transformed portraits for ${leader.name}`);
		}

		const personId = await upsertPerson(tx, profile, leader, context.importedAt);
		await replaceProfileSources(tx, personId, leader, sourceIds);
		await replaceFacts(tx, personId, leader);
		await replacePortraits(tx, personId, leader, preparedPortraits, sourceIds);
		storedLeaders.push({ leader, personId });
	}

	const activeSlates = await tx
		.select({ id: leadershipSlate.id, version: leadershipSlate.version })
		.from(leadershipSlate)
		.where(
			and(eq(leadershipSlate.companyId, storedCompany.id), eq(leadershipSlate.status, 'active'))
		);
	if (activeSlates.length > 1) {
		throw new Error(`Company ${profile.issuer_key} has multiple active leadership slates`);
	}

	const activeSlate = activeSlates[0];
	let slateId: string;
	let slateVersion: number;
	let action: ImportedProfileResult['action'];
	let cohortRevision: number | null = null;
	let membershipChanged = false;

	if (!activeSlate) {
		const [latest] = await tx
			.select({
				version: sql<number>`coalesce(max(${leadershipSlate.version}), 0)::int`
			})
			.from(leadershipSlate)
			.where(eq(leadershipSlate.companyId, storedCompany.id));
		slateVersion = (latest?.version ?? 0) + 1;
		slateId = await createSlate(tx, storedCompany.id, slateVersion, profile, storedLeaders);
		action = 'created';
		membershipChanged = true;
	} else {
		const activeMembers = await tx
			.select({ personId: leadershipMember.personId })
			.from(leadershipMember)
			.where(eq(leadershipMember.slateId, activeSlate.id));
		const membershipMatches = leadershipMembershipMatches(
			activeMembers.map((member) => member.personId),
			storedLeaders.map((leader) => leader.personId)
		);

		if (membershipMatches) {
			slateId = activeSlate.id;
			slateVersion = activeSlate.version;
			await refreshSlate(tx, slateId, profile, storedLeaders);
			action = 'updated';
		} else {
			await tx
				.update(leadershipSlate)
				.set({
					status: 'retired',
					retiredAt: context.importedAt
				})
				.where(eq(leadershipSlate.id, activeSlate.id));
			slateVersion = activeSlate.version + 1;
			slateId = await createSlate(tx, storedCompany.id, slateVersion, profile, storedLeaders);
			action = 'replaced';
			membershipChanged = true;
		}
	}

	const [stateAfter] = await tx
		.select({ readinessStatus: resolvedCompanyReadinessStatus() })
		.from(company)
		.where(eq(company.id, storedCompany.id))
		.limit(1);
	if (
		stateBefore?.frozenAt &&
		storedCompany.included &&
		(membershipChanged || stateBefore.readinessStatus !== stateAfter?.readinessStatus)
	) {
		cohortRevision = await bumpCohortRevision(tx, context.pairingSeed, context.importedAt);
	}

	await tx
		.update(company)
		.set({ updatedAt: context.importedAt })
		.where(eq(company.id, storedCompany.id));
	await tx
		.delete(executiveResearchClaim)
		.where(eq(executiveResearchClaim.companyId, storedCompany.id));
	await tx.insert(researchSnapshot).values({
		source: `executive_profile:${profile.issuer_key}`,
		asOf: context.importedAt,
		payload: profile,
		payloadHash: profilePayloadHash(profile),
		submittedByApiKeyId: context.submittedByApiKeyId
	});

	return {
		issuerKey: profile.issuer_key,
		companyId: storedCompany.id,
		slateId,
		slateVersion,
		action,
		cohortRevision,
		readinessStatus: stateAfter?.readinessStatus ?? 'not_ready',
		acceptedPortraitCount: prepared.portraits.length,
		portraitDiagnostics: prepared.portraitDiagnostics
	};
}

async function requireMatchingCompany(
	tx: ResearchTransaction,
	profile: ExecutiveProfile
): Promise<StoredCompany> {
	const [stored] = await tx
		.select({
			id: company.id,
			issuerKey: company.issuerKey,
			name: company.name,
			canonicalTicker: company.canonicalTicker,
			included: company.included
		})
		.from(company)
		.where(eq(company.issuerKey, profile.issuer_key))
		.for('update')
		.limit(1);
	if (!stored) {
		throw new Error(`No normalized-universe company exists for issuer_key ${profile.issuer_key}`);
	}
	if (stored.canonicalTicker !== profile.canonical_ticker) {
		throw new Error(
			`Profile ticker ${profile.canonical_ticker} does not match stored ticker ${stored.canonicalTicker}`
		);
	}
	if (stored.name !== profile.company_name) {
		throw new Error(
			`Profile company name ${JSON.stringify(profile.company_name)} does not match stored name ${JSON.stringify(stored.name)}`
		);
	}
	return stored;
}

async function enforceCompanyClaim(
	tx: ResearchTransaction,
	companyId: string,
	context: ProfileWriteContext
): Promise<void> {
	if (context.publicationClaims === null) return;

	const proof = context.publicationClaims.find((claim) => claim.companyId === companyId);
	const [claim] = await tx
		.select({
			tokenHash: executiveResearchClaim.tokenHash,
			expiresAt: executiveResearchClaim.expiresAt
		})
		.from(executiveResearchClaim)
		.where(eq(executiveResearchClaim.companyId, companyId))
		.for('update')
		.limit(1);

	if (!claim) {
		if (proof?.tokenHash) {
			throw new CompanyClaimError(
				'claim_token_invalid',
				'The company has no active claim for this token'
			);
		}
		return;
	}

	const tokenMatches =
		proof?.tokenHash !== null &&
		proof?.tokenHash !== undefined &&
		companyClaimTokenMatches(claim.tokenHash, proof.tokenHash);
	if (claim.expiresAt <= context.claimCheckedAt) {
		if (tokenMatches) {
			throw new CompanyClaimError('claim_expired', 'The company claim has expired');
		}
		if (proof?.tokenHash) {
			throw new CompanyClaimError('claim_token_invalid', 'The company claim token is invalid');
		}
		await tx.delete(executiveResearchClaim).where(eq(executiveResearchClaim.companyId, companyId));
		return;
	}
	if (!proof?.tokenHash) {
		throw new CompanyClaimError(
			'claim_required',
			'This company is actively claimed; provide its claim token to publish'
		);
	}
	if (!tokenMatches) {
		throw new CompanyClaimError('claim_token_invalid', 'The company claim token is invalid');
	}
}

async function upsertSources(
	tx: ResearchTransaction,
	sources: ResearchSource[],
	retrievedAt: Date
): Promise<Map<string, string>> {
	const sourceIds = new Map<string, string>();
	for (const researchSource of sources) {
		const [existing] = await tx
			.select({
				id: source.id,
				retrievedAt: source.retrievedAt
			})
			.from(source)
			.where(eq(source.url, researchSource.url))
			.limit(1);
		if (existing && existing.retrievedAt > retrievedAt) {
			sourceIds.set(researchSource.url, existing.id);
			continue;
		}
		const metadata = sourceMetadata(researchSource);
		const [stored] = await tx
			.insert(source)
			.values({
				url: researchSource.url,
				title: metadata.title,
				publisher: metadata.publisher,
				retrievedAt
			})
			.onConflictDoUpdate({
				target: source.url,
				set: {
					title: metadata.title,
					publisher: metadata.publisher,
					retrievedAt: sql`greatest(${source.retrievedAt}, ${retrievedAt})`
				}
			})
			.returning({ id: source.id });
		if (!stored) throw new Error(`Failed to upsert source ${researchSource.url}`);
		sourceIds.set(researchSource.url, stored.id);
	}
	return sourceIds;
}

async function upsertPerson(
	tx: ResearchTransaction,
	profile: ExecutiveProfile,
	leader: ExecutiveLeader,
	importedAt: Date
): Promise<string> {
	const slug = personSlug(profile.issuer_key, leader.name);
	const [stored] = await tx
		.insert(person)
		.values({
			canonicalName: leader.name,
			slug,
			summary: leader.summary,
			leadershipAsOf: profile.leadership_as_of,
			updatedAt: importedAt
		})
		.onConflictDoUpdate({
			target: person.slug,
			set: {
				canonicalName: leader.name,
				summary: leader.summary,
				leadershipAsOf: profile.leadership_as_of,
				updatedAt: importedAt
			}
		})
		.returning({ id: person.id });
	if (!stored) throw new Error(`Failed to upsert person ${leader.name}`);
	return stored.id;
}

async function replaceProfileSources(
	tx: ResearchTransaction,
	personId: string,
	leader: ExecutiveLeader,
	sourceIds: Map<string, string>
): Promise<void> {
	await tx.delete(personSource).where(eq(personSource.personId, personId));
	const ids = unique(
		leader.sources.map((researchSource) => requireSourceId(sourceIds, researchSource.url))
	);
	await tx.insert(personSource).values(ids.map((sourceId) => ({ personId, sourceId })));
}

async function replaceFacts(
	tx: ResearchTransaction,
	personId: string,
	leader: ExecutiveLeader
): Promise<void> {
	await tx.delete(personFact).where(eq(personFact.personId, personId));
	for (const [sortOrder, fact] of leader.facts.entries()) {
		const [storedFact] = await tx
			.insert(personFact)
			.values({
				personId,
				category: fact.category,
				value: fact.value,
				sortOrder
			})
			.returning({ id: personFact.id });
		if (!storedFact) throw new Error(`Failed to insert fact for ${leader.name}`);
	}
}

async function replacePortraits(
	tx: ResearchTransaction,
	personId: string,
	leader: ExecutiveLeader,
	preparedPortraits: PreparedExecutiveProfile['portraits'],
	sourceIds: Map<string, string>
): Promise<void> {
	if (preparedPortraits.length === 0) return;
	await tx.delete(portrait).where(eq(portrait.personId, personId));
	await tx.insert(portrait).values(
		preparedPortraits.map(({ portraitIndex, portrait: transformed }) => ({
			personId,
			displayOrder: portraitIndex,
			image: transformed.data,
			imageUrl: leader.portraits[portraitIndex]!.image_url,
			contentType: transformed.contentType,
			width: transformed.width,
			height: transformed.height,
			byteLength: transformed.byteLength,
			sha256: transformed.sha256,
			altText: leader.portraits[portraitIndex]!.alt_text,
			sourceId: leader.portraits[portraitIndex]!.source
				? requireSourceId(sourceIds, leader.portraits[portraitIndex]!.source.url)
				: null
		}))
	);
}

async function createSlate(
	tx: ResearchTransaction,
	companyId: string,
	version: number,
	profile: ExecutiveProfile,
	leaders: StoredLeader[]
): Promise<string> {
	const [storedSlate] = await tx
		.insert(leadershipSlate)
		.values({
			companyId,
			version,
			status: 'active',
			effectiveAt: profile.leadership_as_of
		})
		.returning({ id: leadershipSlate.id });
	if (!storedSlate) throw new Error(`Failed to create slate for ${profile.issuer_key}`);
	await insertSlateMembers(tx, storedSlate.id, leaders);
	return storedSlate.id;
}

async function refreshSlate(
	tx: ResearchTransaction,
	slateId: string,
	profile: ExecutiveProfile,
	leaders: StoredLeader[]
): Promise<void> {
	await tx
		.update(leadershipSlate)
		.set({ effectiveAt: profile.leadership_as_of })
		.where(eq(leadershipSlate.id, slateId));
	for (const [displayOrder, storedLeader] of leaders.entries()) {
		await tx
			.update(leadershipMember)
			.set({
				title: storedLeader.leader.title,
				roleKind: storedLeader.leader.role_kind,
				isInterim: storedLeader.leader.is_interim,
				displayOrder
			})
			.where(
				and(
					eq(leadershipMember.slateId, slateId),
					eq(leadershipMember.personId, storedLeader.personId)
				)
			);
	}
}

async function insertSlateMembers(
	tx: ResearchTransaction,
	slateId: string,
	leaders: StoredLeader[]
): Promise<void> {
	await tx.insert(leadershipMember).values(
		leaders.map((storedLeader, displayOrder) => ({
			slateId,
			personId: storedLeader.personId,
			title: storedLeader.leader.title,
			roleKind: storedLeader.leader.role_kind,
			isInterim: storedLeader.leader.is_interim,
			displayOrder
		}))
	);
}

async function bumpCohortRevision(
	tx: ResearchTransaction,
	pairingSeed: string,
	updatedAt: Date
): Promise<number> {
	await tx
		.insert(cohortState)
		.values({
			id: 1,
			revision: 1,
			pairingSeed,
			updatedAt
		})
		.onConflictDoNothing({ target: cohortState.id });
	const [state] = await tx
		.update(cohortState)
		.set({
			revision: sql`${cohortState.revision} + 1`,
			pairingSeed,
			updatedAt
		})
		.where(eq(cohortState.id, 1))
		.returning({ revision: cohortState.revision });
	if (!state) throw new Error('Failed to increment the cohort revision');
	await tx
		.update(pairPresentation)
		.set({ consumedAt: updatedAt })
		.where(isNull(pairPresentation.consumedAt));
	return state.revision;
}

async function freeze(
	database: ResearchDatabase,
	context: { frozenAt: Date; pairingSeed: string }
): Promise<FreezeResult> {
	return database.transaction(
		async (tx) => {
			await tx.execute(sql`select pg_advisory_xact_lock(187432901)`);
			await tx
				.select({ id: cohortState.id })
				.from(cohortState)
				.where(eq(cohortState.id, 1))
				.for('update');
			const readinessRows = await loadFreezeReadinessRows(tx);
			const includedCount = new Set(readinessRows.map((row) => row.issuerKey)).size;
			if (includedCount < 2) {
				throw new Error(
					`Cohort freeze requires at least two included companies; found ${includedCount}`
				);
			}
			const issues = inspectFreezeReadiness(readinessRows);
			if (issues.length > 0) {
				const preview = issues
					.slice(0, 10)
					.map((issue) => `${issue.issuerKey}: ${issue.message}`)
					.join('; ');
				const remainder = issues.length > 10 ? `; and ${issues.length - 10} more issue(s)` : '';
				throw new Error(`Cohort is not ready to freeze: ${preview}${remainder}`);
			}

			const [existing] = await tx
				.select({
					revision: cohortState.revision,
					pairingSeed: cohortState.pairingSeed,
					frozenAt: cohortState.frozenAt
				})
				.from(cohortState)
				.where(eq(cohortState.id, 1))
				.limit(1);
			if (existing?.frozenAt) {
				return {
					includedCount,
					revision: existing.revision,
					pairingSeed: existing.pairingSeed,
					frozenAt: existing.frozenAt,
					alreadyFrozen: true
				};
			}

			if (!existing) {
				const [created] = await tx
					.insert(cohortState)
					.values({
						id: 1,
						revision: 1,
						pairingSeed: context.pairingSeed,
						frozenAt: context.frozenAt,
						updatedAt: context.frozenAt
					})
					.returning({
						revision: cohortState.revision,
						pairingSeed: cohortState.pairingSeed,
						frozenAt: cohortState.frozenAt
					});
				if (!created?.frozenAt) throw new Error('Failed to initialize cohort state');
				return {
					includedCount,
					revision: created.revision,
					pairingSeed: created.pairingSeed,
					frozenAt: created.frozenAt,
					alreadyFrozen: false
				};
			}

			const [updated] = await tx
				.update(cohortState)
				.set({ frozenAt: context.frozenAt, updatedAt: context.frozenAt })
				.where(eq(cohortState.id, 1))
				.returning({
					revision: cohortState.revision,
					pairingSeed: cohortState.pairingSeed,
					frozenAt: cohortState.frozenAt
				});
			if (!updated?.frozenAt) throw new Error('Failed to freeze cohort state');
			return {
				includedCount,
				revision: updated.revision,
				pairingSeed: updated.pairingSeed,
				frozenAt: updated.frozenAt,
				alreadyFrozen: false
			};
		},
		{ isolationLevel: 'serializable', accessMode: 'read write' }
	);
}

async function loadFreezeReadinessRows(tx: ResearchTransaction): Promise<FreezeReadinessRow[]> {
	const result = await tx.execute(sql`
		with profile_sources as (
			select person_id, count(*)::int as source_count
			from person_source
			group by person_id
		),
		portrait_totals as (
			select person_id, count(*)::int as portrait_count
			from portrait
			group by person_id
		)
			select
				c.issuer_key as "issuerKey",
				c.name as "companyName",
				ls.id::text as "slateId",
			lm.person_id::text as "personId",
			coalesce(pt.portrait_count, 0)::int as "portraitCount",
			coalesce(ps.source_count, 0)::int as "profileSourceCount"
		from company c
		left join leadership_slate ls
			on ls.company_id = c.id and ls.status = 'active'
		left join leadership_member lm
			on lm.slate_id = ls.id
		left join portrait_totals pt on pt.person_id = lm.person_id
		left join profile_sources ps on ps.person_id = lm.person_id
		where c.included
		order by c.issuer_key, ls.id, lm.person_id
	`);
	return Array.from(result).map((row) => ({
		issuerKey: String(row.issuerKey),
		companyName: String(row.companyName),
		slateId: row.slateId === null ? null : String(row.slateId),
		personId: row.personId === null ? null : String(row.personId),
		portraitCount: Number(row.portraitCount),
		profileSourceCount: Number(row.profileSourceCount)
	}));
}

function personSlug(issuerKey: string, name: string): string {
	const stem =
		name
			.normalize('NFKD')
			.replace(/\p{M}+/gu, '')
			.toLocaleLowerCase('en-US')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 80)
			.replace(/-+$/g, '') || 'leader';
	const digest = createHash('sha256')
		.update(`${issuerKey}\0${name.normalize('NFKC').toLocaleLowerCase('en-US')}`)
		.digest('hex')
		.slice(0, 12);
	return `${stem}-${digest}`;
}

export function profilePayloadHash(profile: ExecutiveProfile): string {
	return createHash('sha256').update(JSON.stringify(profile)).digest('base64url');
}

function parseDateOnly(value: string): Date {
	return new Date(`${value}T00:00:00.000Z`);
}

function assertProfileFreshness(
	profile: ExecutiveProfile,
	universeAsOf: Date,
	importedAt: Date
): void {
	const leadershipAsOf = parseDateOnly(profile.leadership_as_of);
	if (leadershipAsOf < universeAsOf) {
		throw new Error(
			`Profile ${profile.issuer_key} leadership_as_of ${profile.leadership_as_of} predates the Massive universe snapshot ${universeAsOf.toISOString().slice(0, 10)}`
		);
	}
	if (leadershipAsOf > importedAt) {
		throw new Error(
			`Profile ${profile.issuer_key} leadership_as_of ${profile.leadership_as_of} is in the future`
		);
	}

	void importedAt;
}

function sourceMetadata(researchSource: ResearchSource): { title: string; publisher: string } {
	const parsed = new URL(researchSource.url);
	const publisher = researchSource.publisher ?? parsed.hostname.replace(/^www\./, '');
	const pathTitle = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) ?? '')
		.replace(/[-_]+/g, ' ')
		.trim();
	return {
		title: researchSource.title ?? (pathTitle || publisher),
		publisher
	};
}

function parseOptionalDate(value: string | null): Date | null {
	if (value === null) return null;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`Invalid listing lastUpdatedAt value ${JSON.stringify(value)}`);
	}
	return parsed;
}

function requireSourceId(sourceIds: Map<string, string>, url: string): string {
	const sourceId = sourceIds.get(url);
	if (!sourceId) throw new Error(`Missing imported source ${url}`);
	return sourceId;
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function chunks<T>(values: readonly T[], size: number): T[][] {
	const batches: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		batches.push(values.slice(index, index + size));
	}
	return batches;
}
