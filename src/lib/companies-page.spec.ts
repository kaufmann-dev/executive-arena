import { describe, expect, it } from 'vitest';
import { companiesPageSearchParams, parseCompaniesPageState } from './companies-page';

describe('companies page query state', () => {
	it('defaults to the 50-row list view', () => {
		expect(parseCompaniesPageState(new URLSearchParams())).toEqual({
			q: '',
			status: 'all',
			page: 1,
			view: 'list',
			pageSize: 50
		});
	});

	it('allowlists the portrait view and uses its 20-row page size', () => {
		expect(
			parseCompaniesPageState(
				new URLSearchParams({
					q: 'Acme',
					status: 'missing_image',
					page: '7',
					view: 'portraits'
				})
			)
		).toEqual({
			q: 'Acme',
			status: 'missing_image',
			page: 7,
			view: 'portraits',
			pageSize: 20
		});
	});

	it('defaults invalid status, view, and page values', () => {
		expect(
			parseCompaniesPageState(
				new URLSearchParams({ status: 'unknown', view: 'gallery', page: 'not-a-number' })
			)
		).toMatchObject({ status: 'all', view: 'list', page: 1, pageSize: 50 });
	});

	it('bounds the page and search query', () => {
		expect(
			parseCompaniesPageState(new URLSearchParams({ page: '4000', q: 'x'.repeat(120) }))
		).toMatchObject({ page: 1000, q: 'x'.repeat(100) });
		expect(parseCompaniesPageState(new URLSearchParams({ page: '-4' }))).toMatchObject({
			page: 1
		});
	});

	it('preserves table state while applying explicit changes', () => {
		const state = {
			q: 'Acme',
			status: 'ready' as const,
			page: 4,
			view: 'portraits' as const
		};

		expect(companiesPageSearchParams(state).toString()).toBe(
			'q=Acme&status=ready&page=4&view=portraits'
		);
		expect(companiesPageSearchParams(state, { view: 'list', page: 1 }).toString()).toBe(
			'q=Acme&status=ready&page=1&view=list'
		);
		expect(companiesPageSearchParams(state, { q: '' }).toString()).toBe(
			'status=ready&page=4&view=portraits'
		);
		expect(companiesPageSearchParams(state, { notice: 'portrait-deleted' }).toString()).toBe(
			'q=Acme&status=ready&page=4&view=portraits&notice=portrait-deleted'
		);
	});
});
