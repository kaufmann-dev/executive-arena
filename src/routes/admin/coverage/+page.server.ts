import { fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { getReadinessSummary, listCompanies } from '#lib/server/arena/read-model.js';
import { createDatabaseResearchImportService } from '#lib/server/research-import/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const [summary, companies] = await Promise.all([getReadinessSummary(), listCompanies('', 1, 25)]);
	return {
		summary,
		companies: companies.rows,
		notice: url.searchParams.get('notice')
	};
};

export const actions: Actions = {
	freeze: async () => {
		try {
			await createDatabaseResearchImportService(db).freeze();
		} catch (cause) {
			return fail(400, {
				message: cause instanceof Error ? cause.message : 'Cohort freeze failed'
			});
		}
		redirect(303, '/admin/coverage?notice=cohort-frozen');
	}
};
