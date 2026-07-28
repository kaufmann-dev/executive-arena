export const COMPANY_STATUS_FILTERS = [
	'all',
	'not_ready',
	'missing_image',
	'ready',
	'excluded'
] as const;
export const COMPANY_VIEWS = ['list', 'portraits'] as const;

export type CompanyStatusFilter = (typeof COMPANY_STATUS_FILTERS)[number];
export type CompaniesView = (typeof COMPANY_VIEWS)[number];

export interface CompaniesPageState {
	q: string;
	status: CompanyStatusFilter;
	page: number;
	view: CompaniesView;
	pageSize: number;
}

export function parseCompaniesPageState(searchParams: URLSearchParams): CompaniesPageState {
	const rawPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
	const rawStatus = searchParams.get('status') ?? 'all';
	const rawView = searchParams.get('view') ?? 'list';
	const view: CompaniesView = includes(COMPANY_VIEWS, rawView) ? rawView : 'list';

	return {
		q: (searchParams.get('q') ?? '').slice(0, 100),
		status: includes(COMPANY_STATUS_FILTERS, rawStatus) ? rawStatus : 'all',
		page: Number.isFinite(rawPage) ? Math.max(1, Math.min(rawPage, 1000)) : 1,
		view,
		pageSize: view === 'portraits' ? 20 : 50
	};
}

export function companiesPageSearchParams(
	state: Pick<CompaniesPageState, 'q' | 'status' | 'page' | 'view'>,
	overrides: Partial<Pick<CompaniesPageState, 'q' | 'status' | 'page' | 'view'>> & {
		notice?: 'portrait-deleted' | 'portrait-delete-failed' | null;
	} = {}
): URLSearchParams {
	const next = { ...state, ...overrides };
	const search = new URLSearchParams();
	if (next.q) search.set('q', next.q);
	search.set('status', next.status);
	search.set('page', String(next.page));
	search.set('view', next.view);
	if (overrides.notice) search.set('notice', overrides.notice);
	return search;
}

function includes<const Values extends readonly string[]>(
	values: Values,
	value: string
): value is Values[number] {
	return values.includes(value as Values[number]);
}
