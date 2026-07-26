import { randomBytes } from 'node:crypto';
import { downloadAndTransformPortrait } from '../../research/portrait';
import { executiveProfileSchema, type ExecutiveProfile } from '../../research/schemas';
import { normalizedUniverseSnapshotSchema, type NormalizedIssuer } from '../../research/universe';
import type {
	FreezeReadinessIssue,
	FreezeReadinessRow,
	PreparedExecutiveProfile,
	ResearchImportRepository,
	ResearchImportService,
	ResearchImportServiceOptions
} from './types';

const DEFAULT_PORTRAIT_CONCURRENCY = 4;
const PAIRING_SEED_PATTERN = /^[a-f0-9]{64}$/;
export const MAX_PROFILE_IMPORT_BATCH_SIZE = 10;

export function createResearchImportService(
	repository: ResearchImportRepository,
	options: ResearchImportServiceOptions = {}
): ResearchImportService {
	const now = options.now ?? (() => new Date());
	const pairingSeed = options.pairingSeed ?? createPairingSeed;
	const portraitConcurrency = options.portraitConcurrency ?? DEFAULT_PORTRAIT_CONCURRENCY;
	assertPortraitConcurrency(portraitConcurrency);

	return {
		async importUniverse(value) {
			const snapshot = normalizedUniverseSnapshotSchema.parse(value);
			assertUniverseIntegrity(snapshot.issuers);
			return repository.writeUniverse(snapshot.issuers, {
				importedAt: now(),
				asOf: new Date(`${snapshot.asOf}T00:00:00.000Z`),
				snapshot,
				submittedByApiKeyId: options.submittedByApiKeyId ?? null
			});
		},

		async importProfiles(values) {
			if (values.length > MAX_PROFILE_IMPORT_BATCH_SIZE) {
				throw new Error(
					`Executive profile imports are limited to ${MAX_PROFILE_IMPORT_BATCH_SIZE} profiles per batch`
				);
			}

			const profiles = parseExecutiveProfileSet(values);
			const prepared = await preparePortraits(
				profiles,
				portraitConcurrency,
				options.fetchPortrait,
				options.resolvePortraitAddresses
			);
			const seed = pairingSeed();
			assertPairingSeed(seed);
			return repository.writeProfiles(prepared, {
				importedAt: now(),
				pairingSeed: seed,
				submittedByApiKeyId: options.submittedByApiKeyId ?? null
			});
		},

		async freeze() {
			const seed = pairingSeed();
			assertPairingSeed(seed);
			return repository.freeze({ frozenAt: now(), pairingSeed: seed });
		}
	};
}

export function parseExecutiveProfileSet(values: readonly unknown[]): ExecutiveProfile[] {
	if (values.length === 0) {
		throw new Error('At least one executive profile is required');
	}

	const profiles = values.map((value) => executiveProfileSchema.parse(value));
	assertDistinctIssuerKeys(profiles);
	assertConsistentSourceKinds(profiles);
	return profiles;
}

export function createPairingSeed(): string {
	return randomBytes(32).toString('hex');
}

export function leadershipMembershipMatches(
	activePersonIds: readonly string[],
	incomingPersonIds: readonly string[]
): boolean {
	if (activePersonIds.length !== incomingPersonIds.length) return false;
	const active = [...activePersonIds].sort();
	const incoming = [...incomingPersonIds].sort();
	return active.every((personId, index) => personId === incoming[index]);
}

export function inspectFreezeReadiness(
	rows: readonly FreezeReadinessRow[]
): FreezeReadinessIssue[] {
	const companies = Map.groupBy(rows, (row) => row.issuerKey);
	const issues: FreezeReadinessIssue[] = [];

	for (const [issuerKey, companyRows] of companies) {
		const first = companyRows[0]!;
		if (first.readinessStatus !== 'ready') {
			issues.push({
				issuerKey,
				message: `${first.companyName} is ${first.readinessStatus}, not ready`
			});
		}

		const slateIds = new Set(
			companyRows.flatMap((row) => (row.slateId === null ? [] : [row.slateId]))
		);
		if (slateIds.size !== 1) {
			issues.push({
				issuerKey,
				message: `${first.companyName} must have exactly one active leadership slate`
			});
		}

		const memberRows = companyRows.filter((row) => row.personId !== null);
		if (memberRows.length === 0) {
			issues.push({
				issuerKey,
				message: `${first.companyName} has no active leadership members`
			});
			continue;
		}

		for (const row of memberRows) {
			const personLabel = row.personId ?? 'unknown person';
			if (row.portraitCount < 1) {
				issues.push({
					issuerKey,
					message: `${first.companyName} member ${personLabel} has no portraits`
				});
			} else if (row.portraitCount > 3) {
				issues.push({
					issuerKey,
					message: `${first.companyName} member ${personLabel} has more than three portraits`
				});
			}
			if (row.summarySourceCount < 1) {
				issues.push({
					issuerKey,
					message: `${first.companyName} member ${personLabel} has no summary source`
				});
			}
			if (row.roleSourceCount < 1) {
				issues.push({
					issuerKey,
					message: `${first.companyName} member ${personLabel} has no role source`
				});
			}
			if (row.factCount < 1) {
				issues.push({
					issuerKey,
					message: `${first.companyName} member ${personLabel} has no facts`
				});
			} else if (row.citedFactCount !== row.factCount) {
				issues.push({
					issuerKey,
					message: `${first.companyName} member ${personLabel} has uncited facts`
				});
			}
		}
	}

	return issues;
}

async function preparePortraits(
	profiles: ExecutiveProfile[],
	concurrency: number,
	fetchPortrait?: ResearchImportServiceOptions['fetchPortrait'],
	resolvePortraitAddresses?: ResearchImportServiceOptions['resolvePortraitAddresses']
): Promise<PreparedExecutiveProfile[]> {
	const jobs = profiles.flatMap((profile, profileIndex) =>
		profile.leaders.flatMap((leader, leaderIndex) =>
			leader.portraits.map((portrait, portraitIndex) => ({
				profileIndex,
				leaderIndex,
				portraitIndex,
				url: portrait.image_url
			}))
		)
	);
	const transformed = await mapConcurrent(jobs, concurrency, async (job) => ({
		...job,
		portrait: await downloadAndTransformPortrait(job.url, fetchPortrait, resolvePortraitAddresses)
	}));

	return profiles.map((profile, profileIndex) => ({
		profile,
		portraits: transformed
			.filter((portrait) => portrait.profileIndex === profileIndex)
			.map(({ leaderIndex, portraitIndex, portrait }) => ({
				leaderIndex,
				portraitIndex,
				portrait
			}))
	}));
}

function assertDistinctIssuerKeys(profiles: readonly ExecutiveProfile[]): void {
	const seen = new Set<string>();
	for (const profile of profiles) {
		if (seen.has(profile.issuer_key)) {
			throw new Error(
				`Executive profile batch contains duplicate issuer_key ${profile.issuer_key}`
			);
		}
		seen.add(profile.issuer_key);
	}
}

function assertConsistentSourceKinds(profiles: readonly ExecutiveProfile[]): void {
	const kinds = new Map<string, string>();
	for (const profile of profiles) {
		for (const leader of profile.leaders) {
			const sources = [
				leader.role_source,
				...leader.portraits.map((portrait) => portrait.source),
				...leader.summary_sources,
				...leader.facts.flatMap((fact) => fact.sources)
			];
			for (const source of sources) {
				const existing = kinds.get(source.url);
				if (existing !== undefined && existing !== source.kind) {
					throw new Error(
						`Source ${source.url} has conflicting kinds ${existing} and ${source.kind}`
					);
				}
				kinds.set(source.url, source.kind);
			}
		}
	}
}

function assertUniverseIntegrity(universe: readonly NormalizedIssuer[]): void {
	const issuerKeys = new Set<string>();
	const ciks = new Set<string>();
	const tickers = new Set<string>();

	for (const issuer of universe) {
		if (issuerKeys.has(issuer.issuerKey)) {
			throw new Error(`Normalized universe contains duplicate issuerKey ${issuer.issuerKey}`);
		}
		issuerKeys.add(issuer.issuerKey);

		if (issuer.cik !== null) {
			if (ciks.has(issuer.cik)) {
				throw new Error(`Normalized universe contains duplicate CIK ${issuer.cik}`);
			}
			ciks.add(issuer.cik);
		}

		if (issuer.included === (issuer.exclusionReason !== null)) {
			throw new Error(
				`Issuer ${issuer.issuerKey} has inconsistent included and exclusionReason values`
			);
		}

		const canonical = issuer.listings.filter((listing) => listing.isCanonical);
		if (canonical.length !== 1 || canonical[0]!.ticker !== issuer.canonicalTicker) {
			throw new Error(
				`Issuer ${issuer.issuerKey} must have exactly one canonical listing matching ${issuer.canonicalTicker}`
			);
		}

		for (const listing of issuer.listings) {
			if (tickers.has(listing.ticker)) {
				throw new Error(`Normalized universe contains duplicate listing ticker ${listing.ticker}`);
			}
			tickers.add(listing.ticker);
		}
	}
}

function assertPortraitConcurrency(value: number): void {
	if (!Number.isInteger(value) || value < 1 || value > 16) {
		throw new Error('portraitConcurrency must be an integer from 1 through 16');
	}
}

function assertPairingSeed(value: string): void {
	if (!PAIRING_SEED_PATTERN.test(value)) {
		throw new Error('pairingSeed must return 32 cryptographically random bytes as lowercase hex');
	}
}

async function mapConcurrent<T, R>(
	values: readonly T[],
	concurrency: number,
	mapper: (value: T) => Promise<R>
): Promise<R[]> {
	const output = new Array<R>(values.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < values.length) {
			const index = nextIndex++;
			output[index] = await mapper(values[index]!);
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
	return output;
}
