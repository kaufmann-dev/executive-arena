import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const client = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : postgres();

export const db = drizzle(client, { schema });
