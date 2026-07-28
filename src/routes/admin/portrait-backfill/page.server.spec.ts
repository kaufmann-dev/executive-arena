import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortraitBackfillTarget } from '$lib/server/portrait-backfill/service';

const services = vi.hoisted(() => ({
	excludeCompanies: vi.fn(),
	getNextPortraitBackfillTarget: vi.fn(),
	restorePortraitBackfillCompany: vi.fn(),
	saveExecutivePortraitBatch: vi.fn(),
	skipPortraitBackfillCompany: vi.fn()
}));

vi.mock('$lib/server/arena/admin-service', () => ({
	DuplicatePortraitError: class DuplicatePortraitError extends Error {},
	excludeCompanies: services.excludeCompanies,
	saveExecutivePortraitBatch: services.saveExecutivePortraitBatch
}));

vi.mock('$lib/server/portrait-backfill/google', () => ({
	googleImageSearchUrl: (query: string) => `https://images.example/?q=${encodeURIComponent(query)}`,
	portraitSearchQuery: ({ personName }: { personName: string }) => personName
}));

vi.mock('$lib/server/portrait-backfill/service', () => ({
	executiveMatchesBackfillMode: (portraitCount: number, mode: string) =>
		mode === 'missing' ? portraitCount === 0 : portraitCount < 3,
	getNextPortraitBackfillTarget: services.getNextPortraitBackfillTarget,
	restorePortraitBackfillCompany: services.restorePortraitBackfillCompany,
	skipPortraitBackfillCompany: services.skipPortraitBackfillCompany
}));

import { actions, load } from './+page.server';

const COMPANY_ID = '10000000-0000-4000-8000-000000000001';
const TARGET: PortraitBackfillTarget = {
	cursor: 'authoritative-next-cursor',
	card: {
		companyId: COMPANY_ID,
		slateId: '20000000-0000-4000-8000-000000000001',
		companyName: 'Example Company',
		ticker: 'EX',
		description: '',
		homepageUrl: null,
		marketCap: null,
		effectiveAt: '2026-07-28',
		leaders: [
			{
				id: '30000000-0000-4000-8000-000000000001',
				name: 'No Portrait Leader',
				summary: 'Summary',
				leadershipAsOf: '2026-07-28',
				title: 'Chief Executive Officer',
				roleKind: 'ceo',
				isInterim: false,
				portraits: [],
				sources: [],
				facts: []
			},
			{
				id: '30000000-0000-4000-8000-000000000002',
				name: 'Portrait Leader',
				summary: 'Summary',
				leadershipAsOf: '2026-07-28',
				title: 'President',
				roleKind: 'president',
				isInterim: false,
				portraits: [
					{
						id: '40000000-0000-4000-8000-000000000001',
						imageUrl: null,
						altText: 'Portrait Leader',
						source: null
					}
				],
				sources: [],
				facts: []
			}
		]
	}
};

beforeEach(() => {
	vi.clearAllMocks();
	services.getNextPortraitBackfillTarget.mockResolvedValue(TARGET);
	services.excludeCompanies.mockResolvedValue({
		results: [
			{
				companyId: COMPANY_ID,
				action: 'excluded',
				reason: 'executive_profile_incomplete',
				retainedCompanyId: null
			}
		],
		cohortRevision: null
	});
});

describe('portrait backfill exclusion action', () => {
	it('offers exclusion when any active leader has no portrait and parses its success notice', async () => {
		const result = await load({
			url: new URL(
				'http://localhost/admin/portrait-backfill?mode=incomplete&cursor=before&excluded=1'
			)
		} as never);

		expect(result).toMatchObject({
			mode: 'incomplete',
			cursor: 'before',
			target: TARGET,
			canExclude: true,
			notice: { excluded: true }
		});
	});

	it('does not offer exclusion when every active leader has a saved portrait', async () => {
		const fullyPortraited = structuredClone(TARGET);
		fullyPortraited.card.leaders[0]!.portraits = [
			{
				id: '40000000-0000-4000-8000-000000000002',
				imageUrl: null,
				altText: 'No Portrait Leader',
				source: null
			}
		];
		services.getNextPortraitBackfillTarget.mockResolvedValueOnce(fullyPortraited);

		const result = await load({
			url: new URL('http://localhost/admin/portrait-backfill?mode=incomplete')
		} as never);

		expect(result).toMatchObject({ canExclude: false });
	});

	it('uses the fixed reason and authoritative target cursor after exclusion', async () => {
		const request = exclusionRequest();

		await expect(actions.exclude!({ request } as never)).rejects.toMatchObject({
			status: 303,
			location:
				'/admin/portrait-backfill?mode=incomplete&cursor=authoritative-next-cursor&excluded=1'
		});
		expect(services.getNextPortraitBackfillTarget).toHaveBeenCalledWith('incomplete', 'before');
		expect(services.excludeCompanies).toHaveBeenCalledWith([
			{
				companyId: COMPANY_ID,
				reason: 'executive_profile_incomplete'
			}
		]);
	});

	it('returns an inline failure and rejects a stale queue item without changing a company', async () => {
		services.excludeCompanies.mockRejectedValueOnce(new Error('Company is already excluded'));
		await expect(actions.exclude!({ request: exclusionRequest() } as never)).resolves.toMatchObject(
			{
				status: 409,
				data: {
					action: 'exclude',
					message: 'Company is already excluded'
				}
			}
		);

		services.getNextPortraitBackfillTarget.mockResolvedValueOnce(null);
		await expect(actions.exclude!({ request: exclusionRequest() } as never)).resolves.toMatchObject(
			{
				status: 409,
				data: {
					action: 'exclude',
					message: 'This queue item changed; reload before excluding it'
				}
			}
		);
		expect(services.excludeCompanies).toHaveBeenCalledTimes(1);
	});
});

function exclusionRequest(): Request {
	return new Request(
		'http://localhost/admin/portrait-backfill?/exclude&mode=incomplete&cursor=before',
		{
			method: 'POST',
			body: new URLSearchParams({
				mode: 'incomplete',
				companyId: COMPANY_ID,
				beforeCursor: 'before'
			})
		}
	);
}
