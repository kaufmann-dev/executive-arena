export type RouteAccessDecision =
	| { action: 'allow' }
	| { action: 'redirect'; location: '/auth/login' | '/' }
	| { action: 'unauthorized' };

const PUBLIC_ROUTES = new Set(['/auth/login', '/auth/callback', '/auth/logged-out']);
const MACHINE_AUTH_ROUTES = new Set(['/mcp']);

export function decideRouteAccess(pathname: string, hasSession: boolean): RouteAccessDecision {
	if (pathname === '/auth/activity' && !hasSession) return { action: 'unauthorized' };
	if (MACHINE_AUTH_ROUTES.has(pathname)) return { action: 'allow' };
	if (!PUBLIC_ROUTES.has(pathname) && !hasSession) {
		return { action: 'redirect', location: '/auth/login' };
	}
	if (pathname === '/auth/login' && hasSession) {
		return { action: 'redirect', location: '/' };
	}
	return { action: 'allow' };
}
