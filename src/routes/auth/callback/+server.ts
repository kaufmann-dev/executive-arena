import { error, redirect } from '@sveltejs/kit';
import { completeAuthorization } from '#lib/server/auth/oidc.js';
import { createSession, destroySession } from '#lib/server/auth/session.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, locals, url }) => {
	let idToken: string;
	try {
		idToken = await completeAuthorization(url, cookies);
	} catch {
		error(400, 'OIDC authentication failed. Start a new sign-in attempt.');
	}

	if (locals.session) await destroySession(cookies);
	await createSession(cookies, idToken);
	redirect(303, '/');
};
