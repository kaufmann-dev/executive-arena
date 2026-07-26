import { error } from '@sveltejs/kit';
import { getAdminProfileDocument } from '$lib/server/arena/read-model';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const profile = await getAdminProfileDocument(params.id);
	if (!profile) error(404, 'Active company profile not found');
	return new Response(`${JSON.stringify(profile, null, 2)}\n`, {
		headers: {
			'cache-control': 'private, no-store',
			'content-disposition': 'attachment; filename="executive-profile.json"',
			'content-type': 'application/json; charset=utf-8',
			'x-content-type-options': 'nosniff'
		}
	});
};
