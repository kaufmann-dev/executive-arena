import { error } from '@sveltejs/kit';
import { getPortrait } from '#lib/server/arena/read-model.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
	const record = await getPortrait(params.id);
	if (!record) error(404, 'Portrait not found');

	const etag = `"${record.sha256}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, {
			status: 304,
			headers: { etag, 'cache-control': 'private, max-age=86400' }
		});
	}

	return new Response(Uint8Array.from(record.image), {
		headers: {
			'content-type': record.contentType,
			'content-length': String(record.byteLength),
			'cache-control': 'private, max-age=86400',
			etag,
			'x-content-type-options': 'nosniff'
		}
	});
};
