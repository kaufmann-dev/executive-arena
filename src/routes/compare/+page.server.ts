import { fail, redirect } from '@sveltejs/kit';
import { getOrCreatePair, recordChoice } from '$lib/server/arena/service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => getOrCreatePair();

export const actions: Actions = {
	default: async ({ request }) => {
		const data = await request.formData();
		const presentationId = String(data.get('presentationId') ?? '');
		const winnerSlateId = String(data.get('winnerSlateId') ?? '');
		try {
			await recordChoice(presentationId, winnerSlateId);
		} catch (cause) {
			return fail(409, {
				message: cause instanceof Error ? cause.message : 'The comparison could not be recorded.'
			});
		}
		redirect(303, '/compare');
	}
};
