import { describe, expect, it } from 'vitest';
import { db } from '../db';
import { source } from '../db/schema';
import { latestSourceRetrievedAt } from './drizzle-repository';

describe('Drizzle research repository', () => {
	it('encodes the source UPSERT retrievedAt parameter for PostgreSQL', () => {
		const retrievedAt = new Date('2026-07-27T15:00:00.000Z');
		const query = db
			.insert(source)
			.values({
				url: 'https://example.com/executive-profile',
				title: 'Executive profile',
				publisher: 'Example Publisher',
				retrievedAt
			})
			.onConflictDoUpdate({
				target: source.url,
				set: {
					title: 'Executive profile',
					publisher: 'Example Publisher',
					retrievedAt: latestSourceRetrievedAt(retrievedAt)
				}
			})
			.toSQL();

		expect(query.sql).toMatch(/"retrieved_at" = greatest\(\s*"source"\."retrieved_at",\s*\$7\s*\)/);
		expect(query.params).toEqual([
			'https://example.com/executive-profile',
			'Executive profile',
			'Example Publisher',
			retrievedAt.toISOString(),
			'Executive profile',
			'Example Publisher',
			retrievedAt.toISOString()
		]);
		expect(query.params).not.toContain(retrievedAt);
	});
});
