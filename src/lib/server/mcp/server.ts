import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PortraitValidationError } from '$lib/research/portrait';
import { executiveProfileMcpSubmissionSchema, executiveProfileSchema } from '$lib/research/schemas';
import { reviewedIssuerAliasesSchema } from '$lib/research/universe';
import { CompanyClaimError, MAX_COMPANY_CLAIM_BATCH_SIZE } from '$lib/server/research-claims';
import type { AuthenticatedMcpApiKey } from './api-keys';
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
	renewCompanyClaim
} from './research-service';

const companyStatusSchema = z.enum(['all', 'not_ready', 'ready', 'excluded']);
const uuidSchema = z.uuid();
const companyClaimTokenSchema = z.string().regex(/^eac_[A-Za-z0-9_-]{43}$/);
const companyClaimSchema = z.object({ expiresAt: z.iso.datetime() }).nullable();

const coverageOutputSchema = z.object({
	included: z.number().int().nonnegative(),
	ready: z.number().int().nonnegative(),
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
			status: z.enum(['not_ready', 'ready', 'excluded']),
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
		status: z.enum(['not_ready', 'ready', 'excluded']),
		claim: companyClaimSchema
	}),
	universeAsOf: z.string().nullable(),
	currentProfile: executiveProfileSchema.nullable(),
	currentProfileImportedAt: z.string().nullable(),
	requirements: z.object({
		schemaVersion: z.literal(3),
		summaryWords: z.object({
			minimum: z.literal(50),
			maximum: z.literal(100)
		}),
		citationsRequiredFor: z.tuple([
			z.literal('role'),
			z.literal('summary'),
			z.literal('facts'),
			z.literal('portraits')
		]),
		portraits: z.object({
			minimum: z.literal(1),
			targetMinimum: z.literal(2),
			maximum: z.literal(3),
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
	companyPath: z.string()
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
	'Use relevant official or reputable secondary HTTP(S) sources. Cite every role, summary, fact, and portrait.',
	'For each executive, seek two or three distinct real HTTPS portraits across official sites, SEC exhibits, press releases, conference or speaker biographies, reputable news, and professional biographies. Submit one portrait only after reasonable research finds no additional attributable option.',
	'Call publish_executive_profile only when the complete schema-version 3 profile is supported by evidence. It updates the live website immediately.',
	'If evidence is insufficient, do not guess; leave the company not ready and continue with another company.',
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
		'publish_executive_profile',
		{
			title: 'Publish an executive profile',
			description:
				'Validate and immediately publish a cited executive profile for one included company. This changes the live website.',
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
			runTool(() => publishExecutiveProfile(apiKey, companyId, profile, new Date(), claimToken))
	);

	server.registerTool(
		'freeze_cohort',
		{
			title: 'Freeze the executive cohort',
			description:
				'Validate complete cited coverage and irreversibly freeze the current company universe. Repeated calls return the existing frozen state.',
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
	const error =
		cause instanceof PortraitValidationError
			? { code: cause.code, message: cause.message }
			: cause instanceof CompanyClaimError
				? { code: cause.code, message: cause.message }
				: cause instanceof McpResearchError
					? { code: cause.code, message: cause.message }
					: cause instanceof z.ZodError
						? {
								code: 'validation_error',
								message: cause.issues[0]?.message ?? 'The submitted data is invalid'
							}
						: {
								code: 'operation_failed',
								message: cause instanceof Error ? cause.message : 'The operation failed'
							};
	return {
		isError: true,
		content: [{ type: 'text' as const, text: JSON.stringify(error) }]
	};
}
