import { sql } from 'drizzle-orm';
import { source } from './schema';

export function latestSourceRetrievedAt(retrievedAt: Date) {
	return sql`greatest(
		${source.retrievedAt},
		${sql.param(retrievedAt, source.retrievedAt)}
	)`;
}
