import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../db/schema';
import type { ResearchDatabase } from './drizzle-repository';

export interface ResearchDatabaseConnection {
	database: ResearchDatabase;
	close(): Promise<void>;
}

export function connectResearchDatabase(databaseUrl: string): ResearchDatabaseConnection {
	const client = postgres(databaseUrl, { max: 1 });
	return {
		database: drizzle(client, { schema }),
		close: () => client.end()
	};
}
