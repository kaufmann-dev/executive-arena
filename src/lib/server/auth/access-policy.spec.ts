import { describe, expect, test } from 'vitest';
import { decideRouteAccess } from './access-policy';

describe('global authentication route policy', () => {
	test.each(['/auth/login', '/auth/callback', '/auth/logged-out'])(
		'allows the exact public route %s without a session',
		(pathname) => {
			expect(decideRouteAccess(pathname, false)).toEqual({ action: 'allow' });
		}
	);

	test.each(['/', '/compare', '/leaderboard', '/admin/coverage', '/media/portraits/id'])(
		'redirects unauthenticated access to protected route %s',
		(pathname) => {
			expect(decideRouteAccess(pathname, false)).toEqual({
				action: 'redirect',
				location: '/auth/login'
			});
		}
	);

	test('returns an API-style unauthorized decision for the activity endpoint', () => {
		expect(decideRouteAccess('/auth/activity', false)).toEqual({ action: 'unauthorized' });
	});

	test('allows the exact MCP route to perform bearer authentication without an OIDC redirect', () => {
		expect(decideRouteAccess('/mcp', false)).toEqual({ action: 'allow' });
		expect(decideRouteAccess('/mcp/extra', false)).toEqual({
			action: 'redirect',
			location: '/auth/login'
		});
	});

	test('does not make public-route prefixes public', () => {
		expect(decideRouteAccess('/auth/login/extra', false)).toEqual({
			action: 'redirect',
			location: '/auth/login'
		});
		expect(decideRouteAccess('/auth/callback/extra', false)).toEqual({
			action: 'redirect',
			location: '/auth/login'
		});
	});

	test('redirects an authenticated login request to the application', () => {
		expect(decideRouteAccess('/auth/login', true)).toEqual({
			action: 'redirect',
			location: '/'
		});
	});

	test.each([
		'/',
		'/compare',
		'/leaderboard',
		'/admin/coverage',
		'/media/portraits/id',
		'/auth/activity',
		'/auth/logout',
		'/auth/callback',
		'/auth/logged-out',
		'/mcp'
	])('allows authenticated access to %s', (pathname) => {
		expect(decideRouteAccess(pathname, true)).toEqual({ action: 'allow' });
	});
});
