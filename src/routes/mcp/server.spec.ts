import { describe, expect, it, vi } from 'vitest';

const authenticateMcpApiKey = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/auth/settings', () => ({
	getAuthSettings: () => ({ origin: new URL('https://executives.example.com') })
}));
vi.mock('$lib/server/mcp/api-keys', () => ({ authenticateMcpApiKey }));
vi.mock('$lib/server/mcp/server', () => ({
	createExecutiveArenaMcpServer: vi.fn()
}));

import {
	_closeServerAfterStream,
	DELETE,
	GET,
	_MAX_MCP_REQUEST_BYTES,
	_readLimitedJsonBody,
	POST
} from './+server';

describe('hosted MCP HTTP boundary', () => {
	it('returns a bearer challenge instead of redirecting unauthenticated callers', async () => {
		authenticateMcpApiKey.mockResolvedValue(null);
		const response = await POST(
			eventFor(
				new Request('https://executives.example.com/mcp', {
					method: 'POST',
					headers: { host: 'executives.example.com' },
					body: '{}'
				})
			)
		);

		expect(response.status).toBe(401);
		expect(response.headers.get('location')).toBeNull();
		expect(response.headers.get('www-authenticate')).toBe('Bearer realm="executive-arena-mcp"');
		await expect(response.json()).resolves.toMatchObject({
			error: { code: -32_001, message: 'Unauthorized' }
		});
	});

	it.each([
		['GET', GET],
		['DELETE', DELETE]
	])('authenticates and rejects unsupported %s requests', async (method, handler) => {
		authenticateMcpApiKey.mockResolvedValue({
			id: '6f0cb0c0-5ca9-41fb-b54f-f0c1e7383f7b'
		});
		const response = await handler(
			eventFor(
				new Request('https://executives.example.com/mcp', {
					method,
					headers: {
						host: 'executives.example.com',
						authorization: 'Bearer token'
					}
				})
			)
		);

		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('POST');
	});

	it('rejects an unexpected host before checking credentials', async () => {
		authenticateMcpApiKey.mockClear();
		const response = await POST(
			eventFor(
				new Request('https://attacker.example/mcp', {
					method: 'POST',
					headers: { host: 'attacker.example' },
					body: '{}'
				})
			)
		);

		expect(response.status).toBe(403);
		expect(authenticateMcpApiKey).not.toHaveBeenCalled();
	});

	it('parses bounded JSON and rejects declared or streamed oversized bodies', async () => {
		await expect(
			_readLimitedJsonBody(
				new Request('https://executives.example.com/mcp', {
					method: 'POST',
					body: '{"ok":true}'
				}),
				20
			)
		).resolves.toEqual({ ok: true });

		await expect(
			_readLimitedJsonBody(
				new Request('https://executives.example.com/mcp', {
					method: 'POST',
					headers: { 'content-length': String(_MAX_MCP_REQUEST_BYTES + 1) },
					body: '{}'
				}),
				_MAX_MCP_REQUEST_BYTES
			)
		).rejects.toThrow();

		await expect(
			_readLimitedJsonBody(
				new Request('https://executives.example.com/mcp', {
					method: 'POST',
					body: '123456'
				}),
				5
			)
		).rejects.toThrow();
	});

	it('keeps an SSE request alive until its response stream closes', async () => {
		const close = vi.fn(async () => undefined);
		const response = _closeServerAfterStream(
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('event: message\ndata: {}\n\n'));
						controller.close();
					}
				}),
				{ headers: { 'content-type': 'text/event-stream' } }
			),
			close
		);

		await expect(response.text()).resolves.toContain('event: message');
		expect(close).toHaveBeenCalledOnce();
	});
});

function eventFor(request: Request) {
	return { request } as Parameters<typeof POST>[0];
}
