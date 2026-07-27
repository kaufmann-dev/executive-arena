import { redirect } from '@sveltejs/kit';
import { listCompanies, type CompanyStatusFilter } from '$lib/server/arena/read-model';
import type { PageServerLoad } from './$types';

const STATUSES = new Set<CompanyStatusFilter>(['all', 'not_ready', 'ready', 'excluded']);

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const rawPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
	const page = Number.isFinite(rawPage) ? Math.max(1, Math.min(rawPage, 1000)) : 1;
	const rawStatus = url.searchParams.get('status') ?? 'all';
	const status: CompanyStatusFilter = STATUSES.has(rawStatus as CompanyStatusFilter)
		? (rawStatus as CompanyStatusFilter)
		: 'all';
	const pageSize = 50;
	const result = await listCompanies(q, page, pageSize, status);
	const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
	if (result.total > 0 && page > pageCount) {
		const search = new URLSearchParams(url.searchParams);
		search.set('page', String(pageCount));
		redirect(303, `${url.pathname}?${search.toString()}`);
	}
	return { ...result, q, status, page, pageCount };
};
