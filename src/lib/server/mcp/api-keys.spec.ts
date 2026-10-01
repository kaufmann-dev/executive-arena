import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', () => ({ db: {} }));

import {
	generateMcpApiKeyToken,
	hashMcpApiKeyToken,
	mcpApiKeyHashesMatch,
	parseMcpApiKeyToken,
	readBearerToken
} from './api-keys';

describe('MCP API key tokens', () => {
	it('generates independently prefixed 256-bit bearer secrets', () => {
		const first = generateMcpApiKeyToken();
		const second = generateMcpApiKeyToken();

		expect(first.prefix).toMatch(/^[a-f0-9]{12}$/);
		expect(first.token).toMatch(/^ear_[a-f0-9]{12}_[A-Za-z0-9_-]{43}$/);
		expect(parseMcpApiKeyToken(first.token)).toEqual({ prefix: first.prefix });
		expect(second.token).not.toBe(first.token);
	});

	it('stores and compares only a fixed-length digest', () => {
		const { token } = generateMcpApiKeyToken();
		const digest = hashMcpApiKeyToken(token);

		expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(digest).not.toContain(token);
		expect(mcpApiKeyHashesMatch(digest, digest)).toBe(true);
		expect(mcpApiKeyHashesMatch(digest, hashMcpApiKeyToken(`${token}x`))).toBe(false);
		expect(mcpApiKeyHashesMatch('short', digest)).toBe(false);
	});

	it('accepts one exact bearer credential and rejects malformed values', () => {
		const { token } = generateMcpApiKeyToken();

		expect(readBearerToken(`Bearer ${token}`)).toBe(token);
		expect(readBearerToken(`bearer ${token}`)).toBeNull();
		expect(readBearerToken(`Bearer  ${token}`)).toBeNull();
		expect(readBearerToken(`Bearer ${token} extra`)).toBeNull();
		expect(parseMcpApiKeyToken('ear_bad')).toBeNull();
	});
});
