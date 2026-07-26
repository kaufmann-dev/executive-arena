import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from '$lib/server/db';

let migrationPromise: Promise<void> | undefined;

export function runMigrations(): Promise<void> {
	migrationPromise ??= migrate(db, { migrationsFolder: 'drizzle' }).catch((cause) => {
		migrationPromise = undefined;
		throw cause;
	});
	return migrationPromise;
}
