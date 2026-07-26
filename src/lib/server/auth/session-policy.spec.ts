import { describe, expect, test } from 'vitest';
import {
	effectiveExpiresAt,
	isSessionExpired,
	isTrustedActivityRequest,
	newSessionTimes,
	SESSION_ABSOLUTE_MS,
	SESSION_IDLE_MS,
	USER_ACTIVITY_HEADER,
	USER_ACTIVITY_HEADER_VALUE,
	touchedSessionTimes
} from './session-policy';

const START = new Date('2026-07-20T08:00:00.000Z');
const ORIGIN = 'https://executives.example.com';

describe('application session expiry policy', () => {
	test('expires after 24 hours without authenticated user activity', () => {
		const session = newSessionTimes(START);

		expect(isSessionExpired(session, new Date(START.getTime() + SESSION_IDLE_MS - 1))).toBe(false);
		expect(isSessionExpired(session, new Date(START.getTime() + SESSION_IDLE_MS))).toBe(true);
	});

	test('enforces a fixed seven-day absolute lifetime', () => {
		const session = {
			...newSessionTimes(START),
			lastActiveAt: new Date(START.getTime() + SESSION_ABSOLUTE_MS - 1)
		};

		expect(effectiveExpiresAt(session)).toEqual(new Date(START.getTime() + SESSION_ABSOLUTE_MS));
		expect(isSessionExpired(session, new Date(START.getTime() + SESSION_ABSOLUTE_MS))).toBe(true);
	});

	test('slides idle expiry without extending the absolute lifetime', () => {
		const session = newSessionTimes(START);
		const activeAt = new Date(START.getTime() + SESSION_IDLE_MS - 1);
		const touched = touchedSessionTimes(session, activeAt);

		expect(touched).not.toBeNull();
		expect(effectiveExpiresAt(touched!)).toEqual(new Date(activeAt.getTime() + SESSION_IDLE_MS));

		const nearAbsoluteExpiry = {
			...session,
			lastActiveAt: new Date(START.getTime() + SESSION_ABSOLUTE_MS - 60_000)
		};
		expect(effectiveExpiresAt(nearAbsoluteExpiry)).toEqual(session.expiresAt);
	});

	test('never revives an idle-expired or absolute-expired session', () => {
		const session = newSessionTimes(START);

		expect(touchedSessionTimes(session, new Date(START.getTime() + SESSION_IDLE_MS))).toBeNull();
		expect(
			touchedSessionTimes(
				{
					...session,
					lastActiveAt: new Date(START.getTime() + SESSION_ABSOLUTE_MS - 1)
				},
				new Date(START.getTime() + SESSION_ABSOLUTE_MS)
			)
		).toBeNull();
	});
});

describe('explicit authenticated user activity signal', () => {
	function activityRequest(headers: Record<string, string> = {}): Request {
		return new Request(`${ORIGIN}/auth/activity`, {
			method: 'POST',
			headers: {
				origin: ORIGIN,
				'sec-fetch-site': 'same-origin',
				[USER_ACTIVITY_HEADER]: USER_ACTIVITY_HEADER_VALUE,
				...headers
			}
		});
	}

	test('accepts the explicit same-origin activity POST', () => {
		const request = activityRequest();

		expect(isTrustedActivityRequest(request, new URL(request.url), ORIGIN)).toBe(true);
	});

	test('allows clients that omit Sec-Fetch-Site only when all explicit checks pass', () => {
		const request = new Request(`${ORIGIN}/auth/activity`, {
			method: 'POST',
			headers: {
				origin: ORIGIN,
				[USER_ACTIVITY_HEADER]: USER_ACTIVITY_HEADER_VALUE
			}
		});

		expect(isTrustedActivityRequest(request, new URL(request.url), ORIGIN)).toBe(true);
	});

	test('rejects passive requests and arbitrary authenticated mutations', () => {
		const requests = [
			new Request(`${ORIGIN}/`, { method: 'HEAD' }),
			new Request(`${ORIGIN}/api/search?q=bank`),
			new Request(`${ORIGIN}/leaderboard`, {
				headers: {
					accept: 'text/html',
					'sec-fetch-dest': 'document',
					'sec-fetch-mode': 'navigate'
				}
			}),
			new Request(`${ORIGIN}/compare`, {
				method: 'POST',
				headers: { origin: ORIGIN }
			})
		];

		for (const request of requests) {
			expect(isTrustedActivityRequest(request, new URL(request.url), ORIGIN)).toBe(false);
		}
	});

	test('rejects a wrong path, method, marker, origin, or fetch site', () => {
		const wrongPath = new Request(`${ORIGIN}/auth/activity/`, activityRequest());
		const wrongMethod = new Request(`${ORIGIN}/auth/activity`, {
			method: 'PUT',
			headers: activityRequest().headers
		});
		const wrongMarker = activityRequest({ [USER_ACTIVITY_HEADER]: 'false' });
		const wrongOrigin = activityRequest({ origin: 'https://attacker.example.com' });
		const wrongFetchSite = activityRequest({ 'sec-fetch-site': 'cross-site' });

		for (const request of [wrongPath, wrongMethod, wrongMarker, wrongOrigin, wrongFetchSite]) {
			expect(isTrustedActivityRequest(request, new URL(request.url), ORIGIN)).toBe(false);
		}
	});
});
