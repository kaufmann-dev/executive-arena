import { building } from '$app/environment';
import { redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { decideRouteAccess } from '$lib/server/auth/access-policy';
import { readSession } from '$lib/server/auth/session';
import { initializeCohortState, scheduleActiveRankingRefresh } from '$lib/server/arena/service';
import { runMigrations } from '$lib/server/db/migrate';

export const init: ServerInit = async () => {
	if (building) return;
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
	await runMigrations();
	await initializeCohortState();
	scheduleActiveRankingRefresh();
};

const handleSecurityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	if (!event.url.pathname.startsWith('/media/portraits/')) {
		response.headers.set('cache-control', 'no-store');
	}
	response.headers.set(
		'content-security-policy',
		[
			"default-src 'self'",
			"base-uri 'self'",
			"connect-src 'self'",
			"form-action 'self'",
			"frame-ancestors 'none'",
			"img-src 'self'",
			"object-src 'none'",
			"script-src 'self'",
			"style-src 'self' 'unsafe-inline'"
		].join('; ')
	);
	response.headers.set('permissions-policy', 'camera=(), geolocation=(), microphone=()');
	response.headers.set('referrer-policy', 'same-origin');
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('x-frame-options', 'DENY');
	return response;
};

const handleSession: Handle = async ({ event, resolve }) => {
	event.locals.session = await readSession(event.cookies);
	return resolve(event);
};

const handleGuard: Handle = ({ event, resolve }) => {
	const decision = decideRouteAccess(event.url.pathname, Boolean(event.locals.session));
	if (decision.action === 'unauthorized') {
		return new Response(null, { status: 401, headers: { 'cache-control': 'no-store' } });
	}
	if (decision.action === 'redirect') redirect(303, decision.location);
	return resolve(event);
};

export const handle: Handle = sequence(handleSecurityHeaders, handleSession, handleGuard);
