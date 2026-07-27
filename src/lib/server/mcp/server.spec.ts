import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
	getCohortStatus: vi.fn(),
	listCompanies: vi.fn(),
	getCompanyProfile: vi.fn(),
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
});

describe('Executive Arena MCP server', () => {
	it('advertises the complete research workflow and six annotated tools', async () => {
		const { client } = await connectedServer();
		const listed = await client.listTools();

		expect(client.getInstructions()).toContain('updates the live website immediately');
		expect(listed.tools.map((tool) => tool.name)).toEqual([
			'sync_massive_universe',
			'get_cohort_status',
			'list_companies',
			'get_company_profile',
			'publish_executive_profile',
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
	});

	it('returns both text and structured content for a successful read tool', async () => {
		services.getCohortStatus.mockResolvedValue({
			included: 100,
			ready: 20,
			notReady: 80,
			excluded: 5,
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
			notReady: 80,
			excluded: 5,
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
