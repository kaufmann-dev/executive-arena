import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	cohortState,
	comparison,
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
	rankingEntry,
	rankingRun,
	securityListing,
	source
} from '$lib/server/db/schema';
import type { LeaderboardRow, LeaderProfile, LeadershipCard, ReadinessSummary } from './types';

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
		portraitId: string;
		portraitDisplayOrder: number;
		portraitImageUrl: string;
		portraitAltText: string;
		portraitSourceId: string;
		portraitSourceUrl: string;
		portraitSourceTitle: string;
		portraitSourcePublisher: string;
		portraitSourceKind: string;
		portraitSourceRetrievedAt: Date;
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
				summarySources: [],
				roleSources: [],
				facts: []
			};
			card.leaders.push(leader);
		}
		leader.portraits.push({
			id: row.portraitId,
			imageUrl: row.portraitImageUrl,
			altText: row.portraitAltText,
			source: {
				id: row.portraitSourceId,
				url: row.portraitSourceUrl,
				title: row.portraitSourceTitle,
				publisher: row.portraitSourcePublisher,
				kind: row.portraitSourceKind,
				retrievedAt: row.portraitSourceRetrievedAt
			}
		});
	}
	return [...cards.values()];
}

async function attachFacts(cards: LeadershipCard[]): Promise<void> {
	const leaders = cards.flatMap((card) => card.leaders);
	const personIds = leaders.map((leader) => leader.id);
	if (personIds.length === 0) return;

	const facts = await db
		.select({
			id: personFact.id,
			personId: personFact.personId,
			category: personFact.category,
			value: personFact.value,
			sourceId: source.id,
			sourceUrl: source.url,
			sourceTitle: source.title,
			sourcePublisher: source.publisher,
			sourceKind: source.kind,
			sourceRetrievedAt: source.retrievedAt
		})
		.from(personFact)
		.innerJoin(personFactSource, eq(personFactSource.factId, personFact.id))
		.innerJoin(source, eq(source.id, personFactSource.sourceId))
		.where(inArray(personFact.personId, personIds))
		.orderBy(asc(personFact.sortOrder), asc(personFact.id), asc(source.publisher), asc(source.url));

	const byPerson = new Map(leaders.map((leader) => [leader.id, leader]));
	const byFact = new Map<string, { personId: string; fact: LeaderProfile['facts'][number] }>();
	for (const fact of facts) {
		let grouped = byFact.get(fact.id);
		if (!grouped) {
			grouped = {
				personId: fact.personId,
				fact: {
					id: fact.id,
					category: fact.category,
					value: fact.value,
					sources: []
				}
			};
			byFact.set(fact.id, grouped);
			byPerson.get(fact.personId)?.facts.push(grouped.fact);
		}
		grouped.fact.sources.push({
			id: fact.sourceId,
			url: fact.sourceUrl,
			title: fact.sourceTitle,
			publisher: fact.sourcePublisher,
			kind: fact.sourceKind,
			retrievedAt: fact.sourceRetrievedAt
		});
	}
}

async function attachLeaderSources(cards: LeadershipCard[]): Promise<void> {
	const leaders = cards.flatMap((card) => card.leaders);
	const personIds = leaders.map((leader) => leader.id);
	const slateIds = cards.map((card) => card.slateId);
	if (personIds.length === 0 || slateIds.length === 0) return;

	const [summaries, roles] = await Promise.all([
		db
			.select({
				personId: personSource.personId,
				id: source.id,
				url: source.url,
				title: source.title,
				publisher: source.publisher,
				kind: source.kind,
				retrievedAt: source.retrievedAt
			})
			.from(personSource)
			.innerJoin(source, eq(source.id, personSource.sourceId))
			.where(inArray(personSource.personId, personIds))
			.orderBy(asc(source.publisher), asc(source.url)),
		db
			.select({
				slateId: leadershipMemberSource.slateId,
				personId: leadershipMemberSource.personId,
				id: source.id,
				url: source.url,
				title: source.title,
				publisher: source.publisher,
				kind: source.kind,
				retrievedAt: source.retrievedAt
			})
			.from(leadershipMemberSource)
			.innerJoin(source, eq(source.id, leadershipMemberSource.sourceId))
			.where(inArray(leadershipMemberSource.slateId, slateIds))
			.orderBy(asc(source.publisher), asc(source.url))
	]);

	const leadersByPerson = new Map(leaders.map((leader) => [leader.id, leader]));
	for (const summary of summaries) {
		leadersByPerson.get(summary.personId)?.summarySources.push(toProfileSource(summary));
	}
	const cardsBySlate = new Map(cards.map((card) => [card.slateId, card]));
	for (const role of roles) {
		cardsBySlate
			.get(role.slateId)
			?.leaders.find((leader) => leader.id === role.personId)
			?.roleSources.push(toProfileSource(role));
	}
}

function toProfileSource(record: {
	id: string;
	url: string;
	title: string;
	publisher: string;
	kind: string;
	retrievedAt: Date;
}): LeaderProfile['summarySources'][number] {
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
			portraitSourceKind: source.kind,
			portraitSourceRetrievedAt: source.retrievedAt
		})
		.from(leadershipSlate)
		.innerJoin(company, eq(company.id, leadershipSlate.companyId))
		.innerJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
		.innerJoin(person, eq(person.id, leadershipMember.personId))
		.innerJoin(portrait, eq(portrait.personId, person.id))
		.innerJoin(source, eq(source.id, portrait.sourceId))
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

export async function getCompanyCard(companyId: string): Promise<LeadershipCard | null> {
	const [slate] = await db
		.select({ id: leadershipSlate.id })
		.from(leadershipSlate)
		.where(and(eq(leadershipSlate.companyId, companyId), eq(leadershipSlate.status, 'active')))
		.limit(1);
	if (!slate) return null;
	return (await getLeadershipCards([slate.id]))[0] ?? null;
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
	const whereCondition = and(
		eq(rankingEntry.runId, latestRun.id),
		eq(company.included, true),
		eq(company.readinessStatus, 'ready'),
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
	const [[counts], [issues]] = await Promise.all([
		db
			.select({
				total: sql<number>`count(*) filter (where ${company.included})::int`,
				ready: sql<number>`count(*) filter (where ${company.included} and ${company.readinessStatus} = 'ready')::int`,
				pending: sql<number>`count(*) filter (where ${company.included} and ${company.readinessStatus} = 'pending')::int`,
				excluded: sql<number>`count(*) filter (where not ${company.included} or ${company.readinessStatus} = 'excluded')::int`
			})
			.from(company),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(executiveResearchIssue)
			.where(isNull(executiveResearchIssue.resolvedAt))
	]);
	const [state] = await db.select().from(cohortState).limit(1);
	const activeSlates = await db
		.select({ id: leadershipSlate.id })
		.from(leadershipSlate)
		.innerJoin(company, eq(company.id, leadershipSlate.companyId))
		.where(
			and(
				eq(leadershipSlate.status, 'active'),
				eq(company.included, true),
				eq(company.readinessStatus, 'ready')
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
		pending: counts?.pending ?? 0,
		excluded: counts?.excluded ?? 0,
		needsReview: issues?.count ?? 0,
		percent: ready === total && total > 0 ? 100 : Math.min(99.9, roundedPercent),
		frozenAt: state?.frozenAt ?? null,
		revision: state?.revision ?? 1,
		comparisons: activeComparisons.length,
		coveredCompanies: appearanceValues.filter((value) => value > 0).length,
		minimumAppearances: appearanceValues.length === 0 ? 0 : Math.min(...appearanceValues),
		connected: activeIds.length > 1 && new Set(activeIds.map(find)).size === 1
	};
}

export type CompanyStatusFilter = 'all' | 'pending' | 'ready' | 'excluded';

export async function listCompanies(
	q: string,
	page: number,
	pageSize = 50,
	status: CompanyStatusFilter = 'all'
) {
	const search = q.trim().slice(0, 100);
	const searchFilter = search
		? or(ilike(company.name, `%${search}%`), ilike(company.canonicalTicker, `%${search}%`))
		: undefined;
	const statusFilter =
		status === 'pending'
			? and(eq(company.included, true), eq(company.readinessStatus, 'pending'))
			: status === 'ready'
				? and(eq(company.included, true), eq(company.readinessStatus, 'ready'))
				: status === 'excluded'
					? or(eq(company.included, false), eq(company.readinessStatus, 'excluded'))
					: undefined;
	const filter = and(searchFilter, statusFilter);
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
			readinessStatus: company.readinessStatus,
			exclusionReason: company.exclusionReason,
			marketCap: company.marketCap
		})
		.from(company)
		.where(filter)
		.orderBy(desc(company.included), asc(company.name), asc(company.id))
		.limit(pageSize)
		.offset((page - 1) * pageSize);
	return { rows, total: count };
}

export async function getCompanyListings(companyId: string) {
	return db
		.select()
		.from(securityListing)
		.where(eq(securityListing.companyId, companyId))
		.orderBy(desc(securityListing.isCanonical), asc(securityListing.ticker));
}

export async function getAdminCompany(companyId: string) {
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
			readinessStatus: company.readinessStatus,
			exclusionReason: company.exclusionReason,
			createdAt: company.createdAt,
			updatedAt: company.updatedAt
		})
		.from(company)
		.where(eq(company.id, companyId))
		.limit(1);
	if (!record) return null;
	const [listings, card] = await Promise.all([
		getCompanyListings(companyId),
		getCompanyCard(companyId)
	]);
	return { ...record, listings, card };
}

export async function getAdminProfileDocument(companyId: string) {
	const record = await getAdminCompany(companyId);
	if (!record?.card) return null;
	return {
		schema_version: 2,
		issuer_key: record.issuerKey,
		canonical_ticker: record.canonicalTicker,
		company_name: record.name,
		leadership_as_of: record.card.effectiveAt,
		leaders: record.card.leaders.map((leader) => {
			const roleSource = leader.roleSources[0];
			if (!roleSource) {
				throw new Error(`Active leader ${leader.name} has no role source`);
			}
			return {
				name: leader.name,
				title: leader.title,
				role_kind: leader.roleKind,
				is_interim: leader.isInterim,
				summary: leader.summary,
				summary_sources: leader.summarySources.map(profileSourceDocument),
				role_source: profileSourceDocument(roleSource),
				portraits: leader.portraits.map((portrait) => ({
					image_url: portrait.imageUrl,
					alt_text: portrait.altText,
					is_real_person: true,
					source: profileSourceDocument(portrait.source)
				})),
				facts: leader.facts.map((fact) => ({
					category: fact.category,
					value: fact.value,
					sources: fact.sources.map(profileSourceDocument)
				}))
			};
		})
	};
}

function profileSourceDocument(value: LeaderProfile['summarySources'][number]) {
	return {
		url: value.url,
		title: value.title,
		publisher: value.publisher,
		retrieved_at: value.retrievedAt.toISOString().slice(0, 10),
		kind: value.kind
	};
}

export async function getPortrait(portraitId: string) {
	const [record] = await db.select().from(portrait).where(eq(portrait.id, portraitId)).limit(1);
	return record ?? null;
}

export type CompanyAdminRecord = Awaited<ReturnType<typeof listCompanies>>['rows'][number];
