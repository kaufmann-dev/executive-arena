import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executiveProfileSchema, executiveReviewArtifactSchema } from '$lib/research/schemas';
import type { AuthenticatedMcpApiKey } from './api-keys';
import {
	getExecutiveResearchTask,
	getResearchCoverage,
	listResearchCompanies,
	McpResearchError,
	publishExecutiveProfile,
	reportExecutiveResearchIssue
} from './research-service';

const companyStatusSchema = z.enum(['all', 'pending', 'ready', 'excluded']);
const reviewStatusSchema = z.enum(['all', 'clear', 'needs_review']);
const uuidSchema = z.uuid();

const coverageOutputSchema = z.object({
	included: z.number().int().nonnegative(),
	ready: z.number().int().nonnegative(),
	pending: z.number().int().nonnegative(),
	excluded: z.number().int().nonnegative(),
	needsReview: z.number().int().nonnegative(),
	universeAsOf: z.string().nullable()
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
			readinessStatus: z.enum(['pending', 'ready', 'excluded']),
			reviewStatus: z.enum(['clear', 'needs_review'])
		})
	),
	nextCursor: z.string().nullable()
});

const taskOutputSchema = z.object({
	task: z.unknown()
});

const publishOutputSchema = z.object({
	action: z.enum(['created', 'updated', 'replaced', 'unchanged']),
	companyId: uuidSchema,
	slateId: uuidSchema,
	slateVersion: z.number().int().positive(),
	cohortRevision: z.number().int().positive().nullable(),
	companyPath: z.string()
});

const issueOutputSchema = z.object({
	issueId: uuidSchema,
	companyId: uuidSchema,
	status: z.literal('needs_review'),
	reportedAt: z.string()
});

const SERVER_INSTRUCTIONS = [
	'Use list_research_companies to select an included company, then call get_executive_research_task before researching or publishing.',
	'Verify the current top executive with an official company page or SEC filing. Cite every biographical claim and use a real HTTPS portrait.',
	'Call publish_executive_profile only when the complete schema is supported by evidence. It updates the live website immediately.',
	'When evidence conflicts or is insufficient, call report_executive_research_issue instead of guessing.'
].join(' ');

export function createExecutiveArenaMcpServer(apiKey: AuthenticatedMcpApiKey): McpServer {
	const server = new McpServer(
		{ name: 'executive-arena', version: '1.0.0' },
		{ instructions: SERVER_INSTRUCTIONS }
	);

	server.registerTool(
		'get_research_coverage',
		{
			title: 'Get executive research coverage',
			description: 'Return current company profile coverage and unresolved research-review totals.',
			inputSchema: z.object({}),
			outputSchema: coverageOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false
			}
		},
		async () => runTool(getResearchCoverage)
	);

	server.registerTool(
		'list_research_companies',
		{
			title: 'List companies for executive research',
			description:
				'Page through companies by readiness, review state, company name, or ticker. Start with pending companies.',
			inputSchema: z.object({
				status: companyStatusSchema.default('pending'),
				review: reviewStatusSchema.default('all'),
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
		async (input) => runTool(() => listResearchCompanies(input))
	);

	server.registerTool(
		'get_executive_research_task',
		{
			title: 'Get an executive research task',
			description:
				'Return immutable company identity, current profile, unresolved issue, and exact profile requirements before research.',
			inputSchema: z.object({ companyId: uuidSchema }),
			outputSchema: taskOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false
			}
		},
		async ({ companyId }) =>
			runTool(async () => ({
				task: await getExecutiveResearchTask(companyId)
			}))
	);

	server.registerTool(
		'publish_executive_profile',
		{
			title: 'Publish an executive profile',
			description:
				'Validate and immediately publish a cited executive profile for one included company. This changes the live website.',
			inputSchema: z.object({
				companyId: uuidSchema,
				profile: executiveProfileSchema
			}),
			outputSchema: publishOutputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: true
			}
		},
		async ({ companyId, profile }) =>
			runTool(() => publishExecutiveProfile(apiKey, companyId, profile))
	);

	server.registerTool(
		'report_executive_research_issue',
		{
			title: 'Report an executive research issue',
			description:
				'Record conflicting or insufficient evidence for one company without changing its live profile.',
			inputSchema: z.object({
				companyId: uuidSchema,
				issue: executiveReviewArtifactSchema
			}),
			outputSchema: issueOutputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false
			}
		},
		async ({ companyId, issue }) =>
			runTool(() => reportExecutiveResearchIssue(apiKey, companyId, issue))
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
		cause instanceof McpResearchError
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
