export type RouteAccessDecision =
	| { action: 'allow' }
	| { action: 'redirect'; location: '/auth/login' | '/' }
	| { action: 'unauthorized' };

const PUBLIC_ROUTES = new Set(['/auth/login', '/auth/callback', '/auth/logged-out']);

export function decideRouteAccess(pathname: string, hasSession: boolean): RouteAccessDecision {
	if (pathname === '/auth/activity' && !hasSession) return { action: 'unauthorized' };
	if (!PUBLIC_ROUTES.has(pathname) && !hasSession) {
		return { action: 'redirect', location: '/auth/login' };
	}
	if (pathname === '/auth/login' && hasSession) {
		return { action: 'redirect', location: '/' };
	}
	return { action: 'allow' };
}
