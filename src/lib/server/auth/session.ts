import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { appSession } from '#lib/server/db/schema.js';
import { getAuthSettings } from './settings';
import {
	effectiveExpiresAt,
	isSessionExpired,
	newSessionTimes,
	SESSION_IDLE_MS,
	type SessionTimes
} from './session-policy';

export const SESSION_COOKIE_NAME = 'executive_arena_session';

export type AuthenticatedSession = typeof appSession.$inferSelect;

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('base64url');
}

function cookieOptions(expires: Date) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: getAuthSettings().origin.protocol === 'https:',
		expires
	};
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
}

export async function createSession(
	cookies: Cookies,
	idToken: string,
	now = new Date()
): Promise<AuthenticatedSession> {
	const token = randomBytes(32).toString('base64url');
	const times = newSessionTimes(now);
	const [session] = await db.transaction(async (transaction) => {
		await transaction.delete(appSession).where(lt(appSession.expiresAt, now));
		return transaction
			.insert(appSession)
			.values({ tokenHash: hashToken(token), idToken, ...times })
			.returning();
	});

	cookies.set(SESSION_COOKIE_NAME, token, cookieOptions(effectiveExpiresAt(session)));
	return session;
}

export async function readSession(
	cookies: Cookies,
	now = new Date()
): Promise<AuthenticatedSession | null> {
	const token = cookies.get(SESSION_COOKIE_NAME);
	if (!token) return null;

	const [session] = await db
		.select()
		.from(appSession)
		.where(eq(appSession.tokenHash, hashToken(token)))
		.limit(1);
	if (!session) {
		clearSessionCookie(cookies);
		return null;
	}
	if (isSessionExpired(session, now)) {
		await db.delete(appSession).where(eq(appSession.tokenHash, session.tokenHash));
		clearSessionCookie(cookies);
		return null;
	}
	return session;
}

export async function touchSession(
	cookies: Cookies,
	session: AuthenticatedSession,
	now = new Date()
): Promise<AuthenticatedSession | null> {
	const idleCutoff = new Date(now.getTime() - SESSION_IDLE_MS);
	const [updated] = await db
		.update(appSession)
		.set({ lastActiveAt: now })
		.where(
			and(
				eq(appSession.tokenHash, session.tokenHash),
				gt(appSession.expiresAt, now),
				gt(appSession.lastActiveAt, idleCutoff)
			)
		)
		.returning();
	if (!updated) {
		clearSessionCookie(cookies);
		return null;
	}

	const token = cookies.get(SESSION_COOKIE_NAME);
	if (!token) {
		await db.delete(appSession).where(eq(appSession.tokenHash, session.tokenHash));
		clearSessionCookie(cookies);
		return null;
	}

	cookies.set(
		SESSION_COOKIE_NAME,
		token,
		cookieOptions(effectiveExpiresAt(updated as SessionTimes))
	);
	return updated;
}

export async function destroySession(cookies: Cookies): Promise<string | null> {
	const token = cookies.get(SESSION_COOKIE_NAME);
	clearSessionCookie(cookies);
	if (!token) return null;

	const [deleted] = await db
		.delete(appSession)
		.where(eq(appSession.tokenHash, hashToken(token)))
		.returning({ idToken: appSession.idToken });
	return deleted?.idToken ?? null;
}
