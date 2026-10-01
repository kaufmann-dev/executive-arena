import { error, redirect } from '@sveltejs/kit';
import { buildLogoutUrl } from '#lib/server/auth/oidc.js';
import { destroySession } from '#lib/server/auth/session.js';
import { getAuthSettings } from '#lib/server/auth/settings.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, locals, request }) => {
	if (request.headers.get('origin') !== getAuthSettings().origin.origin) {
		error(403, 'Invalid logout origin');
	}
	if (!locals.session) redirect(303, '/auth/login');

	const { idToken } = locals.session;
	await destroySession(cookies);
	const logoutUrl = await buildLogoutUrl(idToken);
	redirect(303, logoutUrl.href, { external: true });
};
