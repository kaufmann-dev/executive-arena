import { sql } from 'drizzle-orm';
import {
	bigint,
	bigserial,
	boolean,
	check,
	customType,
	doublePrecision,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType() {
		return 'bytea';
	}
});

export type LeadershipStatus = 'active' | 'retired';
export type LeadershipRole =
	'ceo' | 'co_ceo' | 'president' | 'executive_chair' | 'managing_director';
export type PairingPhase = 'connectivity' | 'coverage' | 'adaptive' | 'exploration';
export type MassiveUniverseSyncStatus = 'running' | 'needs_alias_review' | 'failed' | 'completed';
export const oidcTransaction = pgTable(
	'oidc_transaction',
	{
		stateHash: text('state_hash').primaryKey(),
		browserTokenHash: text('browser_token_hash').notNull(),
		nonce: text('nonce').notNull(),
		codeVerifier: text('code_verifier').notNull(),
		expiresAt: timestamptz('expires_at').notNull(),
		createdAt: timestamptz('created_at').notNull().defaultNow()
	},
	(table) => [index('oidc_transaction_expires_at_idx').on(table.expiresAt)]
);

export const appSession = pgTable(
	'app_session',
	{
		tokenHash: text('token_hash').primaryKey(),
		idToken: text('id_token').notNull(),
		createdAt: timestamptz('created_at').notNull().defaultNow(),
		lastActiveAt: timestamptz('last_active_at').notNull(),
		expiresAt: timestamptz('expires_at').notNull()
	},
	(table) => [index('app_session_expires_at_idx').on(table.expiresAt)]
);

export const mcpApiKey = pgTable(
	'mcp_api_key',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		prefix: text('prefix').notNull().unique(),
		tokenHash: text('token_hash').notNull().unique(),
		createdAt: timestamptz('created_at').notNull().defaultNow(),
		lastUsedAt: timestamptz('last_used_at')
	},
	(table) => [index('mcp_api_key_created_at_idx').on(table.createdAt)]
);

export const reviewedIssuerAlias = pgTable('reviewed_issuer_alias', {
	ticker: text('ticker').primaryKey(),
	issuerKey: text('issuer_key').notNull(),
	reviewedByApiKeyId: uuid('reviewed_by_api_key_id').references(() => mcpApiKey.id, {
		onDelete: 'set null'
	}),
	createdAt: timestamptz('created_at').notNull().defaultNow(),
	updatedAt: timestamptz('updated_at').notNull().defaultNow()
});

export const massiveUniverseSync = pgTable(
	'massive_universe_sync',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		asOf: timestamptz('as_of').notNull(),
		status: text('status').$type<MassiveUniverseSyncStatus>().notNull(),
		requestedByApiKeyId: uuid('requested_by_api_key_id').references(() => mcpApiKey.id, {
			onDelete: 'set null'
		}),
		leaseExpiresAt: timestamptz('lease_expires_at'),
		listingCount: integer('listing_count').notNull().default(0),
		enrichedCount: integer('enriched_count').notNull().default(0),
		error: text('error'),
		createdAt: timestamptz('created_at').notNull().defaultNow(),
		updatedAt: timestamptz('updated_at').notNull().defaultNow(),
		completedAt: timestamptz('completed_at')
	},
	(table) => [
		index('massive_universe_sync_as_of_idx').on(table.asOf, table.createdAt),
		uniqueIndex('massive_universe_sync_one_running_idx')
			.on(table.status)
			.where(sql`${table.status} = 'running'`)
	]
);

export const massiveTickerCheckpoint = pgTable(
	'massive_ticker_checkpoint',
	{
		syncId: uuid('sync_id')
			.notNull()
			.references(() => massiveUniverseSync.id, { onDelete: 'cascade' }),
		ticker: text('ticker').notNull(),
		record: jsonb('record').notNull(),
		requestId: text('request_id'),
		createdAt: timestamptz('created_at').notNull().defaultNow(),
		updatedAt: timestamptz('updated_at').notNull().defaultNow()
	},
	(table) => [
		primaryKey({ columns: [table.syncId, table.ticker] }),
		index('massive_ticker_checkpoint_sync_idx').on(table.syncId)
	]
);

export const cohortState = pgTable('cohort_state', {
	id: integer('id').primaryKey().default(1),
	revision: integer('revision').notNull().default(1),
	pairingSeed: text('pairing_seed').notNull(),
	frozenAt: timestamptz('frozen_at'),
	updatedAt: timestamptz('updated_at').notNull().defaultNow()
});

export const company = pgTable(
	'company',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		issuerKey: text('issuer_key').notNull().unique(),
		cik: text('cik'),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		homepageUrl: text('homepage_url'),
		sicCode: text('sic_code'),
		sicDescription: text('sic_description'),
		canonicalTicker: text('canonical_ticker').notNull(),
		marketCap: doublePrecision('market_cap'),
		included: boolean('included').notNull().default(true),
		exclusionReason: text('exclusion_reason'),
		cohortOrder: integer('cohort_order'),
		createdAt: timestamptz('created_at').notNull().defaultNow(),
		updatedAt: timestamptz('updated_at').notNull().defaultNow()
	},
	(table) => [
		index('company_name_idx').on(table.name),
		index('company_ticker_idx').on(table.canonicalTicker),
		uniqueIndex('company_cik_unique_idx')
			.on(table.cik)
			.where(sql`${table.cik} is not null`)
	]
);

export const executiveResearchClaim = pgTable(
	'executive_research_claim',
	{
		companyId: uuid('company_id')
			.primaryKey()
			.references(() => company.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull().unique(),
		claimedByApiKeyId: uuid('claimed_by_api_key_id').references(() => mcpApiKey.id, {
			onDelete: 'set null'
		}),
		claimedAt: timestamptz('claimed_at').notNull(),
		expiresAt: timestamptz('expires_at').notNull()
	},
	(table) => [
		index('executive_research_claim_expires_at_idx').on(table.expiresAt),
		check('executive_research_claim_valid_expiry', sql`${table.expiresAt} > ${table.claimedAt}`)
	]
);

export const securityListing = pgTable(
	'security_listing',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		companyId: uuid('company_id')
			.notNull()
			.references(() => company.id, { onDelete: 'cascade' }),
		ticker: text('ticker').notNull().unique(),
		name: text('name').notNull(),
		primaryExchange: text('primary_exchange'),
		type: text('type').notNull(),
		active: boolean('active').notNull(),
		compositeFigi: text('composite_figi'),
		shareClassFigi: text('share_class_figi'),
		marketCap: doublePrecision('market_cap'),
		isCanonical: boolean('is_canonical').notNull().default(false),
		lastUpdatedAt: timestamptz('last_updated_at')
	},
	(table) => [
		index('security_listing_company_idx').on(table.companyId),
		uniqueIndex('security_listing_one_canonical_idx')
			.on(table.companyId)
			.where(sql`${table.isCanonical}`)
	]
);

export const source = pgTable('source', {
	id: uuid('id').primaryKey().defaultRandom(),
	url: text('url').notNull().unique(),
	title: text('title').notNull(),
	publisher: text('publisher').notNull(),
	retrievedAt: timestamptz('retrieved_at').notNull()
});

export const person = pgTable(
	'person',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		canonicalName: text('canonical_name').notNull(),
		slug: text('slug').notNull().unique(),
		summary: text('summary').notNull(),
		leadershipAsOf: text('leadership_as_of').notNull(),
		createdAt: timestamptz('created_at').notNull().defaultNow(),
		updatedAt: timestamptz('updated_at').notNull().defaultNow()
	},
	(table) => [index('person_name_idx').on(table.canonicalName)]
);

export const personSource = pgTable(
	'person_source',
	{
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		sourceId: uuid('source_id')
			.notNull()
			.references(() => source.id, { onDelete: 'restrict' }),
		kind: text('kind').$type<'summary'>().notNull().default('summary')
	},
	(table) => [
		primaryKey({ columns: [table.personId, table.sourceId, table.kind] }),
		index('person_source_person_idx').on(table.personId)
	]
);

export const personFact = pgTable(
	'person_fact',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		category: text('category').notNull(),
		value: text('value').notNull(),
		sortOrder: integer('sort_order').notNull().default(0)
	},
	(table) => [index('person_fact_person_idx').on(table.personId, table.sortOrder)]
);

export const personFactSource = pgTable(
	'person_fact_source',
	{
		factId: uuid('fact_id')
			.notNull()
			.references(() => personFact.id, { onDelete: 'cascade' }),
		sourceId: uuid('source_id')
			.notNull()
			.references(() => source.id, { onDelete: 'restrict' })
	},
	(table) => [
		primaryKey({ columns: [table.factId, table.sourceId] }),
		index('person_fact_source_fact_idx').on(table.factId)
	]
);

export const portrait = pgTable(
	'portrait',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		displayOrder: integer('display_order').notNull().default(0),
		image: bytea('image').notNull(),
		imageUrl: text('image_url').notNull(),
		contentType: text('content_type').notNull().default('image/webp'),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		byteLength: integer('byte_length').notNull(),
		sha256: text('sha256').notNull(),
		altText: text('alt_text').notNull(),
		sourceId: uuid('source_id')
			.notNull()
			.references(() => source.id, { onDelete: 'restrict' }),
		createdAt: timestamptz('created_at').notNull().defaultNow()
	},
	(table) => [
		index('portrait_sha256_idx').on(table.sha256),
		uniqueIndex('portrait_person_order_unique_idx').on(table.personId, table.displayOrder),
		uniqueIndex('portrait_person_sha256_unique_idx').on(table.personId, table.sha256),
		check(
			'portrait_display_order_range',
			sql`${table.displayOrder} >= 0 and ${table.displayOrder} < 3`
		),
		check('portrait_width_positive', sql`${table.width} > 0`),
		check('portrait_height_positive', sql`${table.height} > 0`),
		check('portrait_byte_length_positive', sql`${table.byteLength} > 0`)
	]
);

export const leadershipSlate = pgTable(
	'leadership_slate',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		companyId: uuid('company_id')
			.notNull()
			.references(() => company.id, { onDelete: 'cascade' }),
		version: integer('version').notNull(),
		status: text('status').$type<LeadershipStatus>().notNull().default('active'),
		effectiveAt: text('effective_at').notNull(),
		retiredAt: timestamptz('retired_at'),
		createdAt: timestamptz('created_at').notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('leadership_slate_company_version_idx').on(table.companyId, table.version),
		uniqueIndex('leadership_slate_one_active_idx')
			.on(table.companyId)
			.where(sql`${table.status} = 'active'`),
		index('leadership_slate_status_idx').on(table.status)
	]
);

export const leadershipMember = pgTable(
	'leadership_member',
	{
		slateId: uuid('slate_id')
			.notNull()
			.references(() => leadershipSlate.id, { onDelete: 'cascade' }),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'restrict' }),
		title: text('title').notNull(),
		roleKind: text('role_kind').$type<LeadershipRole>().notNull(),
		isInterim: boolean('is_interim').notNull().default(false),
		displayOrder: integer('display_order').notNull().default(0)
	},
	(table) => [
		primaryKey({ columns: [table.slateId, table.personId] }),
		index('leadership_member_person_idx').on(table.personId)
	]
);

export const leadershipMemberSource = pgTable(
	'leadership_member_source',
	{
		slateId: uuid('slate_id').notNull(),
		personId: uuid('person_id').notNull(),
		sourceId: uuid('source_id')
			.notNull()
			.references(() => source.id, { onDelete: 'restrict' })
	},
	(table) => [
		primaryKey({ columns: [table.slateId, table.personId, table.sourceId] }),
		index('leadership_member_source_member_idx').on(table.slateId, table.personId),
		foreignKey({
			columns: [table.slateId, table.personId],
			foreignColumns: [leadershipMember.slateId, leadershipMember.personId],
			name: 'leadership_member_source_member_fk'
		}).onDelete('cascade')
	]
);

export const pairPresentation = pgTable(
	'pair_presentation',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		cohortRevision: integer('cohort_revision').notNull(),
		leftSlateId: uuid('left_slate_id')
			.notNull()
			.references(() => leadershipSlate.id, { onDelete: 'restrict' }),
		rightSlateId: uuid('right_slate_id')
			.notNull()
			.references(() => leadershipSlate.id, { onDelete: 'restrict' }),
		phase: text('phase').$type<PairingPhase>().notNull(),
		expiresAt: timestamptz('expires_at').notNull(),
		consumedAt: timestamptz('consumed_at'),
		createdAt: timestamptz('created_at').notNull().defaultNow()
	},
	(table) => [
		unique('pair_presentation_identity_unique').on(
			table.id,
			table.cohortRevision,
			table.leftSlateId,
			table.rightSlateId
		),
		index('pair_presentation_open_idx').on(table.consumedAt, table.expiresAt),
		check('pair_presentation_distinct_slates', sql`${table.leftSlateId} <> ${table.rightSlateId}`)
	]
);

export const comparison = pgTable(
	'comparison',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		presentationId: uuid('presentation_id').notNull(),
		cohortRevision: integer('cohort_revision').notNull(),
		leftSlateId: uuid('left_slate_id').notNull(),
		rightSlateId: uuid('right_slate_id').notNull(),
		winnerSlateId: uuid('winner_slate_id')
			.notNull()
			.references(() => leadershipSlate.id, { onDelete: 'restrict' }),
		createdAt: timestamptz('created_at').notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('comparison_presentation_idx').on(table.presentationId),
		foreignKey({
			columns: [table.presentationId, table.cohortRevision, table.leftSlateId, table.rightSlateId],
			foreignColumns: [
				pairPresentation.id,
				pairPresentation.cohortRevision,
				pairPresentation.leftSlateId,
				pairPresentation.rightSlateId
			],
			name: 'comparison_presentation_identity_fk'
		}).onDelete('restrict'),
		index('comparison_left_idx').on(table.leftSlateId),
		index('comparison_right_idx').on(table.rightSlateId),
		index('comparison_created_idx').on(table.createdAt),
		check(
			'comparison_winner_is_presented',
			sql`${table.winnerSlateId} = ${table.leftSlateId} or ${table.winnerSlateId} = ${table.rightSlateId}`
		),
		check('comparison_distinct_slates', sql`${table.leftSlateId} <> ${table.rightSlateId}`)
	]
);

export const rankingRun = pgTable('ranking_run', {
	id: uuid('id').primaryKey().defaultRandom(),
	cohortRevision: integer('cohort_revision').notNull(),
	comparisonCutoff: bigint('comparison_cutoff', { mode: 'number' }).notNull().default(0),
	activeCount: integer('active_count').notNull(),
	iterations: integer('iterations').notNull(),
	converged: boolean('converged').notNull(),
	maxDelta: doublePrecision('max_delta').notNull(),
	createdAt: timestamptz('created_at').notNull().defaultNow()
});

export const rankingEntry = pgTable(
	'ranking_entry',
	{
		runId: uuid('run_id')
			.notNull()
			.references(() => rankingRun.id, { onDelete: 'cascade' }),
		slateId: uuid('slate_id')
			.notNull()
			.references(() => leadershipSlate.id, { onDelete: 'restrict' }),
		rank: integer('rank').notNull(),
		strength: doublePrecision('strength').notNull(),
		score: doublePrecision('score').notNull(),
		wins: integer('wins').notNull(),
		losses: integer('losses').notNull(),
		comparisonCount: integer('comparison_count').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.runId, table.slateId] }),
		uniqueIndex('ranking_entry_run_rank_idx').on(table.runId, table.rank),
		index('ranking_entry_slate_idx').on(table.slateId)
	]
);

export const researchSnapshot = pgTable(
	'research_snapshot',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		source: text('source').notNull(),
		asOf: timestamptz('as_of').notNull(),
		payload: jsonb('payload').notNull(),
		payloadHash: text('payload_hash'),
		submittedByApiKeyId: uuid('submitted_by_api_key_id'),
		createdAt: timestamptz('created_at').notNull().defaultNow()
	},
	(table) => [
		foreignKey({
			columns: [table.submittedByApiKeyId],
			foreignColumns: [mcpApiKey.id],
			name: 'research_snapshot_api_key_fk'
		}).onDelete('set null')
	]
);
