import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
	COMPANY_STATUS_FILTERS,
	COMPANY_VIEWS,
	companiesPageSearchParams,
	parseCompaniesPageState
} from '#lib/companies-page.js';
import { deleteExecutivePortrait } from '#lib/server/arena/admin-service.js';
import { getCompanyPortraitReview, listCompanies } from '#lib/server/arena/read-model.js';
import type { Actions, PageServerLoad } from './$types';

const returnStateSchema = z.strictObject({
	q: z.string().max(100),
	status: z.enum(COMPANY_STATUS_FILTERS),
	page: z.coerce.number().int().min(1).max(1000),
	view: z.enum(COMPANY_VIEWS)
});

const deletePortraitSchema = returnStateSchema.extend({
	companyId: z.uuid(),
	portraitId: z.uuid()
});

const NOTICES = new Set(['portrait-deleted', 'portrait-delete-failed']);

export const load: PageServerLoad = async ({ url }) => {
	const state = parseCompaniesPageState(url.searchParams);
	const result = await listCompanies(state.q, state.page, state.pageSize, state.status);
	const pageCount = Math.max(1, Math.ceil(result.total / state.pageSize));
	if (result.total > 0 && state.page > pageCount) {
		const search = new URLSearchParams(url.searchParams);
		search.set('page', String(pageCount));
		redirect(303, `${url.pathname}?${search.toString()}`);
	}

	const portraitReview =
		state.view === 'portraits'
			? await getCompanyPortraitReview(result.rows.map((company) => company.id))
			: [];
	const rawNotice = url.searchParams.get('notice');

	return {
		...result,
		...state,
		pageCount,
		portraitReview,
		notice: rawNotice && NOTICES.has(rawNotice) ? rawNotice : null
	};
};

export const actions: Actions = {
	deletePortrait: async ({ request, url }) => {
		const form = await request.formData();
		const values = {
			companyId: stringField(form, 'companyId'),
			portraitId: stringField(form, 'portraitId'),
			q: stringField(form, 'q'),
			status: stringField(form, 'status'),
			page: stringField(form, 'page'),
			view: stringField(form, 'view')
		};
		const parsed = deletePortraitSchema.safeParse(values);
		const parsedReturnState = returnStateSchema.safeParse({
			q: values.q,
			status: values.status,
			page: values.page,
			view: values.view
		});
		const returnState = parsedReturnState.success
			? parsedReturnState.data
			: parseCompaniesPageState(url.searchParams);
		let notice: 'portrait-deleted' | 'portrait-delete-failed' = 'portrait-delete-failed';

		if (parsed.success) {
			try {
				await deleteExecutivePortrait(parsed.data.companyId, parsed.data.portraitId);
				notice = 'portrait-deleted';
			} catch {
				// The fixed failure notice avoids reflecting internal service errors into the URL.
			}
		}

		const search = companiesPageSearchParams(returnState, { notice });
		redirect(303, `${url.pathname}?${search.toString()}`);
	}
};

function stringField(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}
