import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ExecutiveLeader, ExecutiveProfile, ResearchSource } from '../../research/schemas';
import { collectProfileSources } from '../../research/validation';
import * as schema from '../db/schema';
import {
	cohortState,
	company,
	executiveResearchIssue,
	leadershipMember,
	leadershipMemberSource,
	leadershipSlate,
	person,
	personFact,
	personFactSource,
	personSource,
	portrait,
	researchSnapshot,
	securityListing,
	source
} from '../db/schema';
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
	readinessStatus: schema.ReadinessStatus;
}

interface StoredLeader {
	leader: ExecutiveLeader;
	personId: string;
	roleSourceId: string;
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
			const snapshotDate = context.asOf.toISOString().slice(0, 10);
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
				readinessStatus: issuer.included ? ('pending' as const) : ('excluded' as const),
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
							readinessStatus: sql<schema.ReadinessStatus>`case
									when not excluded.included then 'excluded'
									when exists (
										select 1
										from ${leadershipSlate}
										where ${leadershipSlate.companyId} = ${company.id}
											and ${leadershipSlate.status} = 'active'
											and ${leadershipSlate.effectiveAt}::date >= ${snapshotDate}::date
									)
									then 'ready'
									else 'pending'
								end`,
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
					readinessStatus: 'excluded',
					exclusionReason: 'absent_from_latest_universe',
					cohortOrder: null,
					updatedAt: context.importedAt
				})
				.where(notInArray(company.issuerKey, issuerKeys));
			await tx
				.update(securityListing)
				.set({ active: false, isCanonical: false })
				.where(notInArray(securityListing.ticker, listingTickers));

			await tx.insert(researchSnapshot).values({
				source: 'massive',
				asOf: context.asOf,
				payload: context.snapshot
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
	const sourceIds = await upsertSources(tx, collectProfileSources(profile));
	const storedLeaders: StoredLeader[] = [];

	for (const [leaderIndex, leader] of profile.leaders.entries()) {
		const preparedPortrait = prepared.portraits.find(
			(candidate) => candidate.leaderIndex === leaderIndex
		);
		if (!preparedPortrait) {
			throw new Error(`Missing transformed portrait for ${leader.name}`);
		}

		const personId = await upsertPerson(tx, profile, leader, context.importedAt);
		await replaceSummarySources(tx, personId, leader, sourceIds);
		await replaceFacts(tx, personId, leader, sourceIds);
		await upsertPortrait(
			tx,
			personId,
			leader,
			preparedPortrait.portrait,
			requireSourceId(sourceIds, leader.portrait.source.url)
		);
		storedLeaders.push({
			leader,
			personId,
			roleSourceId: requireSourceId(sourceIds, leader.role_source.url)
		});
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

		const [state] = await tx
			.select({ frozenAt: cohortState.frozenAt })
			.from(cohortState)
			.where(eq(cohortState.id, 1))
			.limit(1);
		if (state?.frozenAt && storedCompany.included) {
			cohortRevision = await bumpCohortRevision(tx, context.pairingSeed, context.importedAt);
		}
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
			const [state] = await tx
				.select({ frozenAt: cohortState.frozenAt })
				.from(cohortState)
				.where(eq(cohortState.id, 1))
				.limit(1);
			if (state?.frozenAt && storedCompany.included) {
				cohortRevision = await bumpCohortRevision(tx, context.pairingSeed, context.importedAt);
			}
		}
	}

	await tx
		.update(company)
		.set({ readinessStatus: 'ready', updatedAt: context.importedAt })
		.where(eq(company.id, storedCompany.id));
	await tx.insert(researchSnapshot).values({
		source: `executive_profile:${profile.issuer_key}`,
		asOf: context.importedAt,
		payload: profile,
		payloadHash: profilePayloadHash(profile),
		submittedByApiKeyId: context.submittedByApiKeyId
	});
	if (context.submittedByApiKeyId) {
		await tx
			.update(executiveResearchIssue)
			.set({ resolvedAt: context.importedAt, updatedAt: context.importedAt })
			.where(
				and(
					eq(executiveResearchIssue.companyId, storedCompany.id),
					sql`${executiveResearchIssue.resolvedAt} is null`
				)
			);
	}

	return {
		issuerKey: profile.issuer_key,
		companyId: storedCompany.id,
		slateId,
		slateVersion,
		action,
		cohortRevision
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
			included: company.included,
			readinessStatus: company.readinessStatus
		})
		.from(company)
		.where(eq(company.issuerKey, profile.issuer_key))
		.limit(1);
	if (!stored) {
		throw new Error(`No normalized-universe company exists for issuer_key ${profile.issuer_key}`);
	}
	if (!stored.included && stored.readinessStatus !== 'pending') {
		throw new Error(`Cannot import a profile for excluded company ${profile.issuer_key}`);
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

async function upsertSources(
	tx: ResearchTransaction,
	sources: ResearchSource[]
): Promise<Map<string, string>> {
	const sourceIds = new Map<string, string>();
	for (const researchSource of sources) {
		const [existing] = await tx
			.select({
				id: source.id,
				kind: source.kind,
				retrievedAt: source.retrievedAt
			})
			.from(source)
			.where(eq(source.url, researchSource.url))
			.limit(1);
		if (existing?.kind !== undefined && existing.kind !== researchSource.kind) {
			throw new Error(
				`Source ${researchSource.url} was previously classified as ${existing.kind}, not ${researchSource.kind}`
			);
		}
		const incomingRetrievedAt = parseDateOnly(researchSource.retrieved_at);
		if (existing && existing.retrievedAt > incomingRetrievedAt) {
			sourceIds.set(researchSource.url, existing.id);
			continue;
		}
		const [stored] = await tx
			.insert(source)
			.values({
				url: researchSource.url,
				title: researchSource.title,
				publisher: researchSource.publisher,
				kind: researchSource.kind,
				retrievedAt: incomingRetrievedAt
			})
			.onConflictDoUpdate({
				target: source.url,
				set: {
					title: researchSource.title,
					publisher: researchSource.publisher,
					kind: researchSource.kind,
					retrievedAt: sql`greatest(${source.retrievedAt}, ${researchSource.retrieved_at}::date)`
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

async function replaceSummarySources(
	tx: ResearchTransaction,
	personId: string,
	leader: ExecutiveLeader,
	sourceIds: Map<string, string>
): Promise<void> {
	await tx.delete(personSource).where(eq(personSource.personId, personId));
	const ids = unique(
		leader.summary_sources.map((researchSource) => requireSourceId(sourceIds, researchSource.url))
	);
	await tx
		.insert(personSource)
		.values(ids.map((sourceId) => ({ personId, sourceId, kind: 'summary' as const })));
}

async function replaceFacts(
	tx: ResearchTransaction,
	personId: string,
	leader: ExecutiveLeader,
	sourceIds: Map<string, string>
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
		const ids = unique(
			fact.sources.map((researchSource) => requireSourceId(sourceIds, researchSource.url))
		);
		await tx
			.insert(personFactSource)
			.values(ids.map((sourceId) => ({ factId: storedFact.id, sourceId })));
	}
}

async function upsertPortrait(
	tx: ResearchTransaction,
	personId: string,
	leader: ExecutiveLeader,
	transformed: PreparedExecutiveProfile['portraits'][number]['portrait'],
	sourceId: string
): Promise<void> {
	await tx
		.insert(portrait)
		.values({
			personId,
			image: transformed.data,
			imageUrl: leader.portrait.image_url,
			contentType: transformed.contentType,
			width: transformed.width,
			height: transformed.height,
			byteLength: transformed.byteLength,
			sha256: transformed.sha256,
			altText: leader.portrait.alt_text,
			sourceId
		})
		.onConflictDoUpdate({
			target: portrait.personId,
			set: {
				image: transformed.data,
				imageUrl: leader.portrait.image_url,
				contentType: transformed.contentType,
				width: transformed.width,
				height: transformed.height,
				byteLength: transformed.byteLength,
				sha256: transformed.sha256,
				altText: leader.portrait.alt_text,
				sourceId
			}
		});
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
	await tx.delete(leadershipMemberSource).where(eq(leadershipMemberSource.slateId, slateId));
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
	await insertRoleSources(tx, slateId, leaders);
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
	await insertRoleSources(tx, slateId, leaders);
}

async function insertRoleSources(
	tx: ResearchTransaction,
	slateId: string,
	leaders: StoredLeader[]
): Promise<void> {
	await tx.insert(leadershipMemberSource).values(
		leaders.map((storedLeader) => ({
			slateId,
			personId: storedLeader.personId,
			sourceId: storedLeader.roleSourceId
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
			updatedAt
		})
		.where(eq(cohortState.id, 1))
		.returning({ revision: cohortState.revision });
	if (!state) throw new Error('Failed to increment the cohort revision');
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
		with summary_sources as (
			select person_id, count(*)::int as source_count
			from person_source
			where kind = 'summary'
			group by person_id
		),
		role_sources as (
			select slate_id, person_id, count(*)::int as source_count
			from leadership_member_source
			group by slate_id, person_id
		),
		fact_totals as (
			select person_id, count(*)::int as fact_count
			from person_fact
			group by person_id
		),
		cited_fact_totals as (
			select pf.person_id, count(distinct pf.id)::int as cited_fact_count
			from person_fact pf
			inner join person_fact_source pfs on pfs.fact_id = pf.id
			group by pf.person_id
		)
		select
			c.issuer_key as "issuerKey",
			c.name as "companyName",
			c.readiness_status as "readinessStatus",
			ls.id::text as "slateId",
			lm.person_id::text as "personId",
			po.id::text as "portraitId",
			coalesce(ss.source_count, 0)::int as "summarySourceCount",
			coalesce(rs.source_count, 0)::int as "roleSourceCount",
			coalesce(ft.fact_count, 0)::int as "factCount",
			coalesce(cft.cited_fact_count, 0)::int as "citedFactCount"
		from company c
		left join leadership_slate ls
			on ls.company_id = c.id and ls.status = 'active'
		left join leadership_member lm
			on lm.slate_id = ls.id
		left join portrait po
			on po.person_id = lm.person_id
		left join summary_sources ss on ss.person_id = lm.person_id
		left join role_sources rs
			on rs.slate_id = lm.slate_id and rs.person_id = lm.person_id
		left join fact_totals ft on ft.person_id = lm.person_id
		left join cited_fact_totals cft on cft.person_id = lm.person_id
		where c.included
		order by c.issuer_key, ls.id, lm.person_id
	`);
	return Array.from(result).map((row) => ({
		issuerKey: String(row.issuerKey),
		companyName: String(row.companyName),
		readinessStatus: String(row.readinessStatus),
		slateId: row.slateId === null ? null : String(row.slateId),
		personId: row.personId === null ? null : String(row.personId),
		portraitId: row.portraitId === null ? null : String(row.portraitId),
		summarySourceCount: Number(row.summarySourceCount),
		roleSourceCount: Number(row.roleSourceCount),
		factCount: Number(row.factCount),
		citedFactCount: Number(row.citedFactCount)
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
	const importDate = parseDateOnly(importedAt.toISOString().slice(0, 10));
	if (leadershipAsOf < universeAsOf) {
		throw new Error(
			`Profile ${profile.issuer_key} leadership_as_of ${profile.leadership_as_of} predates the Massive universe snapshot ${universeAsOf.toISOString().slice(0, 10)}`
		);
	}
	if (leadershipAsOf > importDate) {
		throw new Error(
			`Profile ${profile.issuer_key} leadership_as_of ${profile.leadership_as_of} is in the future`
		);
	}

	for (const leader of profile.leaders) {
		const roleRetrievedAt = parseDateOnly(leader.role_source.retrieved_at);
		if (roleRetrievedAt < universeAsOf) {
			throw new Error(
				`Profile ${profile.issuer_key} role source for ${leader.name} predates the Massive universe snapshot`
			);
		}
		if (roleRetrievedAt > leadershipAsOf) {
			throw new Error(
				`Profile ${profile.issuer_key} role source for ${leader.name} was retrieved after leadership_as_of`
			);
		}
	}

	for (const researchSource of collectProfileSources(profile)) {
		if (parseDateOnly(researchSource.retrieved_at) > importDate) {
			throw new Error(
				`Profile ${profile.issuer_key} source ${researchSource.url} has a future retrieval date`
			);
		}
	}
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
