import { error } from '@sveltejs/kit';
import { getCompanyCard, getCompanyListings } from '#lib/server/arena/read-model.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const [card, listings] = await Promise.all([
		getCompanyCard(params.id),
		getCompanyListings(params.id)
	]);
	if (!card) error(404, 'Company profile not found');
	return { card, listings };
};
