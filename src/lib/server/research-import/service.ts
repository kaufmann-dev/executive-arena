import { randomBytes } from 'node:crypto';
import { downloadAndTransformPortrait, PortraitValidationError } from '../../research/portrait';
import { executiveProfileSchema, type ExecutiveProfile } from '../../research/schemas';
import { normalizedUniverseSnapshotSchema, type NormalizedIssuer } from '../../research/universe';
import type {
	FreezeReadinessIssue,
	FreezeReadinessRow,
	PortraitDiagnosticReporter,
	PortraitRejectionDiagnostic,
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
	const portraitDiagnostic = options.portraitDiagnostic ?? logPortraitDiagnostic;
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

			const profiles = parseExecutiveProfileSet(values, portraitDiagnostic);
			const prepared = await preparePortraits(
				profiles,
				portraitConcurrency,
				options.fetchPortrait,
				options.resolvePortraitAddresses,
				portraitDiagnostic
			);
			const seed = pairingSeed();
			assertPairingSeed(seed);
			return repository.writeProfiles(prepared, {
				importedAt: now(),
				claimCheckedAt: (options.claimClock ?? now)(),
				pairingSeed: seed,
				submittedByApiKeyId: options.submittedByApiKeyId ?? null,
				publicationClaims: options.publicationClaims ?? null
			});
		},

		async freeze() {
			const seed = pairingSeed();
			assertPairingSeed(seed);
			return repository.freeze({ frozenAt: now(), pairingSeed: seed });
		}
	};
}

export function parseExecutiveProfileSet(
	values: readonly unknown[],
	portraitDiagnostic?: PortraitDiagnosticReporter
): ExecutiveProfile[] {
	if (values.length === 0) {
		throw new Error('At least one executive profile is required');
	}

	const profiles = values.map((value) =>
		parseExecutiveProfileForPublication(value, portraitDiagnostic)
	);
	assertDistinctIssuerKeys(profiles);
	return profiles;
}

export function parseExecutiveProfileForPublication(
	value: unknown,
	portraitDiagnostic?: PortraitDiagnosticReporter
): ExecutiveProfile {
	const failure = findSubmittedPortraitFailure(value);
	if (failure) {
		portraitDiagnostic?.(portraitDiagnosticEvent(failure.error, failure.context));
		throw failure.error;
	}
	return executiveProfileSchema.parse(value);
}

export function logPortraitDiagnostic(diagnostic: PortraitRejectionDiagnostic): void {
	console.warn(JSON.stringify(diagnostic));
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
	resolvePortraitAddresses?: ResearchImportServiceOptions['resolvePortraitAddresses'],
	portraitDiagnostic: PortraitDiagnosticReporter = logPortraitDiagnostic
): Promise<PreparedExecutiveProfile[]> {
	const jobs = profiles.flatMap((profile, profileIndex) =>
		profile.leaders.flatMap((leader, leaderIndex) =>
			leader.portraits.map((portrait, portraitIndex) => ({
				profileIndex,
				leaderIndex,
				portraitIndex,
				issuerKey: profile.issuer_key,
				leaderName: leader.name,
				url: portrait.image_url
			}))
		)
	);
	const transformed = await mapConcurrent(jobs, concurrency, async (job) => {
		try {
			return {
				...job,
				portrait: await downloadAndTransformPortrait(
					job.url,
					fetchPortrait,
					resolvePortraitAddresses
				)
			};
		} catch (cause) {
			if (cause instanceof PortraitValidationError) {
				portraitDiagnostic(
					portraitDiagnosticEvent(cause, {
						issuerKey: job.issuerKey,
						leaderName: job.leaderName,
						leaderIndex: job.leaderIndex,
						portraitIndex: job.portraitIndex,
						imageUrl: job.url
					})
				);
			}
			throw cause;
		}
	});
	assertDistinctPortraitContent(transformed, portraitDiagnostic);

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

interface PortraitDiagnosticContext {
	issuerKey: string | null;
	leaderName: string | null;
	leaderIndex: number | null;
	portraitIndex: number | null;
	imageUrl: string | null;
}

interface SubmittedPortraitFailure {
	error: PortraitValidationError;
	context: PortraitDiagnosticContext;
}

function findSubmittedPortraitFailure(value: unknown): SubmittedPortraitFailure | null {
	if (!isRecord(value) || !Array.isArray(value.leaders)) return null;
	const issuerKey = typeof value.issuer_key === 'string' ? value.issuer_key : null;

	for (const [leaderIndex, leaderValue] of value.leaders.entries()) {
		if (!isRecord(leaderValue)) continue;
		const leaderName = typeof leaderValue.name === 'string' ? leaderValue.name : null;
		const portraits = leaderValue.portraits;
		if (!Array.isArray(portraits) || portraits.length === 0) {
			return submittedPortraitFailure(
				'portrait_missing',
				'Every executive must include at least one portrait',
				{ issuerKey, leaderName, leaderIndex, portraitIndex: null, imageUrl: null }
			);
		}

		for (const [portraitIndex, portraitValue] of portraits.entries()) {
			if (!isRecord(portraitValue)) continue;
			const imageUrl = typeof portraitValue.image_url === 'string' ? portraitValue.image_url : null;
			if (imageUrl !== null && parsedProtocol(imageUrl) !== 'https:') {
				return submittedPortraitFailure('portrait_not_https', 'Portrait URL must use HTTPS', {
					issuerKey,
					leaderName,
					leaderIndex,
					portraitIndex,
					imageUrl
				});
			}
			if (portraitValue.is_real_person !== true) {
				return submittedPortraitFailure(
					'portrait_unattributable',
					'Portrait must be attested as a real, attributable image of the named executive',
					{ issuerKey, leaderName, leaderIndex, portraitIndex, imageUrl }
				);
			}
		}
	}
	return null;
}

function submittedPortraitFailure(
	code: 'portrait_missing' | 'portrait_not_https' | 'portrait_unattributable',
	message: string,
	context: PortraitDiagnosticContext
): SubmittedPortraitFailure {
	return {
		error: new PortraitValidationError(code, message, {
			stage: 'validation',
			originalWidth: null,
			originalHeight: null,
			format: null
		}),
		context
	};
}

function parsedProtocol(value: string): string | null {
	try {
		return new URL(value).protocol;
	} catch {
		return null;
	}
}

function assertDistinctPortraitContent(
	transformed: Array<{
		profileIndex: number;
		issuerKey: string;
		leaderName: string;
		leaderIndex: number;
		portraitIndex: number;
		url: string;
		portrait: Awaited<ReturnType<typeof downloadAndTransformPortrait>>;
	}>,
	portraitDiagnostic: PortraitDiagnosticReporter
): void {
	const hashes = new Map<string, Set<string>>();
	for (const candidate of transformed) {
		const key = `${candidate.profileIndex}:${candidate.leaderIndex}`;
		const leaderHashes = hashes.get(key) ?? new Set<string>();
		if (leaderHashes.has(candidate.portrait.sha256)) {
			const error = new PortraitValidationError(
				'portrait_duplicate',
				'Each executive portrait must contain distinct image content',
				{
					stage: 'normalize',
					originalWidth: candidate.portrait.originalWidth,
					originalHeight: candidate.portrait.originalHeight,
					format: candidate.portrait.originalFormat
				}
			);
			portraitDiagnostic(
				portraitDiagnosticEvent(error, {
					issuerKey: candidate.issuerKey,
					leaderName: candidate.leaderName,
					leaderIndex: candidate.leaderIndex,
					portraitIndex: candidate.portraitIndex,
					imageUrl: candidate.url
				})
			);
			throw error;
		}
		leaderHashes.add(candidate.portrait.sha256);
		hashes.set(key, leaderHashes);
	}
}

function portraitDiagnosticEvent(
	error: PortraitValidationError,
	context: PortraitDiagnosticContext
): PortraitRejectionDiagnostic {
	return {
		event: 'portrait_rejected',
		code: error.code,
		issuerKey: context.issuerKey,
		leaderName: context.leaderName,
		leaderIndex: context.leaderIndex,
		portraitIndex: context.portraitIndex,
		imageLocation: sanitizedImageLocation(context.imageUrl),
		...error.diagnostic
	};
}

function sanitizedImageLocation(value: string | null): string | null {
	if (value === null) return null;
	try {
		const url = new URL(value);
		return `${url.origin}${url.pathname}`;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
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
