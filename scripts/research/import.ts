import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
	connectResearchDatabase,
	createDatabaseResearchImportService,
	type ImportedProfileResult,
	MAX_PROFILE_IMPORT_BATCH_SIZE,
	parseExecutiveProfileSet
} from '../../src/lib/server/research-import';
import type { ExecutiveProfile } from '../../src/lib/research/schemas';
import { persistActiveRanking } from '../../src/lib/server/ranking/persistence';

const [mode, ...argumentsAfterMode] = process.argv.slice(2);
if (mode !== 'universe' && mode !== 'profiles') {
	throw usageError();
}

const unknownFlags = argumentsAfterMode.filter(
	(argument) => argument.startsWith('--') && argument !== '--approved'
);
if (unknownFlags.length > 0) {
	throw new Error(`Unknown option(s): ${unknownFlags.join(', ')}`);
}

const approvalCount = argumentsAfterMode.filter((argument) => argument === '--approved').length;
const inputPaths = argumentsAfterMode.filter((argument) => argument !== '--approved');
if (inputPaths.length === 0) {
	throw usageError();
}
if (mode === 'profiles' && approvalCount !== 1) {
	throw new Error(
		'Profile import requires exactly one explicit --approved flag after human review'
	);
}
if (mode === 'universe' && approvalCount !== 0) {
	throw new Error('--approved is valid only for profile imports');
}
if (mode === 'universe' && inputPaths.length !== 1) {
	throw new Error('Universe import accepts exactly one normalized-universe JSON file');
}

const universeInput = mode === 'universe' ? await readJson(inputPaths[0]!) : null;
const profiles = mode === 'profiles' ? await readAndValidateProfiles(inputPaths) : null;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const connection = connectResearchDatabase(databaseUrl);
const importer = createDatabaseResearchImportService(connection.database);
try {
	if (mode === 'universe') {
		const result = await importer.importUniverse(universeInput);
		process.stdout.write(
			`Imported ${result.issuerCount} issuers (${result.includedCount} included, ${result.excludedCount} excluded) and ${result.listingCount} listings\n`
		);
	} else {
		const approvedProfiles = profiles!;
		const importedProfiles: ImportedProfileResult[] = [];
		const batchCount = Math.ceil(approvedProfiles.length / MAX_PROFILE_IMPORT_BATCH_SIZE);

		for (
			let offset = 0;
			offset < approvedProfiles.length;
			offset += MAX_PROFILE_IMPORT_BATCH_SIZE
		) {
			const batchNumber = Math.floor(offset / MAX_PROFILE_IMPORT_BATCH_SIZE) + 1;
			const batch = approvedProfiles.slice(offset, offset + MAX_PROFILE_IMPORT_BATCH_SIZE);
			const result = await importer.importProfiles(batch);
			importedProfiles.push(...result.profiles);
			process.stdout.write(
				`Imported approved profile batch ${batchNumber}/${batchCount} (${importedProfiles.length}/${approvedProfiles.length} profiles complete)\n`
			);
		}

		if (importedProfiles.some((profile) => profile.cohortRevision !== null)) {
			await persistActiveRanking(connection.database);
		}
		const actions = Map.groupBy(importedProfiles, (profile) => profile.action);
		process.stdout.write(
			`Imported ${importedProfiles.length} approved profile(s): ${actions.get('created')?.length ?? 0} created, ${actions.get('updated')?.length ?? 0} updated, ${actions.get('replaced')?.length ?? 0} replaced\n`
		);
	}
} finally {
	await connection.close();
}

async function readJson(inputPath: string): Promise<unknown> {
	return JSON.parse(await readFile(resolve(inputPath), 'utf8')) as unknown;
}

async function readAndValidateProfiles(inputPaths: string[]): Promise<ExecutiveProfile[]> {
	const inputs: unknown[] = [];
	for (const inputPath of inputPaths) {
		const input = await readJson(inputPath);
		inputs.push(...(Array.isArray(input) ? input : [input]));
	}
	return parseExecutiveProfileSet(inputs);
}

function usageError(): Error {
	return new Error(
		[
			'Usage:',
			'  tsx scripts/research/import.ts universe <normalized-universe.json>',
			'  tsx scripts/research/import.ts profiles --approved <profile.json> [profile.json ...]'
		].join('\n')
	);
}
