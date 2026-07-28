import { randomBytes } from 'node:crypto';
import {
	downloadAndTransformPortrait,
	PortraitValidationError,
	sanitizedPortraitLocation
} from '../../research/portrait';
import {
	executiveProfileMcpSubmissionSchema,
	executiveProfileSchema,
	type ExecutiveProfile
} from '../../research/schemas';
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

			const portraitDiagnostics: PortraitRejectionDiagnostic[] = [];
			const reportPortraitDiagnostic: PortraitDiagnosticReporter = (diagnostic) => {
				portraitDiagnostics.push(diagnostic);
				portraitDiagnostic(diagnostic);
			};
			const profiles = parseExecutiveProfileSet(values, reportPortraitDiagnostic);
			const prepared = await preparePortraits(
				profiles,
				portraitConcurrency,
				options.fetchPortrait,
				options.resolvePortraitAddresses,
				reportPortraitDiagnostic
			);
			for (const item of prepared) {
				item.portraitDiagnostics = portraitDiagnostics.filter(
					(diagnostic) => diagnostic.issuerKey === item.profile.issuer_key
				);
			}
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
	const submission = executiveProfileMcpSubmissionSchema.parse(value);
	const leaders = submission.leaders.map((leader, leaderIndex) => {
		const portraits = leader.portraits.filter((portrait, portraitIndex) => {
			const failure = submittedPortraitCandidateFailure(portrait, {
				issuerKey: submission.issuer_key,
				leaderName: leader.name,
				leaderIndex,
				portraitIndex,
				imageUrl: portrait.image_url
			});
			if (!failure) return true;
			portraitDiagnostic?.(portraitDiagnosticEvent(failure.error, failure.context));
			return false;
		});
		return { ...leader, portraits };
	});
	return executiveProfileSchema.parse({ ...submission, leaders });
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
			if (row.profileSourceCount < 1) {
				issues.push({
					issuerKey,
					message: `${first.companyName} member ${personLabel} has no profile source`
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
				url: portrait.image_url,
				sourcePageUrl: portrait.source?.url ?? null
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
					resolvePortraitAddresses,
					{ sourcePageUrl: job.sourcePageUrl }
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
				return { ...job, portrait: null };
			}
			throw cause;
		}
	});
	const accepted = transformed.filter(
		(
			candidate
		): candidate is typeof candidate & { portrait: NonNullable<typeof candidate.portrait> } =>
			candidate.portrait !== null
	);
	const distinct = distinctPortraitContent(accepted, portraitDiagnostic);

	return profiles.map((profile, profileIndex) => {
		const preparedPortraits: PreparedExecutiveProfile['portraits'] = [];
		const leaders = profile.leaders.map((leader, leaderIndex) => {
			const candidates = distinct
				.filter(
					(candidate) =>
						candidate.profileIndex === profileIndex && candidate.leaderIndex === leaderIndex
				)
				.sort((left, right) => left.portraitIndex - right.portraitIndex);
			const portraits = candidates.map((candidate, portraitIndex) => {
				preparedPortraits.push({
					leaderIndex,
					portraitIndex,
					portrait: candidate.portrait
				});
				return leader.portraits[candidate.portraitIndex]!;
			});
			return {
				...leader,
				portraits
			};
		});
		return {
			profile: { ...profile, leaders },
			portraits: preparedPortraits,
			portraitDiagnostics: []
		};
	});
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

function submittedPortraitCandidateFailure(
	portrait: { image_url: string; is_real_person: boolean },
	context: PortraitDiagnosticContext
): SubmittedPortraitFailure | null {
	if (parsedProtocol(portrait.image_url) !== 'https:') {
		return submittedPortraitFailure('portrait_not_https', 'Portrait URL must use HTTPS', context);
	}
	if (portrait.is_real_person !== true) {
		return submittedPortraitFailure(
			'portrait_unattributable',
			'Portrait must be attested as a real, attributable image of the named executive',
			context
		);
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
			format: null,
			httpStatus: null,
			contentType: null,
			finalLocation: safePortraitLocation(context.imageUrl)
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

function distinctPortraitContent<
	T extends {
		profileIndex: number;
		issuerKey: string;
		leaderName: string;
		leaderIndex: number;
		portraitIndex: number;
		url: string;
		portrait: Awaited<ReturnType<typeof downloadAndTransformPortrait>>;
	}
>(transformed: T[], portraitDiagnostic: PortraitDiagnosticReporter): T[] {
	const hashes = new Map<string, Set<string>>();
	const accepted: T[] = [];
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
					format: candidate.portrait.originalFormat,
					httpStatus: candidate.portrait.sourceHttpStatus,
					contentType: candidate.portrait.sourceContentType,
					finalLocation:
						candidate.portrait.sourceFinalLocation ?? safePortraitLocation(candidate.url)
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
			continue;
		}
		leaderHashes.add(candidate.portrait.sha256);
		hashes.set(key, leaderHashes);
		accepted.push(candidate);
	}
	return accepted;
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
		imageLocation: error.diagnostic.finalLocation ?? safePortraitLocation(context.imageUrl),
		...error.diagnostic
	};
}

function safePortraitLocation(value: string | null): string | null {
	if (value === null) return null;
	try {
		return sanitizedPortraitLocation(value);
	} catch {
		return null;
	}
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
