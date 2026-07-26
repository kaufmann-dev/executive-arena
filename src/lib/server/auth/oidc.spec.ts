import { createHash } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));

import { completeAuthorization, FLOW_COOKIE_NAME } from './oidc';

const NOW = new Date('2026-07-20T12:00:00.000Z');
const STATE = 'provider-state';
const BROWSER_TOKEN = 'browser-flow-token';

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('base64url');
}

function testCookies(flowToken?: string) {
	const get = vi.fn(() => flowToken);
	const remove = vi.fn();
	return {
		cookies: { get, delete: remove } as unknown as Cookies,
		get,
		remove
	};
}

describe('OIDC browser-bound authorization transactions', () => {
	test('rejects a callback without state before looking up a transaction', async () => {
		const { cookies, get, remove } = testCookies(BROWSER_TOKEN);
		const consume = vi.fn();
		const exchange = vi.fn();

		await expect(
			completeAuthorization(
				new URL('https://executives.example.com/auth/callback?code=code'),
				cookies,
				NOW,
				consume,
				exchange
			)
		).rejects.toThrow('OIDC authorization response is missing state');

		expect(get).not.toHaveBeenCalled();
		expect(consume).not.toHaveBeenCalled();
		expect(exchange).not.toHaveBeenCalled();
		expect(remove).toHaveBeenCalledWith(FLOW_COOKIE_NAME, { path: '/auth' });
	});

	test('rejects a relayed state when the browser has no flow cookie', async () => {
		const { cookies, remove } = testCookies();
		const consume = vi.fn();
		const exchange = vi.fn();

		await expect(
			completeAuthorization(
				new URL(`https://executives.example.com/auth/callback?code=relayed&state=${STATE}`),
				cookies,
				NOW,
				consume,
				exchange
			)
		).rejects.toThrow('OIDC authorization transaction is invalid or expired');

		expect(consume).not.toHaveBeenCalled();
		expect(exchange).not.toHaveBeenCalled();
		expect(remove).toHaveBeenCalledWith(FLOW_COOKIE_NAME, { path: '/auth' });
	});

	test('binds the state lookup to hashes of both state and browser flow token', async () => {
		const { cookies, remove } = testCookies(BROWSER_TOKEN);
		const consume = vi.fn().mockResolvedValue(undefined);
		const exchange = vi.fn();

		await expect(
			completeAuthorization(
				new URL(`https://executives.example.com/auth/callback?code=relayed&state=${STATE}`),
				cookies,
				NOW,
				consume,
				exchange
			)
		).rejects.toThrow('OIDC authorization transaction is invalid or expired');

		expect(consume).toHaveBeenCalledWith(sha256(STATE), sha256(BROWSER_TOKEN), NOW);
		expect(exchange).not.toHaveBeenCalled();
		expect(remove).toHaveBeenCalledWith(FLOW_COOKIE_NAME, { path: '/auth' });
	});

	test('exchanges a valid one-time transaction using its verifier, nonce, and exact state', async () => {
		const { cookies, remove } = testCookies(BROWSER_TOKEN);
		const transaction = { codeVerifier: 'pkce-verifier', nonce: 'oidc-nonce' };
		const consume = vi.fn().mockResolvedValue(transaction);
		const exchange = vi.fn().mockResolvedValue('signed-id-token');
		const callbackUrl = new URL(
			`https://executives.example.com/auth/callback?code=valid&state=${STATE}`
		);

		await expect(completeAuthorization(callbackUrl, cookies, NOW, consume, exchange)).resolves.toBe(
			'signed-id-token'
		);

		expect(consume).toHaveBeenCalledOnce();
		expect(exchange).toHaveBeenCalledWith(callbackUrl, transaction, STATE);
		expect(remove).toHaveBeenCalledWith(FLOW_COOKIE_NAME, { path: '/auth' });
	});

	test('clears the browser flow cookie when transaction consumption fails', async () => {
		const { cookies, remove } = testCookies(BROWSER_TOKEN);
		const consume = vi.fn().mockRejectedValue(new Error('database unavailable'));
		const exchange = vi.fn();

		await expect(
			completeAuthorization(
				new URL(`https://executives.example.com/auth/callback?code=valid&state=${STATE}`),
				cookies,
				NOW,
				consume,
				exchange
			)
		).rejects.toThrow('database unavailable');

		expect(exchange).not.toHaveBeenCalled();
		expect(remove).toHaveBeenCalledWith(FLOW_COOKIE_NAME, { path: '/auth' });
	});

	test('clears the browser flow cookie when the code exchange fails', async () => {
		const { cookies, remove } = testCookies(BROWSER_TOKEN);
		const consume = vi
			.fn()
			.mockResolvedValue({ codeVerifier: 'pkce-verifier', nonce: 'oidc-nonce' });
		const exchange = vi.fn().mockRejectedValue(new Error('provider rejected code'));

		await expect(
			completeAuthorization(
				new URL(`https://executives.example.com/auth/callback?code=invalid&state=${STATE}`),
				cookies,
				NOW,
				consume,
				exchange
			)
		).rejects.toThrow('provider rejected code');

		expect(remove).toHaveBeenCalledWith(FLOW_COOKIE_NAME, { path: '/auth' });
	});
});
