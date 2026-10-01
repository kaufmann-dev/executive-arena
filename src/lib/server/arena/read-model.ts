import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { CompanyExclusionReason } from '#lib/company-exclusion.js';
import { db } from '#lib/server/db/index.js';
import {
	cohortState,
	comparison,
	company,
	leadershipMember,
	leadershipSlate,
	person,
	personFact,
	personSource,
	portrait,
	rankingEntry,
	rankingRun,
	securityListing,
	source
} from '#lib/server/db/schema.js';
import { resolvedCompanyReadinessStatus } from '#lib/server/readiness.js';
import type { CompanyStatusFilter } from '#lib/companies-page.js';
import type {
	CompanyPortraitReview,
	LeaderboardRow,
	LeaderProfile,
	LeadershipCard,
	ReadinessSummary
} from './types';

function groupCards(
	rows: Array<{
		companyId: string;
		slateId: string;
		companyName: string;
		ticker: string;
		description: string;
		homepageUrl: string | null;
		marketCap: number | null;
		effectiveAt: string;
		personId: string;
		personName: string;
		summary: string;
		leadershipAsOf: string;
		title: string;
		roleKind: string;
		isInterim: boolean;
		displayOrder: number;
		portraitId: string | null;
		portraitDisplayOrder: number | null;
		portraitImageUrl: string | null;
		portraitAltText: string | null;
		portraitSourceId: string | null;
		portraitSourceUrl: string | null;
		portraitSourceTitle: string | null;
		portraitSourcePublisher: string | null;
		portraitSourceRetrievedAt: Date | null;
	}>
): LeadershipCard[] {
	const cards = new Map<string, LeadershipCard>();
	for (const row of rows) {
		let card = cards.get(row.slateId);
		if (!card) {
			card = {
				companyId: row.companyId,
				slateId: row.slateId,
				companyName: row.companyName,
				ticker: row.ticker,
				description: row.description,
				homepageUrl: row.homepageUrl,
				marketCap: row.marketCap,
				effectiveAt: row.effectiveAt,
				leaders: []
			};
			cards.set(row.slateId, card);
		}
		let leader = card.leaders.find((candidate) => candidate.id === row.personId);
		if (!leader) {
			leader = {
				id: row.personId,
				name: row.personName,
				summary: row.summary,
				leadershipAsOf: row.leadershipAsOf,
				title: row.title,
				roleKind: row.roleKind,
				isInterim: row.isInterim,
				portraits: [],
				sources: [],
				facts: []
			};
			card.leaders.push(leader);
		}
		if (row.portraitId && row.portraitAltText) {
			leader.portraits.push({
				id: row.portraitId,
				imageUrl: row.portraitImageUrl,
				altText: row.portraitAltText,
				source:
					row.portraitSourceId &&
					row.portraitSourceUrl &&
					row.portraitSourceTitle &&
					row.portraitSourcePublisher &&
					row.portraitSourceRetrievedAt
						? {
								id: row.portraitSourceId,
								url: row.portraitSourceUrl,
								title: row.portraitSourceTitle,
								publisher: row.portraitSourcePublisher,
								retrievedAt: row.portraitSourceRetrievedAt
							}
						: null
			});
		}
	}
	return [...cards.values()];
}

export function buildPersonFactsQuery(personIds: string[]) {
	return db
		.select({
			id: personFact.id,
			personId: personFact.personId,
			category: personFact.category,
			value: personFact.value
		})
		.from(personFact)
		.where(inArray(personFact.personId, personIds))
		.orderBy(asc(personFact.sortOrder), asc(personFact.id));
}

async function attachFacts(cards: LeadershipCard[]): Promise<void> {
	const leaders = cards.flatMap((card) => card.leaders);
	const personIds = leaders.map((leader) => leader.id);
	if (personIds.length === 0) return;

	const facts = await buildPersonFactsQuery(personIds);

	const byPerson = new Map(leaders.map((leader) => [leader.id, leader]));
	for (const fact of facts) {
		byPerson.get(fact.personId)?.facts.push({
			id: fact.id,
			category: fact.category,
			value: fact.value
		});
	}
}

async function attachLeaderSources(cards: LeadershipCard[]): Promise<void> {
	const leaders = cards.flatMap((card) => card.leaders);
	const personIds = leaders.map((leader) => leader.id);
	if (personIds.length === 0) return;

	const profileSources = await db
		.select({
			personId: personSource.personId,
			id: source.id,
			url: source.url,
			title: source.title,
			publisher: source.publisher,
			retrievedAt: source.retrievedAt
		})
		.from(personSource)
		.innerJoin(source, eq(source.id, personSource.sourceId))
		.where(inArray(personSource.personId, personIds))
		.orderBy(asc(source.publisher), asc(source.url));

	const leadersByPerson = new Map(leaders.map((leader) => [leader.id, leader]));
	for (const profileSource of profileSources) {
		leadersByPerson.get(profileSource.personId)?.sources.push(toProfileSource(profileSource));
	}
}

function toProfileSource(record: {
	id: string;
	url: string;
	title: string;
	publisher: string;
	retrievedAt: Date;
}): LeaderProfile['sources'][number] {
	return record;
}

export async function getLeadershipCards(slateIds: string[]): Promise<LeadershipCard[]> {
	if (slateIds.length === 0) return [];
	const rows = await db
		.select({
			companyId: company.id,
			slateId: leadershipSlate.id,
			companyName: company.name,
			ticker: company.canonicalTicker,
			description: company.description,
			homepageUrl: company.homepageUrl,
			marketCap: company.marketCap,
			effectiveAt: leadershipSlate.effectiveAt,
			personId: person.id,
			personName: person.canonicalName,
			summary: person.summary,
			leadershipAsOf: person.leadershipAsOf,
			title: leadershipMember.title,
			roleKind: leadershipMember.roleKind,
			isInterim: leadershipMember.isInterim,
			displayOrder: leadershipMember.displayOrder,
			portraitId: portrait.id,
			portraitDisplayOrder: portrait.displayOrder,
			portraitImageUrl: portrait.imageUrl,
			portraitAltText: portrait.altText,
			portraitSourceId: source.id,
			portraitSourceUrl: source.url,
			portraitSourceTitle: source.title,
			portraitSourcePublisher: source.publisher,
			portraitSourceRetrievedAt: source.retrievedAt
		})
		.from(leadershipSlate)
		.innerJoin(company, eq(company.id, leadershipSlate.companyId))
		.innerJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
		.innerJoin(person, eq(person.id, leadershipMember.personId))
		.leftJoin(portrait, eq(portrait.personId, person.id))
		.leftJoin(source, eq(source.id, portrait.sourceId))
		.where(inArray(leadershipSlate.id, slateIds))
		.orderBy(
			asc(leadershipMember.displayOrder),
			asc(person.canonicalName),
			asc(portrait.displayOrder)
		);

	const cards = groupCards(rows);
	await Promise.all([attachFacts(cards), attachLeaderSources(cards)]);
	const order = new Map(slateIds.map((id, index) => [id, index]));
	return cards.sort((a, b) => (order.get(a.slateId) ?? 0) - (order.get(b.slateId) ?? 0));
}

async function getCompanyCardForState(
	companyId: string,
	includedOnly: boolean
): Promise<LeadershipCard | null> {
	const [slate] = await db
		.select({ id: leadershipSlate.id })
		.from(leadershipSlate)
		.innerJoin(company, eq(company.id, leadershipSlate.companyId))
		.where(
			and(
				eq(leadershipSlate.companyId, companyId),
				eq(leadershipSlate.status, 'active'),
				isNull(company.archivedAt),
				includedOnly ? eq(company.included, true) : undefined
			)
		)
		.limit(1);
	if (!slate) return null;
	return (await getLeadershipCards([slate.id]))[0] ?? null;
}

export function getCompanyCard(companyId: string): Promise<LeadershipCard | null> {
	return getCompanyCardForState(companyId, true);
}

export interface LeaderboardQuery {
	q: string;
	page: number;
	pageSize: number;
	sort: 'rank' | 'company' | 'score' | 'comparisons';
	direction: 'asc' | 'desc';
}

export async function getLeaderboard(query: LeaderboardQuery): Promise<{
	rows: LeaderboardRow[];
	total: number;
	hasRanking: boolean;
}> {
	const [state] = await db
		.select({ revision: cohortState.revision })
		.from(cohortState)
		.where(eq(cohortState.id, 1))
		.limit(1);
	if (!state) return { rows: [], total: 0, hasRanking: false };
	const [latestRun] = await db
		.select({ id: rankingRun.id })
		.from(rankingRun)
		.where(eq(rankingRun.cohortRevision, state.revision))
		.orderBy(desc(rankingRun.createdAt), desc(rankingRun.id))
		.limit(1);
	if (!latestRun) return { rows: [], total: 0, hasRanking: false };

	const search = query.q.trim().slice(0, 100);
	const searchCondition = search
		? or(
				ilike(company.name, `%${search}%`),
				ilike(company.canonicalTicker, `%${search}%`),
				sql<boolean>`exists (
					select 1
					from leadership_member searched_member
					join person searched_person on searched_person.id = searched_member.person_id
					where searched_member.slate_id = ${rankingEntry.slateId}
						and searched_person.canonical_name ilike ${`%${search}%`}
				)`
			)
		: undefined;
	const readinessStatus = resolvedCompanyReadinessStatus();
	const whereCondition = and(
		eq(rankingEntry.runId, latestRun.id),
		eq(company.included, true),
		sql`${readinessStatus} = 'ready'`,
		eq(leadershipSlate.status, 'active'),
		searchCondition
	);

	const [{ count }] = await db
		.select({ count: sql<number>`count(distinct ${rankingEntry.slateId})::int` })
		.from(rankingEntry)
		.innerJoin(leadershipSlate, eq(leadershipSlate.id, rankingEntry.slateId))
		.innerJoin(company, eq(company.id, leadershipSlate.companyId))
		.innerJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
		.innerJoin(person, eq(person.id, leadershipMember.personId))
		.where(whereCondition);

	const sortColumn: Record<LeaderboardQuery['sort'], SQL> = {
		rank: sql`${rankingEntry.rank}`,
		company: sql`lower(${company.name})`,
		score: sql`${rankingEntry.score}`,
		comparisons: sql`${rankingEntry.comparisonCount}`
	};
	const direction = query.direction === 'asc' ? asc : desc;
	const ordering =
		query.sort === 'rank' || query.sort === 'score'
			? [
					asc(sql<number>`case when ${rankingEntry.comparisonCount} = 0 then 1 else 0 end`),
					direction(sortColumn[query.sort]),
					asc(company.id)
				]
			: [direction(sortColumn[query.sort]), asc(company.id)];
	const data = await db
		.select({
			companyId: company.id,
			slateId: rankingEntry.slateId,
			rank: rankingEntry.rank,
			companyName: company.name,
			ticker: company.canonicalTicker,
			score: rankingEntry.score,
			wins: rankingEntry.wins,
			losses: rankingEntry.losses,
			comparisonCount: rankingEntry.comparisonCount,
			leaderNames: sql<
				string[]
			>`array_agg(${person.canonicalName} order by ${leadershipMember.displayOrder}, ${person.canonicalName})`
		})
		.from(rankingEntry)
		.innerJoin(leadershipSlate, eq(leadershipSlate.id, rankingEntry.slateId))
		.innerJoin(company, eq(company.id, leadershipSlate.companyId))
		.innerJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
		.innerJoin(person, eq(person.id, leadershipMember.personId))
		.where(whereCondition)
		.groupBy(
			company.id,
			rankingEntry.slateId,
			rankingEntry.rank,
			rankingEntry.score,
			rankingEntry.wins,
			rankingEntry.losses,
			rankingEntry.comparisonCount
		)
		.orderBy(...ordering)
		.limit(query.pageSize)
		.offset((query.page - 1) * query.pageSize);

	return { rows: data, total: count, hasRanking: true };
}

export async function getReadinessSummary(): Promise<ReadinessSummary> {
	const readinessStatus = resolvedCompanyReadinessStatus();
	const [counts] = await db
		.select({
			total: sql<number>`count(*) filter (where ${company.included})::int`,
			ready: sql<number>`count(*) filter (where ${company.included} and ${readinessStatus} = 'ready')::int`,
			missingImage: sql<number>`count(*) filter (where ${company.included} and ${readinessStatus} = 'missing_image')::int`,
			notReady: sql<number>`count(*) filter (where ${company.included} and ${readinessStatus} = 'not_ready')::int`,
			excluded: sql<number>`count(*) filter (
				where ${company.archivedAt} is null and ${readinessStatus} = 'excluded'
			)::int`
		})
		.from(company);
	const [state] = await db.select().from(cohortState).limit(1);
	const activeSlates = await db
		.select({ id: leadershipSlate.id })
		.from(leadershipSlate)
		.innerJoin(company, eq(company.id, leadershipSlate.companyId))
		.where(
			and(
				eq(leadershipSlate.status, 'active'),
				eq(company.included, true),
				sql`${readinessStatus} = 'ready'`
			)
		);
	const activeIds = activeSlates.map((slate) => slate.id);
	const activeComparisons =
		activeIds.length === 0
			? []
			: await db
					.select({
						leftSlateId: comparison.leftSlateId,
						rightSlateId: comparison.rightSlateId
					})
					.from(comparison)
					.where(
						and(
							inArray(comparison.leftSlateId, activeIds),
							inArray(comparison.rightSlateId, activeIds)
						)
					);
	const parents = new Map(activeIds.map((id) => [id, id]));
	const appearances = new Map(activeIds.map((id) => [id, 0]));
	const find = (id: string): string => {
		const parent = parents.get(id)!;
		if (parent === id) return id;
		const root = find(parent);
		parents.set(id, root);
		return root;
	};
	for (const edge of activeComparisons) {
		appearances.set(edge.leftSlateId, (appearances.get(edge.leftSlateId) ?? 0) + 1);
		appearances.set(edge.rightSlateId, (appearances.get(edge.rightSlateId) ?? 0) + 1);
		const leftRoot = find(edge.leftSlateId);
		const rightRoot = find(edge.rightSlateId);
		if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot);
	}
	const appearanceValues = [...appearances.values()];

	const total = counts?.total ?? 0;
	const ready = counts?.ready ?? 0;
	const roundedPercent = total === 0 ? 0 : Math.round((ready / total) * 1000) / 10;
	return {
		total,
		ready,
		missingImage: counts?.missingImage ?? 0,
		notReady: counts?.notReady ?? 0,
		excluded: counts?.excluded ?? 0,
		percent: ready === total && total > 0 ? 100 : Math.min(99.9, roundedPercent),
		frozenAt: state?.frozenAt ?? null,
		revision: state?.revision ?? 1,
		comparisons: activeComparisons.length,
		coveredCompanies: appearanceValues.filter((value) => value > 0).length,
		minimumAppearances: appearanceValues.length === 0 ? 0 : Math.min(...appearanceValues),
		connected: activeIds.length > 1 && new Set(activeIds.map(find)).size === 1
	};
}

export async function listCompanies(
	q: string,
	page: number,
	pageSize = 50,
	status: CompanyStatusFilter = 'all'
) {
	const readinessStatus = resolvedCompanyReadinessStatus();
	const search = q.trim().slice(0, 100);
	const searchFilter = search
		? or(ilike(company.name, `%${search}%`), ilike(company.canonicalTicker, `%${search}%`))
		: undefined;
	const statusFilter =
		status === 'not_ready'
			? and(eq(company.included, true), sql`${readinessStatus} = 'not_ready'`)
			: status === 'missing_image'
				? and(eq(company.included, true), sql`${readinessStatus} = 'missing_image'`)
				: status === 'ready'
					? and(eq(company.included, true), sql`${readinessStatus} = 'ready'`)
					: status === 'excluded'
						? sql`${readinessStatus} = 'excluded'`
						: undefined;
	const filter = and(isNull(company.archivedAt), searchFilter, statusFilter);
	const [{ count }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(company)
		.where(filter);
	const rows = await db
		.select({
			id: company.id,
			name: company.name,
			ticker: company.canonicalTicker,
			included: company.included,
			readinessStatus: readinessStatus,
			exclusionReason: sql<CompanyExclusionReason | null>`coalesce(${company.universeExclusionReason}, ${company.manualExclusionReason})`,
			marketCap: company.marketCap
		})
		.from(company)
		.where(filter)
		.orderBy(desc(company.included), asc(company.name), asc(company.id))
		.limit(pageSize)
		.offset((page - 1) * pageSize);
	return { rows, total: count };
}

export interface CompanyPortraitReviewQueryRow {
	companyId: string;
	activeSlateId: string | null;
	personId: string | null;
	personName: string | null;
	title: string | null;
	roleKind: string | null;
	isInterim: boolean | null;
	leaderDisplayOrder: number | null;
	portraitId: string | null;
	portraitAltText: string | null;
	portraitWidth: number | null;
	portraitHeight: number | null;
	portraitDisplayOrder: number | null;
}

export function groupCompanyPortraitReviewRows(
	companyIds: string[],
	rows: CompanyPortraitReviewQueryRow[]
): CompanyPortraitReview[] {
	const reviews = new Map<string, CompanyPortraitReview>(
		companyIds.map((companyId) => [companyId, { companyId, activeSlateId: null, leaders: [] }])
	);

	for (const row of rows) {
		const review = reviews.get(row.companyId);
		if (!review) continue;
		if (row.activeSlateId) review.activeSlateId = row.activeSlateId;
		if (
			!row.personId ||
			!row.personName ||
			!row.title ||
			!row.roleKind ||
			row.isInterim === null ||
			row.leaderDisplayOrder === null
		) {
			continue;
		}

		let leader = review.leaders.find((candidate) => candidate.id === row.personId);
		if (!leader) {
			leader = {
				id: row.personId,
				name: row.personName,
				title: row.title,
				roleKind: row.roleKind,
				isInterim: row.isInterim,
				displayOrder: row.leaderDisplayOrder,
				portraits: []
			};
			review.leaders.push(leader);
		}
		if (
			row.portraitId &&
			row.portraitAltText !== null &&
			row.portraitWidth !== null &&
			row.portraitHeight !== null &&
			row.portraitDisplayOrder !== null
		) {
			leader.portraits.push({
				id: row.portraitId,
				altText: row.portraitAltText,
				width: row.portraitWidth,
				height: row.portraitHeight,
				displayOrder: row.portraitDisplayOrder
			});
		}
	}

	for (const review of reviews.values()) {
		review.leaders.sort(
			(a, b) =>
				a.displayOrder - b.displayOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
		);
		for (const leader of review.leaders) {
			leader.portraits.sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
		}
	}

	return companyIds.flatMap((companyId) => {
		const review = reviews.get(companyId);
		return review ? [review] : [];
	});
}

export function buildCompanyPortraitReviewQuery(companyIds: string[]) {
	return db
		.select({
			companyId: company.id,
			activeSlateId: leadershipSlate.id,
			personId: person.id,
			personName: person.canonicalName,
			title: leadershipMember.title,
			roleKind: leadershipMember.roleKind,
			isInterim: leadershipMember.isInterim,
			leaderDisplayOrder: leadershipMember.displayOrder,
			portraitId: portrait.id,
			portraitAltText: portrait.altText,
			portraitWidth: portrait.width,
			portraitHeight: portrait.height,
			portraitDisplayOrder: portrait.displayOrder
		})
		.from(company)
		.leftJoin(
			leadershipSlate,
			and(eq(leadershipSlate.companyId, company.id), eq(leadershipSlate.status, 'active'))
		)
		.leftJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
		.leftJoin(person, eq(person.id, leadershipMember.personId))
		.leftJoin(portrait, eq(portrait.personId, person.id))
		.where(inArray(company.id, companyIds))
		.orderBy(
			asc(company.id),
			asc(leadershipMember.displayOrder),
			asc(person.canonicalName),
			asc(person.id),
			asc(portrait.displayOrder),
			asc(portrait.id)
		);
}

export async function getCompanyPortraitReview(
	companyIds: string[]
): Promise<CompanyPortraitReview[]> {
	if (companyIds.length === 0) return [];
	const rows = await buildCompanyPortraitReviewQuery(companyIds);
	return groupCompanyPortraitReviewRows(companyIds, rows);
}

export async function getCompanyListings(companyId: string) {
	return db
		.select()
		.from(securityListing)
		.where(eq(securityListing.companyId, companyId))
		.orderBy(desc(securityListing.isCanonical), asc(securityListing.ticker));
}

export interface CompanyOverlapCandidate {
	id: string;
	name: string;
	ticker: string;
	matchingLeaderNames: string[];
}

export async function getCompanyOverlapCandidates(
	companyId: string
): Promise<CompanyOverlapCandidate[]> {
	const normalizedLeaderName = sql<string>`lower(trim(${person.canonicalName}))`;
	const currentLeaders = await db
		.select({
			normalizedName: normalizedLeaderName,
			name: person.canonicalName
		})
		.from(leadershipSlate)
		.innerJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
		.innerJoin(person, eq(person.id, leadershipMember.personId))
		.innerJoin(company, eq(company.id, leadershipSlate.companyId))
		.where(
			and(
				eq(leadershipSlate.companyId, companyId),
				eq(leadershipSlate.status, 'active'),
				isNull(company.archivedAt)
			)
		);
	const names = [...new Set(currentLeaders.map((leader) => leader.normalizedName))];
	if (names.length === 0) return [];
	const displayNameByNormalized = new Map(
		currentLeaders.map((leader) => [leader.normalizedName, leader.name])
	);
	const matches = await db
		.select({
			id: company.id,
			name: company.name,
			ticker: company.canonicalTicker,
			normalizedLeaderName
		})
		.from(company)
		.innerJoin(leadershipSlate, eq(leadershipSlate.companyId, company.id))
		.innerJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
		.innerJoin(person, eq(person.id, leadershipMember.personId))
		.where(
			and(
				ne(company.id, companyId),
				eq(company.included, true),
				isNull(company.archivedAt),
				eq(leadershipSlate.status, 'active'),
				inArray(normalizedLeaderName, names)
			)
		)
		.orderBy(asc(company.name), asc(company.canonicalTicker), asc(company.id));
	const candidates = new Map<string, CompanyOverlapCandidate>();
	for (const match of matches) {
		let candidate = candidates.get(match.id);
		if (!candidate) {
			candidate = {
				id: match.id,
				name: match.name,
				ticker: match.ticker,
				matchingLeaderNames: []
			};
			candidates.set(match.id, candidate);
		}
		const leaderName =
			displayNameByNormalized.get(match.normalizedLeaderName) ?? match.normalizedLeaderName;
		if (!candidate.matchingLeaderNames.includes(leaderName)) {
			candidate.matchingLeaderNames.push(leaderName);
		}
	}
	return [...candidates.values()];
}

export async function getAdminCompany(companyId: string) {
	const readinessStatus = resolvedCompanyReadinessStatus();
	const [record] = await db
		.select({
			id: company.id,
			issuerKey: company.issuerKey,
			cik: company.cik,
			name: company.name,
			description: company.description,
			homepageUrl: company.homepageUrl,
			sicCode: company.sicCode,
			sicDescription: company.sicDescription,
			canonicalTicker: company.canonicalTicker,
			marketCap: company.marketCap,
			included: company.included,
			readinessStatus: readinessStatus,
			universeExclusionReason: company.universeExclusionReason,
			manualExclusionReason: company.manualExclusionReason,
			effectiveExclusionReason: sql<CompanyExclusionReason | null>`coalesce(${company.universeExclusionReason}, ${company.manualExclusionReason})`,
			exclusionReferenceCompanyId: company.exclusionReferenceCompanyId,
			createdAt: company.createdAt,
			updatedAt: company.updatedAt
		})
		.from(company)
		.where(and(eq(company.id, companyId), isNull(company.archivedAt)))
		.limit(1);
	if (!record) return null;
	const [listings, card, [exclusionReferenceCompany]] = await Promise.all([
		getCompanyListings(companyId),
		getCompanyCardForState(companyId, false),
		record.exclusionReferenceCompanyId
			? db
					.select({
						id: company.id,
						name: company.name,
						ticker: company.canonicalTicker
					})
					.from(company)
					.where(eq(company.id, record.exclusionReferenceCompanyId))
					.limit(1)
			: Promise.resolve([])
	]);
	return {
		...record,
		exclusionReferenceCompany: exclusionReferenceCompany ?? null,
		listings,
		card
	};
}

export async function getCompanyProfileDocument(companyId: string) {
	const record = await getAdminCompany(companyId);
	if (!record?.card) return null;
	return {
		schema_version: 4,
		issuer_key: record.issuerKey,
		canonical_ticker: record.canonicalTicker,
		company_name: record.name,
		leadership_as_of: record.card.effectiveAt,
		leaders: record.card.leaders.map((leader) => {
			return {
				name: leader.name,
				title: leader.title,
				role_kind: leader.roleKind,
				is_interim: leader.isInterim,
				summary: leader.summary,
				sources: leader.sources.map(profileSourceDocument),
				portraits: leader.portraits.flatMap((portrait) =>
					portrait.imageUrl
						? [
								{
									image_url: portrait.imageUrl,
									alt_text: portrait.altText,
									is_real_person: true as const,
									...(portrait.source ? { source: profileSourceDocument(portrait.source) } : {})
								}
							]
						: []
				),
				facts: leader.facts.map((fact) => ({
					category: fact.category,
					value: fact.value
				}))
			};
		})
	};
}

function profileSourceDocument(value: LeaderProfile['sources'][number]) {
	return {
		url: value.url,
		title: value.title,
		publisher: value.publisher
	};
}

export async function getPortrait(portraitId: string) {
	const [record] = await db.select().from(portrait).where(eq(portrait.id, portraitId)).limit(1);
	return record ?? null;
}

export type CompanyAdminRecord = Awaited<ReturnType<typeof listCompanies>>['rows'][number];
