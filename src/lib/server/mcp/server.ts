import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { portraitCandidateRejection, PortraitValidationError } from '$lib/research/portrait';
import { executiveProfileMcpSubmissionSchema, executiveProfileSchema } from '$lib/research/schemas';
import { reviewedIssuerAliasesSchema } from '$lib/research/universe';
import { CompanyClaimError, MAX_COMPANY_CLAIM_BATCH_SIZE } from '$lib/server/research-claims';
import type { AuthenticatedMcpApiKey } from './api-keys';
import {
	databaseFailureMetadata,
	logProfilePublicationFailure,
	ProfilePublicationFailure
} from './publication-error';
import { syncMassiveUniverse } from './massive-sync-service';
import {
	claimCompanies,
	freezeCohort,
	getCompanyProfile,
	getCohortStatus,
	listCompanies,
	McpResearchError,
	publishExecutiveProfile,
	releaseCompanyClaim,
	renewCompanyClaim,
	validatePortraitCandidate
} from './research-service';

const companyStatusSchema = z.enum(['all', 'not_ready', 'missing_image', 'ready', 'excluded']);
const readinessStatusSchema = z.enum(['not_ready', 'missing_image', 'ready', 'excluded']);
const uuidSchema = z.uuid();
const companyClaimTokenSchema = z.string().regex(/^eac_[A-Za-z0-9_-]{43}$/);
const companyClaimSchema = z.object({ expiresAt: z.iso.datetime() }).nullable();
const MAX_MCP_BATCH_SIZE = 25;
const portraitValidationCodeSchema = z.enum([
	'portrait_missing',
	'portrait_not_https',
	'portrait_unattributable',
	'portrait_unusable_resolution',
	'portrait_invalid_image',
	'portrait_duplicate',
	'portrait_download_failed',
	'portrait_unsafe_url',
	'portrait_input_too_large'
]);
const portraitCandidateOutputSchema = z.object({
	status: z.enum(['accepted', 'rejected']),
	rejectionCode: portraitValidationCodeSchema.nullable(),
	message: z.string().nullable(),
	stage: z.enum(['validation', 'download', 'decode', 'normalize']),
	httpStatus: z.number().int().min(100).max(599).nullable(),
	contentType: z.string().nullable(),
	format: z.string().nullable(),
	width: z.number().int().positive().nullable(),
	height: z.number().int().positive().nullable(),
	finalLocation: z.string().nullable()
});

const coverageOutputSchema = z.object({
	included: z.number().int().nonnegative(),
	ready: z.number().int().nonnegative(),
	missingImage: z.number().int().nonnegative(),
	notReady: z.number().int().nonnegative(),
	excluded: z.number().int().nonnegative(),
	claimed: z.number().int().nonnegative(),
	available: z.number().int().nonnegative(),
	universeAsOf: z.string().nullable(),
	cohortRevision: z.number().int().positive(),
	cohortFrozenAt: z.string().nullable()
});

const companyListOutputSchema = z.object({
	items: z.array(
		z.object({
			companyId: uuidSchema,
			issuerKey: z.string(),
			cik: z.string().nullable(),
			ticker: z.string(),
			name: z.string(),
			included: z.boolean(),
			status: readinessStatusSchema,
			claim: companyClaimSchema
		})
	),
	nextCursor: z.string().nullable()
});

const companyProfileOutputSchema = z.object({
	company: z.object({
		companyId: uuidSchema,
		issuerKey: z.string(),
		cik: z.string().nullable(),
		ticker: z.string(),
		name: z.string(),
		status: readinessStatusSchema,
		claim: companyClaimSchema
	}),
	universeAsOf: z.string().nullable(),
	currentProfile: executiveProfileSchema.nullable(),
	currentProfileImportedAt: z.string().nullable(),
	requirements: z.object({
		schemaVersion: z.literal(4),
		summaryWords: z.object({
			minimum: z.literal(50),
			maximum: z.literal(100)
		}),
		sources: z.object({
			minimumPerExecutive: z.literal(1),
			appliesTo: z.tuple([z.literal('role'), z.literal('summary'), z.literal('facts')]),
			portraitProvenanceRequired: z.literal(false)
		}),
		factsRequired: z.literal(false),
		portraits: z.object({
			minimum: z.literal(0),
			targetMinimum: z.literal(3),
			maximum: z.literal(3),
			requiredForReady: z.literal(true),
			mustBeRealHttpsImages: z.literal(true),
			singleAllowedAfterReasonableSearch: z.literal(true),
			venues: z.tuple([
				z.literal('official sites'),
				z.literal('SEC exhibits'),
				z.literal('press releases'),
				z.literal('conference and speaker biographies'),
				z.literal('reputable news'),
				z.literal('professional biographies')
			])
		}),
		multipleLeaders: z.string()
	})
});

const claimCompaniesOutputSchema = z.object({
	claims: z.array(
		z.object({
			companyId: uuidSchema,
			claimToken: companyClaimTokenSchema,
			claimedAt: z.iso.datetime(),
			expiresAt: z.iso.datetime(),
			task: companyProfileOutputSchema
		})
	)
});

const renewCompanyClaimOutputSchema = z.object({
	companyId: uuidSchema,
	expiresAt: z.iso.datetime()
});

const releaseCompanyClaimOutputSchema = z.object({
	companyId: uuidSchema,
	released: z.boolean()
});

const publishOutputSchema = z.object({
	action: z.enum(['created', 'updated', 'replaced', 'unchanged']),
	companyId: uuidSchema,
	slateId: uuidSchema,
	slateVersion: z.number().int().positive(),
	cohortRevision: z.number().int().positive().nullable(),
	readinessStatus: readinessStatusSchema,
	acceptedPortraitCount: z.number().int().nonnegative(),
	portraitDiagnostics: z.array(
		z.object({
			event: z.literal('portrait_rejected'),
			code: portraitValidationCodeSchema,
			issuerKey: z.string().nullable(),
			leaderName: z.string().nullable(),
			leaderIndex: z.number().int().nonnegative().nullable(),
			portraitIndex: z.number().int().nonnegative().nullable(),
			imageLocation: z.string().nullable(),
			stage: z.enum(['validation', 'download', 'decode', 'normalize']),
			originalWidth: z.number().int().positive().nullable(),
			originalHeight: z.number().int().positive().nullable(),
			format: z.string().nullable(),
			httpStatus: z.number().int().min(100).max(599).nullable(),
			contentType: z.string().nullable(),
			finalLocation: z.string().nullable()
		})
	),
	companyPath: z.string()
});
const toolErrorOutputSchema = z.object({
	code: z.string(),
	message: z.string(),
	portrait: portraitCandidateOutputSchema.optional()
});
const batchPublishOutputSchema = z.object({
	results: z.array(
		z.discriminatedUnion('status', [
			publishOutputSchema.extend({
				index: z.number().int().nonnegative(),
				status: z.literal('published')
			}),
			z.object({
				index: z.number().int().nonnegative(),
				companyId: uuidSchema,
				status: z.literal('rejected'),
				error: toolErrorOutputSchema
			})
		])
	)
});
const batchPortraitOutputSchema = z.object({
	results: z.array(
		portraitCandidateOutputSchema.extend({
			index: z.number().int().nonnegative()
		})
	)
});

const universeSyncResultSchema = z.discriminatedUnion('status', [
	z.object({
		status: z.enum(['imported', 'unchanged']),
		asOf: z.iso.date(),
		payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
		issuerCount: z.number().int().positive(),
		includedCount: z.number().int().nonnegative(),
		excludedCount: z.number().int().nonnegative(),
		listingCount: z.number().int().positive()
	}),
	z.object({
		status: z.literal('needs_alias_review'),
		asOf: z.iso.date(),
		listingCount: z.number().int().positive(),
		unresolvedListings: z.array(
			z.object({
				ticker: z.string(),
				name: z.string(),
				primaryExchange: z.string().nullable(),
				homepageUrl: z.string().nullable(),
				tickerRoot: z.string().nullable(),
				compositeFigi: z.string().nullable(),
				shareClassFigi: z.string().nullable()
			})
		)
	})
]);

const universeSyncOutputSchema = z
	.object({
		status: z.enum(['imported', 'unchanged', 'needs_alias_review']),
		asOf: z.iso.date(),
		payloadSha256: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
		issuerCount: z.number().int().positive().optional(),
		includedCount: z.number().int().nonnegative().optional(),
		excludedCount: z.number().int().nonnegative().optional(),
		listingCount: z.number().int().positive(),
		unresolvedListings: z
			.array(
				z.object({
					ticker: z.string(),
					name: z.string(),
					primaryExchange: z.string().nullable(),
					homepageUrl: z.string().nullable(),
					tickerRoot: z.string().nullable(),
					compositeFigi: z.string().nullable(),
					shareClassFigi: z.string().nullable()
				})
			)
			.optional()
	})
	.superRefine((result, context) => {
		const parsed = universeSyncResultSchema.safeParse(result);
		if (parsed.success) return;
		for (const issue of parsed.error.issues) {
			context.addIssue({
				code: 'custom',
				path: issue.path,
				message: issue.message
			});
		}
	});

const freezeOutputSchema = z.object({
	includedCount: z.number().int().min(2),
	revision: z.number().int().positive(),
	frozenAt: z.string(),
	alreadyFrozen: z.boolean()
});

const SERVER_INSTRUCTIONS = [
	'Call sync_massive_universe before executive research when no universe exists. The server fetches Massive directly; retry with reviewedAliases if it returns needs_alias_review.',
	'For parallel research, use claim_companies to atomically receive unclaimed not-ready companies, their complete research tasks, and 45-minute claim tokens. Use renew_company_claim when active work needs more time, release_company_claim when abandoning work, and pass the matching claimToken to publish_executive_profile.',
	'Use list_companies and get_company_profile for dashboards, inspection, or deliberate unclaimed publication.',
	'For prepared batches, prefer get_company_profiles, validate_portrait_candidates, and publish_executive_profiles to reduce round trips while preserving per-company validation.',
	'Use relevant official or reputable secondary HTTP(S) sources. Each executive needs at least one shared source supporting the current role, summary, and optional facts; portrait provenance is optional.',
	'Portrait image_url values must be direct downloadable HTTPS image assets. Do not submit leadership, investor-relations, SEC HTML, or PDF document URLs as image_url values. Use validate_portrait_candidate before publication when an asset is uncertain.',
	'For each executive, preferably submit three distinct real HTTPS portraits when they are readily available; fewer, including zero, is valid. Invalid candidates are discarded and reported without blocking the sourced text profile.',
	'Call publish_executive_profile when the schema-version 4 identity, role, summary, and shared source are supported by evidence. It updates the live website immediately and may return missing_image.',
	'If leadership evidence is insufficient, do not guess; leave the company not ready and continue with another company.',
	'Call freeze_cohort only after every included company is ready.'
].join(' ');

export function createExecutiveArenaMcpServer(apiKey: AuthenticatedMcpApiKey): McpServer {
	const server = new McpServer(
		{ name: 'executive-arena', version: '1.0.0' },
		{ instructions: SERVER_INSTRUCTIONS }
	);

	server.registerTool(
		'sync_massive_universe',
		{
			title: 'Synchronize the Massive company universe',
			description:
				'Fetch, validate, and atomically import the active US common-stock universe from Massive. Omit asOf to use the current UTC date. If eligible listings lack CIKs, retry with reviewedAliases from ticker to a shared alias:stable-id.',
			inputSchema: z.object({
				asOf: z.iso.date().optional(),
				reviewedAliases: reviewedIssuerAliasesSchema.optional()
			}),
			outputSchema: universeSyncOutputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true
			}
		},
		async (input, extra) =>
			runTool(() =>
				syncMassiveUniverse(apiKey, input, {
					signal: extra.signal,
					onProgress: async (progress) => {
						const progressToken = extra._meta?.progressToken;
						if (progressToken === undefined) return;
						await extra.sendNotification({
							method: 'notifications/progress',
							params: { progressToken, ...progress }
						});
					}
				})
			)
	);

	server.registerTool(
		'get_cohort_status',
		{
			title: 'Get executive research coverage',
			description: 'Return readiness totals and the current cohort and universe state.',
			inputSchema: z.object({}),
			outputSchema: coverageOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false
			}
		},
		async () => runTool(getCohortStatus)
	);

	server.registerTool(
		'list_companies',
		{
			title: 'List companies for executive research',
			description:
				'Page through companies by readiness, company name, or ticker. Start with not-ready companies.',
			inputSchema: z.object({
				status: companyStatusSchema.default('not_ready'),
				query: z.string().trim().max(100).optional(),
				cursor: z.string().max(1_000).optional(),
				limit: z.number().int().min(1).max(50).default(20)
			}),
			outputSchema: companyListOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false
			}
		},
		async (input) => runTool(() => listCompanies(input))
	);

	server.registerTool(
		'claim_companies',
		{
			title: 'Claim companies for executive research',
			description:
				'Atomically claim up to ten currently unclaimed, included, not-ready companies for 45 minutes and return complete research tasks with bearer claim tokens.',
			inputSchema: z.object({
				limit: z.number().int().min(1).max(MAX_COMPANY_CLAIM_BATCH_SIZE).default(1)
			}),
			outputSchema: claimCompaniesOutputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false
			}
		},
		async (input) => runTool(() => claimCompanies(apiKey, input))
	);

	server.registerTool(
		'renew_company_claim',
		{
			title: 'Renew a company research claim',
			description: 'Extend a matching active company claim for another 45 minutes.',
			inputSchema: z.object({
				companyId: uuidSchema,
				claimToken: companyClaimTokenSchema
			}),
			outputSchema: renewCompanyClaimOutputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false
			}
		},
		async ({ companyId, claimToken }) => runTool(() => renewCompanyClaim(companyId, claimToken))
	);

	server.registerTool(
		'release_company_claim',
		{
			title: 'Release a company research claim',
			description:
				'Release a matching company claim immediately so another worker can claim the company.',
			inputSchema: z.object({
				companyId: uuidSchema,
				claimToken: companyClaimTokenSchema
			}),
			outputSchema: releaseCompanyClaimOutputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false
			}
		},
		async ({ companyId, claimToken }) => runTool(() => releaseCompanyClaim(companyId, claimToken))
	);

	server.registerTool(
		'get_company_profile',
		{
			title: 'Get a company profile',
			description:
				'Return company identity, the current reconstructed profile, and exact publication requirements.',
			inputSchema: z.object({ companyId: uuidSchema }),
			outputSchema: companyProfileOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false
			}
		},
		async ({ companyId }) => runTool(() => getCompanyProfile(companyId))
	);

	server.registerTool(
		'get_company_profiles',
		{
			title: 'Get multiple company profiles',
			description: 'Return complete research tasks for up to 25 known company IDs in input order.',
			inputSchema: z.object({
				companyIds: z.array(uuidSchema).min(1).max(MAX_MCP_BATCH_SIZE)
			}),
			outputSchema: z.object({ items: z.array(companyProfileOutputSchema) }),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false
			}
		},
		async ({ companyIds }) =>
			runTool(async () => ({
				items: await Promise.all(companyIds.map((companyId) => getCompanyProfile(companyId)))
			}))
	);

	server.registerTool(
		'validate_portrait_candidate',
		{
			title: 'Validate a portrait image candidate',
			description:
				'Download and validate one direct HTTPS image asset without publishing or storing it. Returns only sanitized response and image metadata.',
			inputSchema: z.object({ imageUrl: z.url() }),
			outputSchema: portraitCandidateOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true
			}
		},
		async ({ imageUrl }) => runTool(() => validatePortraitCandidate(imageUrl))
	);

	server.registerTool(
		'validate_portrait_candidates',
		{
			title: 'Validate portrait image candidates in bulk',
			description:
				'Download and validate up to 25 direct HTTPS image assets concurrently without publishing or storing them. Results preserve input order.',
			inputSchema: z.object({
				imageUrls: z.array(z.url()).min(1).max(MAX_MCP_BATCH_SIZE)
			}),
			outputSchema: batchPortraitOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true
			}
		},
		async ({ imageUrls }) =>
			runTool(async () => ({
				results: await mapConcurrent(imageUrls, 8, async (imageUrl, index) => ({
					index,
					...(await validatePortraitCandidate(imageUrl))
				}))
			}))
	);

	server.registerTool(
		'publish_executive_profile',
		{
			title: 'Publish an executive profile',
			description:
				'Validate and immediately publish a sourced executive profile for one included company. Portrait failures are reported without blocking valid text. This changes the live website.',
			inputSchema: z.object({
				companyId: uuidSchema,
				profile: executiveProfileMcpSubmissionSchema,
				claimToken: companyClaimTokenSchema.optional()
			}),
			outputSchema: publishOutputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: true
			}
		},
		async ({ companyId, profile, claimToken }) =>
			runTool(() =>
				publishExecutiveProfileWithLogging(apiKey, companyId, profile, new Date(), claimToken)
			)
	);

	server.registerTool(
		'publish_executive_profiles',
		{
			title: 'Publish multiple executive profiles',
			description:
				'Validate and publish up to 25 sourced profiles sequentially. Each company is isolated so one rejection does not abort successful publications.',
			inputSchema: z.object({
				items: z
					.array(
						z.object({
							companyId: uuidSchema,
							profile: executiveProfileMcpSubmissionSchema,
							claimToken: companyClaimTokenSchema.optional()
						})
					)
					.min(1)
					.max(MAX_MCP_BATCH_SIZE)
			}),
			outputSchema: batchPublishOutputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: true
			}
		},
		async ({ items }) =>
			runTool(async () => ({
				results: await mapConcurrent(items, 1, async (item, index) => {
					try {
						return {
							index,
							status: 'published' as const,
							...(await publishExecutiveProfileWithLogging(
								apiKey,
								item.companyId,
								item.profile,
								new Date(),
								item.claimToken
							))
						};
					} catch (cause) {
						return {
							index,
							companyId: item.companyId,
							status: 'rejected' as const,
							error: toolError(cause)
						};
					}
				})
			}))
	);

	server.registerTool(
		'freeze_cohort',
		{
			title: 'Freeze the executive cohort',
			description:
				'Validate complete sourced, portrait-ready coverage and irreversibly freeze the current company universe. Repeated calls return the existing frozen state.',
			inputSchema: z.object({}),
			outputSchema: freezeOutputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: false
			}
		},
		async () => runTool(freezeCohort)
	);

	return server;
}

async function runTool<T extends Record<string, unknown>>(operation: () => Promise<T>) {
	try {
		return success(await operation());
	} catch (cause) {
		return failure(cause);
	}
}

function success<T extends Record<string, unknown>>(value: T) {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(value) }],
		structuredContent: value
	};
}

function failure(cause: unknown) {
	const error = toolError(cause);
	return {
		isError: true,
		content: [{ type: 'text' as const, text: JSON.stringify(error) }]
	};
}

function toolError(cause: unknown) {
	if (cause instanceof PortraitValidationError) {
		return {
			code: cause.code,
			message: cause.message,
			portrait: portraitCandidateRejection(cause)
		};
	}
	if (cause instanceof CompanyClaimError || cause instanceof McpResearchError) {
		return { code: cause.code, message: cause.message };
	}
	if (cause instanceof z.ZodError) {
		return {
			code: 'validation_error',
			message: cause.issues[0]?.message ?? 'The submitted data is invalid'
		};
	}
	if (databaseFailureMetadata(cause)) {
		return {
			code: 'operation_failed',
			message: 'The database operation failed'
		};
	}
	if (cause instanceof ProfilePublicationFailure) {
		return {
			code: 'operation_failed',
			message: cause.message
		};
	}
	return {
		code: 'operation_failed',
		message: cause instanceof Error ? cause.message : 'The operation failed'
	};
}

async function publishExecutiveProfileWithLogging(
	apiKey: AuthenticatedMcpApiKey,
	companyId: string,
	profile: z.infer<typeof executiveProfileMcpSubmissionSchema>,
	now: Date,
	claimToken?: string
) {
	try {
		return await publishExecutiveProfile(apiKey, companyId, profile, now, claimToken);
	} catch (cause) {
		const failure =
			cause instanceof ProfilePublicationFailure
				? cause
				: databaseFailureMetadata(cause)
					? new ProfilePublicationFailure('publication', companyId, profile.issuer_key, cause)
					: null;
		if (failure) {
			logProfilePublicationFailure(failure);
			throw failure;
		}
		throw cause;
	}
}

async function mapConcurrent<T, R>(
	values: readonly T[],
	concurrency: number,
	mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(values.length);
	let nextIndex = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, values.length) }, async () => {
			while (nextIndex < values.length) {
				const index = nextIndex++;
				results[index] = await mapper(values[index]!, index);
			}
		})
	);
	return results;
}
