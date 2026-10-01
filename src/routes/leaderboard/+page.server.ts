import { redirect } from '@sveltejs/kit';
import { getLeaderboard } from '#lib/server/arena/read-model.js';
import type { LeaderboardQuery } from '#lib/server/arena/read-model.js';
import type { PageServerLoad } from './$types';

const SORTS = new Set<LeaderboardQuery['sort']>(['rank', 'company', 'score', 'comparisons']);

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const rawPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
	const page = Number.isFinite(rawPage) ? Math.max(1, Math.min(rawPage, 1000)) : 1;
	const rawSort = url.searchParams.get('sort') ?? 'rank';
	const sort: LeaderboardQuery['sort'] = SORTS.has(rawSort as LeaderboardQuery['sort'])
		? (rawSort as LeaderboardQuery['sort'])
		: 'rank';
	const rawDirection = url.searchParams.get('direction');
	const direction: LeaderboardQuery['direction'] =
		rawDirection === 'asc' || rawDirection === 'desc'
			? rawDirection
			: sort === 'company'
				? 'asc'
				: sort === 'rank'
					? 'asc'
					: 'desc';
	const pageSize = 50;
	const result = await getLeaderboard({ q, page, pageSize, sort, direction });
	const pageCount = Math.max(1, Math.ceil(result.total / pageSize));
	if (result.total > 0 && page > pageCount) {
		const search = new URLSearchParams(url.searchParams);
		search.set('page', String(pageCount));
		redirect(303, `${url.pathname}?${search.toString()}`);
	}

	return {
		...result,
		query: { q, page, pageSize, sort, direction },
		pageCount
	};
};
