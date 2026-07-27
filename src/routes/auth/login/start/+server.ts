import { redirect } from '@sveltejs/kit';
import { beginAuthorization } from '$lib/server/auth/oidc';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const authorizationUrl = await beginAuthorization(cookies);
	redirect(303, authorizationUrl.href);
};
