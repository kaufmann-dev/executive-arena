import { error } from '@sveltejs/kit';
import { touchSession } from '#lib/server/auth/session.js';
import { isTrustedActivityRequest } from '#lib/server/auth/session-policy.js';
import { getAuthSettings } from '#lib/server/auth/settings.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, locals, request, url }) => {
	if (!isTrustedActivityRequest(request, url, getAuthSettings().origin.origin)) {
		error(403, 'Invalid activity signal');
	}
	if (!locals.session) error(401, 'Authentication required');

	locals.session = await touchSession(cookies, locals.session);
	if (!locals.session) error(401, 'Authentication required');
	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};
