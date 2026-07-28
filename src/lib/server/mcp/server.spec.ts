import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
	getCohortStatus: vi.fn(),
	listCompanies: vi.fn(),
	claimCompanies: vi.fn(),
	renewCompanyClaim: vi.fn(),
	releaseCompanyClaim: vi.fn(),
	getCompanyProfile: vi.fn(),
	validatePortraitCandidate: vi.fn(),
	publishExecutiveProfile: vi.fn(),
	freezeCohort: vi.fn(),
	syncMassiveUniverse: vi.fn()
}));

vi.mock('./research-service', () => ({
	...services,
	McpResearchError: class McpResearchError extends Error {
		constructor(
			readonly code: string,
			message: string
		) {
			super(message);
		}
	}
}));
vi.mock('./massive-sync-service', () => ({
	syncMassiveUniverse: services.syncMassiveUniverse
}));

import { createExecutiveArenaMcpServer } from './server';
import { PortraitValidationError } from '$lib/research/portrait';
import { CompanyClaimError } from '$lib/server/research-claims';
import { ProfilePublicationFailure } from './publication-error';

const apiKey = {
	id: '6f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b',
	name: 'Test key',
	prefix: 'abcdef123456',
	createdAt: new Date('2026-07-26T00:00:00.000Z'),
	lastUsedAt: null
};

let closeCurrent: (() => Promise<void>) | null = null;

afterEach(async () => {
	await closeCurrent?.();
	closeCurrent = null;
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe('Executive Arena MCP server', () => {
	it('advertises the complete research workflow and batch tools', async () => {
		const { client } = await connectedServer();
		const listed = await client.listTools();

		expect(client.getInstructions()).toContain('updates the live website immediately');
		expect(client.getInstructions()).toContain('preferably submit three');
		expect(client.getInstructions()).toContain('fewer, including zero, is valid');
		expect(client.getInstructions()).toContain('claim_companies');
		expect(client.getInstructions()).toContain('direct downloadable HTTPS image assets');
		expect(client.getInstructions()).toContain('Do not submit leadership');
		expect(listed.tools.map((tool) => tool.name)).toEqual([
			'sync_massive_universe',
			'get_cohort_status',
			'list_companies',
			'claim_companies',
			'renew_company_claim',
			'release_company_claim',
			'get_company_profile',
			'get_company_profiles',
			'validate_portrait_candidate',
			'validate_portrait_candidates',
			'publish_executive_profile',
			'publish_executive_profiles',
			'freeze_cohort'
		]);
		expect(
			listed.tools.find((tool) => tool.name === 'sync_massive_universe')?.annotations
		).toMatchObject({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
			openWorldHint: true
		});
		expect(
			listed.tools.find((tool) => tool.name === 'publish_executive_profile')?.annotations
		).toMatchObject({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: true,
			openWorldHint: true
		});
		expect(
			listed.tools.find((tool) => tool.name === 'validate_portrait_candidate')?.annotations
		).toMatchObject({
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true
		});
	});

	it('returns both text and structured content for a successful read tool', async () => {
		services.getCohortStatus.mockResolvedValue({
			included: 100,
			ready: 20,
			missingImage: 0,
			notReady: 80,
			excluded: 5,
			claimed: 7,
			available: 73,
			universeAsOf: '2026-07-25',
			cohortRevision: 2,
			cohortFrozenAt: null
		});
		const { client } = await connectedServer();

		const result = await client.callTool({
			name: 'get_cohort_status',
			arguments: {}
		});

		expect(result.structuredContent).toEqual({
			included: 100,
			ready: 20,
			missingImage: 0,
			notReady: 80,
			excluded: 5,
			claimed: 7,
			available: 73,
			universeAsOf: '2026-07-25',
			cohortRevision: 2,
			cohortFrozenAt: null
		});
		expect(result.content).toEqual([
			{
				type: 'text',
				text: expect.stringContaining('"notReady":80')
			}
		]);
	});

	it.each([
		{
			name: 'an imported universe',
			result: {
				status: 'imported' as const,
				asOf: '2026-07-26',
				payloadSha256: 'a'.repeat(64),
				issuerCount: 2,
				includedCount: 2,
				excludedCount: 0,
				listingCount: 2
			}
		},
		{
			name: 'a universe requiring alias review',
			result: {
				status: 'needs_alias_review' as const,
				asOf: '2026-07-26',
				listingCount: 1,
				unresolvedListings: [
					{
						ticker: 'EXMP',
						name: 'Example Inc.',
						primaryExchange: 'XNAS',
						homepageUrl: 'https://example.com',
						tickerRoot: 'EXMP',
						compositeFigi: null,
						shareClassFigi: null
					}
				]
			}
		}
	])('returns structured content for $name', async ({ result }) => {
		services.syncMassiveUniverse.mockResolvedValue(result);
		const { client } = await connectedServer();

		const response = await client.callTool({
			name: 'sync_massive_universe',
			arguments: {}
		});

		expect(response.isError).not.toBe(true);
		expect(response.structuredContent).toEqual(result);
	});

	it('rejects sync output whose fields do not match its status', async () => {
		services.syncMassiveUniverse.mockResolvedValue({
			status: 'imported',
			asOf: '2026-07-26',
			listingCount: 2
		});
		const { client } = await connectedServer();

		const response = await client.callTool({
			name: 'sync_massive_universe',
			arguments: {}
		});

		expect(response.isError).toBe(true);
		expect(response.content).toEqual([
			expect.objectContaining({
				type: 'text',
				text: expect.stringContaining('Output validation error')
			})
		]);
	});

	it('rejects malformed tool input before calling the research service', async () => {
		const { client } = await connectedServer();

		const result = await client.callTool({
			name: 'get_company_profile',
			arguments: { companyId: 'not-a-uuid' }
		});

		expect(result.isError).toBe(true);
		expect(services.getCompanyProfile).not.toHaveBeenCalled();
	});

	it('returns sanitized portrait diagnostics from publication validation', async () => {
		services.publishExecutiveProfile.mockRejectedValue(
			new PortraitValidationError(
				'portrait_invalid_image',
				'Portrait could not be decoded as an image',
				{
					stage: 'decode',
					originalWidth: null,
					originalHeight: null,
					format: null,
					httpStatus: 200,
					contentType: 'text/html',
					finalLocation: 'https://example.com/leadership'
				}
			)
		);
		const { client } = await connectedServer();

		const result = await client.callTool({
			name: 'publish_executive_profile',
			arguments: {
				companyId: '6f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b',
				profile: validProfile()
			}
		});

		expect(services.publishExecutiveProfile).toHaveBeenCalled();
		expect(result.isError).toBe(true);
		expect(result.content).toEqual([
			{
				type: 'text',
				text: JSON.stringify({
					code: 'portrait_invalid_image',
					message: 'Portrait could not be decoded as an image',
					portrait: {
						status: 'rejected',
						rejectionCode: 'portrait_invalid_image',
						message: 'Portrait could not be decoded as an image',
						stage: 'decode',
						httpStatus: 200,
						contentType: 'text/html',
						format: null,
						width: null,
						height: null,
						finalLocation: 'https://example.com/leadership'
					}
				})
			}
		]);
	});

	it('logs structured database metadata without returning query parameters', async () => {
		const postgresError = Object.assign(new Error('connection terminated unexpectedly'), {
			name: 'PostgresError',
			code: '08006',
			severity: 'ERROR',
			table_name: 'research_snapshot'
		});
		const queryError = Object.assign(
			new Error(
				'Failed query: insert into research_snapshot (payload) values ($1)\nparams: secret-profile-payload'
			),
			{
				name: 'DrizzleQueryError',
				query: 'insert into research_snapshot (payload) values ($1)',
				params: ['secret-profile-payload'],
				cause: postgresError
			}
		);
		services.publishExecutiveProfile.mockRejectedValue(
			new ProfilePublicationFailure(
				'profile_import',
				'6f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b',
				'cik:0000000001',
				queryError
			)
		);
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { client } = await connectedServer();

		const result = await client.callTool({
			name: 'publish_executive_profile',
			arguments: {
				companyId: '6f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b',
				profile: validProfile()
			}
		});

		expect(result.isError).toBe(true);
		expect(result.content).toEqual([
			{
				type: 'text',
				text: JSON.stringify({
					code: 'operation_failed',
					message: 'The database operation failed'
				})
			}
		]);
		expect(errorLog).toHaveBeenCalledOnce();
		const logLine = String(errorLog.mock.calls[0]![0]);
		expect(logLine).toContain('"code":"08006"');
		expect(logLine).toContain('"table":"research_snapshot"');
		expect(logLine).not.toContain('secret-profile-payload');
		expect(logLine).not.toContain('insert into');
		expect(logLine).not.toContain('params:');
	});

	it('returns structured sanitized results from portrait candidate validation', async () => {
		services.validatePortraitCandidate.mockResolvedValue({
			status: 'accepted',
			rejectionCode: null,
			message: null,
			stage: 'normalize',
			httpStatus: 200,
			contentType: 'image/avif',
			format: 'avif',
			width: 240,
			height: 300,
			finalLocation: 'https://cdn.example.com/ada.avif'
		});
		const { client } = await connectedServer();

		const result = await client.callTool({
			name: 'validate_portrait_candidate',
			arguments: {
				imageUrl: 'https://cdn.example.com/ada.avif?token=secret'
			}
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toEqual({
			status: 'accepted',
			rejectionCode: null,
			message: null,
			stage: 'normalize',
			httpStatus: 200,
			contentType: 'image/avif',
			format: 'avif',
			width: 240,
			height: 300,
			finalLocation: 'https://cdn.example.com/ada.avif'
		});
		expect(services.validatePortraitCandidate).toHaveBeenCalledWith(
			'https://cdn.example.com/ada.avif?token=secret'
		);
	});

	it('validates multiple portrait candidates while preserving input order', async () => {
		services.validatePortraitCandidate
			.mockResolvedValueOnce({
				status: 'accepted',
				rejectionCode: null,
				message: null,
				stage: 'normalize',
				httpStatus: 200,
				contentType: 'image/jpeg',
				format: 'jpeg',
				width: 300,
				height: 400,
				finalLocation: 'https://cdn.example.com/one.jpg'
			})
			.mockResolvedValueOnce({
				status: 'rejected',
				rejectionCode: 'portrait_invalid_image',
				message: 'Portrait could not be decoded as an image',
				stage: 'decode',
				httpStatus: 200,
				contentType: 'text/html',
				format: null,
				width: null,
				height: null,
				finalLocation: 'https://example.com/leadership'
			});
		const { client } = await connectedServer();

		const result = await client.callTool({
			name: 'validate_portrait_candidates',
			arguments: {
				imageUrls: ['https://cdn.example.com/one.jpg', 'https://example.com/leadership']
			}
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			results: [
				{ index: 0, status: 'accepted' },
				{ index: 1, status: 'rejected', rejectionCode: 'portrait_invalid_image' }
			]
		});
	});

	it('publishes a batch with per-company failure isolation', async () => {
		const firstCompanyId = '6f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b';
		const secondCompanyId = '7f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b';
		services.publishExecutiveProfile
			.mockResolvedValueOnce({
				action: 'created',
				companyId: firstCompanyId,
				slateId: '8f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b',
				slateVersion: 1,
				cohortRevision: null,
				readinessStatus: 'ready',
				acceptedPortraitCount: 1,
				portraitDiagnostics: [],
				companyPath: `/admin/companies/${firstCompanyId}`
			})
			.mockRejectedValueOnce(
				new PortraitValidationError('portrait_download_failed', 'Portrait download failed', {
					stage: 'download',
					originalWidth: null,
					originalHeight: null,
					format: null,
					httpStatus: 403,
					contentType: 'text/html',
					finalLocation: 'https://cdn.example.com/two.jpg'
				})
			);
		const { client } = await connectedServer();

		const result = await client.callTool({
			name: 'publish_executive_profiles',
			arguments: {
				items: [
					{ companyId: firstCompanyId, profile: validProfile() },
					{ companyId: secondCompanyId, profile: validProfile() }
				]
			}
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			results: [
				{ index: 0, status: 'published', companyId: firstCompanyId },
				{
					index: 1,
					status: 'rejected',
					companyId: secondCompanyId,
					error: { code: 'portrait_download_failed' }
				}
			]
		});
	});

	it('publishes batch items sequentially', async () => {
		const companyIds = [
			'6f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b',
			'7f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b',
			'8f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b'
		];
		let active = 0;
		let maximumActive = 0;
		services.publishExecutiveProfile.mockImplementation(
			async (_apiKey: unknown, companyId: string) => {
				active += 1;
				maximumActive = Math.max(maximumActive, active);
				await new Promise<void>((resolve) => setImmediate(resolve));
				active -= 1;
				return {
					action: 'created' as const,
					companyId,
					slateId: '9f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b',
					slateVersion: 1,
					cohortRevision: null,
					readinessStatus: 'ready' as const,
					acceptedPortraitCount: 1,
					portraitDiagnostics: [],
					companyPath: `/admin/companies/${companyId}`
				};
			}
		);
		const { client } = await connectedServer();

		const result = await client.callTool({
			name: 'publish_executive_profiles',
			arguments: {
				items: companyIds.map((companyId) => ({ companyId, profile: validProfile() }))
			}
		});

		expect(result.isError).not.toBe(true);
		expect(maximumActive).toBe(1);
		expect(services.publishExecutiveProfile).toHaveBeenCalledTimes(3);
	});

	it('returns stable claim error codes from protected publication', async () => {
		services.publishExecutiveProfile.mockRejectedValue(
			new CompanyClaimError(
				'claim_required',
				'This company is actively claimed; provide its claim token to publish'
			)
		);
		const { client } = await connectedServer();

		const result = await client.callTool({
			name: 'publish_executive_profile',
			arguments: {
				companyId: '6f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b',
				profile: validProfile()
			}
		});

		expect(result.isError).toBe(true);
		expect(result.content).toEqual([
			{
				type: 'text',
				text: JSON.stringify({
					code: 'claim_required',
					message: 'This company is actively claimed; provide its claim token to publish'
				})
			}
		]);
	});

	it('advertises the two-portrait research target in company requirements', async () => {
		services.getCompanyProfile.mockResolvedValue({
			company: {
				companyId: '6f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b',
				issuerKey: 'cik:0000000001',
				cik: '0000000001',
				ticker: 'EX',
				name: 'Example Company',
				status: 'not_ready',
				claim: null
			},
			universeAsOf: '2026-07-26',
			currentProfile: null,
			currentProfileImportedAt: null,
			requirements: {
				schemaVersion: 4,
				summaryWords: { minimum: 50, maximum: 100 },
				sources: {
					minimumPerExecutive: 1,
					appliesTo: ['role', 'summary', 'facts'],
					portraitProvenanceRequired: false
				},
				factsRequired: false,
				portraits: {
					minimum: 0,
					targetMinimum: 3,
					maximum: 3,
					requiredForReady: true,
					mustBeRealHttpsImages: true,
					singleAllowedAfterReasonableSearch: true,
					venues: [
						'official sites',
						'SEC exhibits',
						'press releases',
						'conference and speaker biographies',
						'reputable news',
						'professional biographies'
					]
				},
				multipleLeaders: 'Include every current person when the top role is genuinely shared.'
			}
		});
		const { client } = await connectedServer();

		const result = await client.callTool({
			name: 'get_company_profile',
			arguments: { companyId: '6f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b' }
		});

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			requirements: {
				portraits: {
					targetMinimum: 3,
					singleAllowedAfterReasonableSearch: true
				}
			}
		});
	});

	it('returns claimed research tasks and forwards bearer tokens on publication', async () => {
		const companyId = '6f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b';
		const claimToken = `eac_${'a'.repeat(43)}`;
		services.claimCompanies.mockResolvedValue({
			claims: [
				{
					companyId,
					claimToken,
					claimedAt: '2026-07-26T12:00:00.000Z',
					expiresAt: '2026-07-26T12:45:00.000Z',
					task: companyTask(companyId, '2026-07-26T12:45:00.000Z')
				}
			]
		});
		services.publishExecutiveProfile.mockResolvedValue({
			action: 'created',
			companyId,
			slateId: '7f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b',
			slateVersion: 1,
			cohortRevision: null,
			readinessStatus: 'ready',
			acceptedPortraitCount: 1,
			portraitDiagnostics: [],
			companyPath: `/admin/companies/${companyId}`
		});
		const { client } = await connectedServer();

		const claimed = await client.callTool({
			name: 'claim_companies',
			arguments: { limit: 1 }
		});
		expect(claimed.isError).not.toBe(true);
		expect(claimed.structuredContent).toMatchObject({
			claims: [{ companyId, claimToken }]
		});

		await client.callTool({
			name: 'publish_executive_profile',
			arguments: { companyId, claimToken, profile: validProfile() }
		});
		expect(services.publishExecutiveProfile).toHaveBeenCalledWith(
			apiKey,
			companyId,
			expect.any(Object),
			expect.any(Date),
			claimToken
		);
	});

	it('serves an independent stateless Streamable HTTP tool-list request', async () => {
		const server = createExecutiveArenaMcpServer(apiKey);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true
		});
		await server.connect(transport);
		const response = await transport.handleRequest(
			new Request('https://executives.example.com/mcp', {
				method: 'POST',
				headers: {
					accept: 'application/json, text/event-stream',
					'content-type': 'application/json',
					'mcp-protocol-version': '2025-06-18'
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 7,
					method: 'tools/list',
					params: {}
				})
			})
		);
		await server.close();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			jsonrpc: '2.0',
			id: 7,
			result: {
				tools: expect.arrayContaining([
					expect.objectContaining({ name: 'publish_executive_profile' })
				])
			}
		});
	});
});

async function connectedServer() {
	const server = createExecutiveArenaMcpServer(apiKey);
	const client = new Client({ name: 'executive-arena-test', version: '1.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	closeCurrent = async () => {
		await client.close();
		await server.close();
	};
	return { client, server };
}

function validProfile() {
	const source = {
		url: 'https://example.com/leadership',
		title: 'Leadership',
		publisher: 'Example Company'
	};
	return {
		schema_version: 4 as const,
		issuer_key: 'cik:0000000001',
		canonical_ticker: 'EX',
		company_name: 'Example Company',
		leadership_as_of: '2026-07-26',
		leaders: [
			{
				name: 'Ada Example',
				title: 'Chief Executive Officer',
				role_kind: 'ceo' as const,
				is_interim: false,
				summary: Array.from({ length: 80 }, (_, index) => `word${index + 1}`).join(' '),
				sources: [source],
				portraits: [
					{
						image_url: 'https://example.com/ada.jpg',
						alt_text: 'Portrait of Ada Example',
						is_real_person: true as const,
						source
					}
				],
				facts: [
					{
						category: 'career' as const,
						value: 'Led Example Company.'
					}
				]
			}
		]
	};
}

function companyTask(companyId: string, claimExpiresAt: string | null) {
	return {
		company: {
			companyId,
			issuerKey: 'cik:0000000001',
			cik: '0000000001',
			ticker: 'EX',
			name: 'Example Company',
			status: 'not_ready' as const,
			claim: claimExpiresAt ? { expiresAt: claimExpiresAt } : null
		},
		universeAsOf: '2026-07-26',
		currentProfile: null,
		currentProfileImportedAt: null,
		requirements: {
			schemaVersion: 4 as const,
			summaryWords: { minimum: 50 as const, maximum: 100 as const },
			sources: {
				minimumPerExecutive: 1 as const,
				appliesTo: ['role', 'summary', 'facts'] as const,
				portraitProvenanceRequired: false as const
			},
			factsRequired: false as const,
			portraits: {
				minimum: 0 as const,
				targetMinimum: 3 as const,
				maximum: 3 as const,
				requiredForReady: true as const,
				mustBeRealHttpsImages: true as const,
				singleAllowedAfterReasonableSearch: true as const,
				venues: [
					'official sites',
					'SEC exhibits',
					'press releases',
					'conference and speaker biographies',
					'reputable news',
					'professional biographies'
				] as const
			},
			multipleLeaders: 'Include every current person when the top role is genuinely shared.'
		}
	};
}
