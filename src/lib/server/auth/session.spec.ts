import { createHash } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const database = vi.hoisted(() => ({
	transaction: vi.fn(),
	select: vi.fn(),
	delete: vi.fn(),
	update: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ db: database }));
vi.mock('./settings', () => ({
	getAuthSettings: () => ({ origin: new URL('https://executives.example.com') })
}));

import {
	createSession,
	destroySession,
	readSession,
	SESSION_COOKIE_NAME,
	touchSession,
	type AuthenticatedSession
} from './session';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from './session-policy';

const START = new Date('2026-07-20T08:00:00.000Z');

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('base64url');
}

function testCookies(initialToken?: string) {
	let token = initialToken;
	const get = vi.fn((name: string) => (name === SESSION_COOKIE_NAME ? token : undefined));
	const set = vi.fn((name: string, value: string, options?: Record<string, unknown>) => {
		void options;
		if (name === SESSION_COOKIE_NAME) token = value;
	});
	const remove = vi.fn((name: string) => {
		if (name === SESSION_COOKIE_NAME) token = undefined;
	});

	return {
		cookies: { get, set, delete: remove } as unknown as Cookies,
		get,
		set,
		remove
	};
}

function session(overrides: Partial<AuthenticatedSession> = {}): AuthenticatedSession {
	return {
		tokenHash: 'stored-token-hash',
		idToken: 'server-only-id-token',
		createdAt: START,
		lastActiveAt: START,
		expiresAt: new Date(START.getTime() + SESSION_ABSOLUTE_MS),
		...overrides
	};
}

describe('opaque server-side application sessions', () => {
	beforeEach(() => {
		database.transaction.mockReset();
		database.select.mockReset();
		database.delete.mockReset();
		database.update.mockReset();
	});

	test('stores only a hash of the random browser token and keeps the ID token server-side', async () => {
		const { cookies, set } = testCookies();
		let inserted: AuthenticatedSession | undefined;
		const returning = vi.fn(async () => [inserted!]);
		const values = vi.fn((value: AuthenticatedSession) => {
			inserted = value;
			return { returning };
		});
		const transaction = {
			delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
			insert: vi.fn(() => ({ values }))
		};
		database.transaction.mockImplementation(
			async (callback: (value: typeof transaction) => Promise<AuthenticatedSession[]>) =>
				callback(transaction)
		);

		const created = await createSession(cookies, 'signed-provider-id-token', START);
		const [, browserToken, options] = set.mock.calls[0];

		expect(browserToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(inserted?.tokenHash).toBe(sha256(browserToken));
		expect(inserted?.tokenHash).not.toBe(browserToken);
		expect(inserted?.idToken).toBe('signed-provider-id-token');
		expect(browserToken).not.toContain('signed-provider-id-token');
		expect(created).toBe(inserted);
		expect(options).toEqual({
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			expires: new Date(START.getTime() + SESSION_IDLE_MS)
		});
	});

	test('returns a valid stored session without sliding its activity time', async () => {
		const { cookies, set, remove } = testCookies('raw-browser-token');
		const stored = session();
		const limit = vi.fn().mockResolvedValue([stored]);
		const where = vi.fn(() => ({ limit }));
		const from = vi.fn(() => ({ where }));
		database.select.mockReturnValue({ from });

		await expect(
			readSession(cookies, new Date(START.getTime() + SESSION_IDLE_MS - 1))
		).resolves.toBe(stored);

		expect(set).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
		expect(database.update).not.toHaveBeenCalled();
	});

	test('deletes an idle-expired session and clears its browser cookie', async () => {
		const { cookies, remove } = testCookies('raw-browser-token');
		const stored = session();
		const limit = vi.fn().mockResolvedValue([stored]);
		database.select.mockReturnValue({
			from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) }))
		});
		const deleteWhere = vi.fn().mockResolvedValue(undefined);
		database.delete.mockReturnValue({ where: deleteWhere });

		await expect(
			readSession(cookies, new Date(START.getTime() + SESSION_IDLE_MS))
		).resolves.toBeNull();

		expect(database.delete).toHaveBeenCalledOnce();
		expect(deleteWhere).toHaveBeenCalledOnce();
		expect(remove).toHaveBeenCalledWith(SESSION_COOKIE_NAME, { path: '/' });
	});

	test('clears a cookie whose server-side session does not exist', async () => {
		const { cookies, remove } = testCookies('orphaned-browser-token');
		const limit = vi.fn().mockResolvedValue([]);
		database.select.mockReturnValue({
			from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) }))
		});

		await expect(readSession(cookies, START)).resolves.toBeNull();

		expect(database.delete).not.toHaveBeenCalled();
		expect(remove).toHaveBeenCalledWith(SESSION_COOKIE_NAME, { path: '/' });
	});

	test('touches a live session and renews only the idle cookie expiry', async () => {
		const { cookies, set, remove } = testCookies('raw-browser-token');
		const activeAt = new Date(START.getTime() + 60_000);
		const updated = session({ lastActiveAt: activeAt });
		const returning = vi.fn().mockResolvedValue([updated]);
		const where = vi.fn(() => ({ returning }));
		const updateSet = vi.fn(() => ({ where }));
		database.update.mockReturnValue({ set: updateSet });

		await expect(touchSession(cookies, session(), activeAt)).resolves.toBe(updated);

		expect(updateSet).toHaveBeenCalledWith({ lastActiveAt: activeAt });
		expect(set).toHaveBeenCalledWith(SESSION_COOKIE_NAME, 'raw-browser-token', {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			expires: new Date(activeAt.getTime() + SESSION_IDLE_MS)
		});
		expect(remove).not.toHaveBeenCalled();
	});

	test('does not revive a session rejected by the atomic expiry guards', async () => {
		const { cookies, set, remove } = testCookies('raw-browser-token');
		const returning = vi.fn().mockResolvedValue([]);
		database.update.mockReturnValue({
			set: vi.fn(() => ({ where: vi.fn(() => ({ returning })) }))
		});

		await expect(
			touchSession(cookies, session(), new Date(START.getTime() + SESSION_IDLE_MS))
		).resolves.toBeNull();

		expect(set).not.toHaveBeenCalled();
		expect(remove).toHaveBeenCalledWith(SESSION_COOKIE_NAME, { path: '/' });
	});

	test('deletes the server record before returning the ID token for provider logout', async () => {
		const { cookies, remove } = testCookies('raw-browser-token');
		const returning = vi.fn().mockResolvedValue([{ idToken: 'server-only-id-token' }]);
		const where = vi.fn(() => ({ returning }));
		database.delete.mockReturnValue({ where });

		await expect(destroySession(cookies)).resolves.toBe('server-only-id-token');

		expect(database.delete).toHaveBeenCalledOnce();
		expect(where).toHaveBeenCalledOnce();
		expect(remove).toHaveBeenCalledWith(SESSION_COOKIE_NAME, { path: '/' });
	});

	test('does not query storage when logout has no session cookie', async () => {
		const { cookies, remove } = testCookies();

		await expect(destroySession(cookies)).resolves.toBeNull();

		expect(database.delete).not.toHaveBeenCalled();
		expect(remove).toHaveBeenCalledWith(SESSION_COOKIE_NAME, { path: '/' });
	});
});
