import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { RequestHandler } from './$types';
import { getAuthSettings } from '$lib/server/auth/settings';
import { authenticateMcpApiKey } from '$lib/server/mcp/api-keys';
import { createExecutiveArenaMcpServer } from '$lib/server/mcp/server';

export const _MAX_MCP_REQUEST_BYTES = 2_000_000;

export const POST: RequestHandler = async ({ request }) => {
	const rejected = validateRequestOrigin(request);
	if (rejected) return rejected;
	const apiKey = await authenticateMcpApiKey(request.headers.get('authorization'));
	if (!apiKey) return unauthorized();

	let parsedBody: unknown;
	try {
		parsedBody = await _readLimitedJsonBody(request, _MAX_MCP_REQUEST_BYTES);
	} catch (cause) {
		if (cause instanceof RequestTooLargeError) {
			return jsonRpcError(413, -32_000, 'MCP request exceeds the 2 MB limit');
		}
		return jsonRpcError(400, -32_700, 'MCP request body must be valid JSON');
	}

	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	const server = createExecutiveArenaMcpServer(apiKey);
	await server.connect(transport);
	try {
		return await transport.handleRequest(request, { parsedBody });
	} finally {
		await server.close();
	}
};

export const GET: RequestHandler = authenticatedMethodNotAllowed;
export const DELETE: RequestHandler = authenticatedMethodNotAllowed;

async function authenticatedMethodNotAllowed({ request }: Parameters<RequestHandler>[0]) {
	const rejected = validateRequestOrigin(request);
	if (rejected) return rejected;
	const apiKey = await authenticateMcpApiKey(request.headers.get('authorization'));
	if (!apiKey) return unauthorized();
	return jsonRpcError(405, -32_000, 'Method not allowed', { allow: 'POST' });
}

export async function _readLimitedJsonBody(request: Request, limit: number): Promise<unknown> {
	const declaredLength = request.headers.get('content-length');
	if (
		declaredLength !== null &&
		(!/^\d+$/.test(declaredLength) || Number(declaredLength) > limit)
	) {
		throw new RequestTooLargeError();
	}
	if (!request.body) throw new SyntaxError('Missing request body');

	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	const reader = request.body.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			byteLength += value.byteLength;
			if (byteLength > limit) {
				await reader.cancel();
				throw new RequestTooLargeError();
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder().decode(body)) as unknown;
}

function validateRequestOrigin(request: Request): Response | null {
	const expected = getAuthSettings().origin;
	const host = request.headers.get('host') ?? new URL(request.url).host;
	if (host !== expected.host) return jsonRpcError(403, -32_003, 'Forbidden host');
	const origin = request.headers.get('origin');
	if (origin && origin !== expected.origin) return jsonRpcError(403, -32_003, 'Forbidden origin');
	return null;
}

function unauthorized(): Response {
	return jsonRpcError(401, -32_001, 'Unauthorized', {
		'www-authenticate': 'Bearer realm="executive-arena-mcp"'
	});
}

function jsonRpcError(
	status: number,
	code: number,
	message: string,
	headers: Record<string, string> = {}
): Response {
	return Response.json(
		{ jsonrpc: '2.0', error: { code, message }, id: null },
		{ status, headers: { 'cache-control': 'no-store', ...headers } }
	);
}

class RequestTooLargeError extends Error {}
