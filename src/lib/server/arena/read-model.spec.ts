import { describe, expect, it } from 'vitest';
import { buildPersonFactsQuery } from './read-model';

describe('arena read model', () => {
	it('orders person facts without referencing an unjoined source table', () => {
		const query = buildPersonFactsQuery(['802d2358-c984-4db7-bb02-d41d52c15adf']).toSQL();

		expect(query.sql).toContain('from "person_fact"');
		expect(query.sql).toContain('order by "person_fact"."sort_order" asc, "person_fact"."id" asc');
		expect(query.sql).not.toContain('"source"');
	});
});
