import { describe, expect, it } from 'vitest';
import {
	buildCompanyPortraitReviewQuery,
	buildPersonFactsQuery,
	groupCompanyPortraitReviewRows,
	type CompanyPortraitReviewQueryRow
} from './read-model';

describe('arena read model', () => {
	it('orders person facts without referencing an unjoined source table', () => {
		const query = buildPersonFactsQuery(['802d2358-c984-4db7-bb02-d41d52c15adf']).toSQL();

		expect(query.sql).toContain('from "person_fact"');
		expect(query.sql).toContain('order by "person_fact"."sort_order" asc, "person_fact"."id" asc');
		expect(query.sql).not.toContain('"source"');
	});

	it('builds one focused active-leadership portrait query without heavy profile data', () => {
		const query = buildCompanyPortraitReviewQuery([
			'10000000-0000-4000-8000-000000000001',
			'10000000-0000-4000-8000-000000000002'
		]).toSQL();

		expect(query.sql).toContain('left join "leadership_slate"');
		expect(query.sql).toContain('"leadership_slate"."status" = $1');
		expect(query.params).toContain('active');
		expect(query.sql).toContain('left join "leadership_member"');
		expect(query.sql).toContain('left join "portrait"');
		expect(query.sql).toContain('"portrait"."width"');
		expect(query.sql).toContain('"portrait"."height"');
		expect(query.sql).not.toContain('"portrait"."image"');
		expect(query.sql).not.toContain('"person_fact"');
		expect(query.sql).not.toContain('"person_source"');
		expect(query.sql).not.toContain('"source"');
	});

	it('groups every active role in leader and portrait display order', () => {
		const companyWithSlate = '10000000-0000-4000-8000-000000000001';
		const companyWithoutSlate = '10000000-0000-4000-8000-000000000002';
		const excludedCompany = '10000000-0000-4000-8000-000000000003';
		const rows: CompanyPortraitReviewQueryRow[] = [
			row({
				companyId: companyWithSlate,
				activeSlateId: '30000000-0000-4000-8000-000000000001',
				personId: '20000000-0000-4000-8000-000000000002',
				personName: 'President Person',
				title: 'President',
				roleKind: 'president',
				leaderDisplayOrder: 1,
				portraitId: '40000000-0000-4000-8000-000000000003',
				portraitDisplayOrder: 1
			}),
			row({
				companyId: companyWithSlate,
				activeSlateId: '30000000-0000-4000-8000-000000000001',
				personId: '20000000-0000-4000-8000-000000000001',
				personName: 'Chief Person',
				title: 'Co-Chief Executive Officer',
				roleKind: 'co_ceo',
				leaderDisplayOrder: 0,
				portraitId: '40000000-0000-4000-8000-000000000002',
				portraitDisplayOrder: 1
			}),
			row({
				companyId: companyWithSlate,
				activeSlateId: '30000000-0000-4000-8000-000000000001',
				personId: '20000000-0000-4000-8000-000000000001',
				personName: 'Chief Person',
				title: 'Co-Chief Executive Officer',
				roleKind: 'co_ceo',
				leaderDisplayOrder: 0,
				portraitId: '40000000-0000-4000-8000-000000000001',
				portraitDisplayOrder: 0
			}),
			row({
				companyId: companyWithSlate,
				activeSlateId: '30000000-0000-4000-8000-000000000001',
				personId: '20000000-0000-4000-8000-000000000003',
				personName: 'Chair Person',
				title: 'Executive Chair',
				roleKind: 'executive_chair',
				leaderDisplayOrder: 2
			}),
			row({
				companyId: companyWithSlate,
				activeSlateId: '30000000-0000-4000-8000-000000000001',
				personId: '20000000-0000-4000-8000-000000000004',
				personName: 'Managing Person',
				title: 'Managing Director',
				roleKind: 'managing_director',
				leaderDisplayOrder: 3
			}),
			row({
				companyId: companyWithSlate,
				activeSlateId: '30000000-0000-4000-8000-000000000001',
				personId: '20000000-0000-4000-8000-000000000005',
				personName: 'CEO Person',
				title: 'Chief Executive Officer',
				roleKind: 'ceo',
				leaderDisplayOrder: 4
			}),
			row({ companyId: companyWithoutSlate }),
			row({ companyId: excludedCompany })
		];

		const grouped = groupCompanyPortraitReviewRows(
			[companyWithSlate, companyWithoutSlate, excludedCompany],
			rows
		);

		expect(grouped.map(({ companyId }) => companyId)).toEqual([
			companyWithSlate,
			companyWithoutSlate,
			excludedCompany
		]);
		expect(grouped[0]?.leaders.map(({ roleKind }) => roleKind)).toEqual([
			'co_ceo',
			'president',
			'executive_chair',
			'managing_director',
			'ceo'
		]);
		expect(grouped[0]?.leaders[0]?.portraits.map(({ displayOrder }) => displayOrder)).toEqual([
			0, 1
		]);
		expect(grouped[1]).toMatchObject({ activeSlateId: null, leaders: [] });
		expect(grouped[2]).toMatchObject({ activeSlateId: null, leaders: [] });
	});
});

function row(
	overrides: Partial<CompanyPortraitReviewQueryRow> &
		Pick<CompanyPortraitReviewQueryRow, 'companyId'>
): CompanyPortraitReviewQueryRow {
	const { companyId, ...rest } = overrides;
	return {
		companyId,
		activeSlateId: null,
		personId: null,
		personName: null,
		title: null,
		roleKind: null,
		isInterim: false,
		leaderDisplayOrder: null,
		portraitId: null,
		portraitAltText: null,
		portraitWidth: null,
		portraitHeight: null,
		portraitDisplayOrder: null,
		...rest,
		...(overrides.portraitId
			? {
					portraitAltText: overrides.portraitAltText ?? 'Stored portrait',
					portraitWidth: overrides.portraitWidth ?? 320,
					portraitHeight: overrides.portraitHeight ?? 240
				}
			: {})
	};
}
