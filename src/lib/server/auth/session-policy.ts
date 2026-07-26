export const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
export const USER_ACTIVITY_PATH = '/auth/activity';
export const USER_ACTIVITY_HEADER = 'x-executive-arena-user-activity';
export const USER_ACTIVITY_HEADER_VALUE = 'true';

export interface SessionTimes {
	createdAt: Date;
	lastActiveAt: Date;
	expiresAt: Date;
}

export function idleExpiresAt(session: Pick<SessionTimes, 'lastActiveAt'>): Date {
	return new Date(session.lastActiveAt.getTime() + SESSION_IDLE_MS);
}

export function effectiveExpiresAt(session: SessionTimes): Date {
	const idleExpiry = idleExpiresAt(session);
	return idleExpiry < session.expiresAt ? idleExpiry : session.expiresAt;
}

export function isSessionExpired(session: SessionTimes, now: Date): boolean {
	return effectiveExpiresAt(session).getTime() <= now.getTime();
}

export function newSessionTimes(now: Date): SessionTimes {
	return {
		createdAt: now,
		lastActiveAt: now,
		expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS)
	};
}

export function touchedSessionTimes(session: SessionTimes, now: Date): SessionTimes | null {
	if (isSessionExpired(session, now)) return null;
	return { ...session, lastActiveAt: now };
}

export function isTrustedActivityRequest(
	request: Request,
	url: URL,
	expectedOrigin: string
): boolean {
	if (request.method !== 'POST' || url.pathname !== USER_ACTIVITY_PATH) return false;
	if (request.headers.get(USER_ACTIVITY_HEADER) !== USER_ACTIVITY_HEADER_VALUE) return false;
	if (request.headers.get('origin') !== expectedOrigin) return false;

	const fetchSite = request.headers.get('sec-fetch-site');
	return fetchSite === null || fetchSite === 'same-origin';
}
