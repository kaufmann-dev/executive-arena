import {
	connectResearchDatabase,
	createDatabaseResearchImportService
} from '../../src/lib/server/research-import';

if (process.argv.length > 2) {
	throw new Error('Usage: tsx scripts/research/freeze.ts');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const connection = connectResearchDatabase(databaseUrl);
try {
	const result = await createDatabaseResearchImportService(connection.database).freeze();
	process.stdout.write(
		result.alreadyFrozen
			? `Cohort was already frozen at ${result.frozenAt.toISOString()} with ${result.includedCount} companies (revision ${result.revision})\n`
			: `Frozen ${result.includedCount} companies at ${result.frozenAt.toISOString()} (revision ${result.revision})\n`
	);
} finally {
	await connection.close();
}
