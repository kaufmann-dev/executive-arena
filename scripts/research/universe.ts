import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import {
	createNormalizedUniverseSnapshot,
	fetchMassiveUniverse,
	normalizeUniverse,
	reviewedIssuerAliasesSchema
} from '../../src/lib/research/universe';
import { massiveTickerSchema, type MassiveTicker } from '../../src/lib/research/schemas';

const [asOf, aliasesPath, outputPath] = process.argv.slice(2);
if (!asOf || !aliasesPath || !outputPath) {
	throw new Error(
		'Usage: tsx scripts/research/universe.ts <as-of YYYY-MM-DD> <reviewed-aliases.json> <output.json>'
	);
}

const apiKey = process.env.MASSIVE_API_KEY;
if (!apiKey) throw new Error('MASSIVE_API_KEY is required');

const absoluteOutputPath = resolve(outputPath);
await assertOutputDoesNotExist(absoluteOutputPath);
const reviewedAliases = reviewedIssuerAliasesSchema.parse(
	JSON.parse(await readFile(resolve(aliasesPath), 'utf8')) as unknown
);
const checkpointDirectory = `${absoluteOutputPath}.checkpoint`;
await initializeCheckpoint(checkpointDirectory, asOf);
const requestIds = new Set<string>();
const records = await fetchMassiveUniverse({
	apiKey,
	asOf,
	loadCachedDetail: (ticker, requestAsOf) =>
		loadCachedDetail(checkpointDirectory, ticker, requestAsOf),
	saveDetail: (record, requestAsOf, requestId) =>
		saveDetailCheckpoint(checkpointDirectory, record, requestAsOf, requestId),
	onRequestId: (requestId) => requestIds.add(requestId)
});
const universe = normalizeUniverse(records, reviewedAliases);
const snapshot = createNormalizedUniverseSnapshot(universe, asOf, new Date(), [...requestIds]);
await mkdir(dirname(absoluteOutputPath), { recursive: true });
await writeFile(absoluteOutputPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
	encoding: 'utf8',
	flag: 'wx'
});

process.stdout.write(
	`Wrote Massive ${snapshot.asOf} snapshot with ${snapshot.issuerCount} issuers (${snapshot.includedCount} included, ${snapshot.excludedCount} excluded) to ${absoluteOutputPath}\n`
);

const checkpointManifestSchema = z.strictObject({
	schemaVersion: z.literal(1),
	provider: z.literal('massive'),
	asOf: z.iso.date()
});

async function assertOutputDoesNotExist(path: string): Promise<void> {
	try {
		await access(path);
		throw new Error(`Refusing to overwrite existing output ${path}`);
	} catch (error) {
		if (isNodeError(error, 'ENOENT')) return;
		throw error;
	}
}

async function initializeCheckpoint(directory: string, requestAsOf: string): Promise<void> {
	await mkdir(directory, { recursive: true });
	const manifestPath = join(directory, 'manifest.json');
	try {
		const manifest = checkpointManifestSchema.parse(
			JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
		);
		if (manifest.asOf !== requestAsOf) {
			throw new Error(
				`Checkpoint ${directory} belongs to ${manifest.asOf}, not requested date ${requestAsOf}`
			);
		}
	} catch (error) {
		if (!isNodeError(error, 'ENOENT')) throw error;
		await writeFile(
			manifestPath,
			`${JSON.stringify({ schemaVersion: 1, provider: 'massive', asOf: requestAsOf }, null, 2)}\n`,
			{ encoding: 'utf8', flag: 'wx' }
		);
	}
}

async function loadCachedDetail(
	directory: string,
	ticker: string,
	requestAsOf: string
): Promise<{ record: MassiveTicker; requestId: string | null } | null> {
	try {
		const checkpoint = z
			.strictObject({
				asOf: z.literal(requestAsOf),
				requestId: z.string().trim().min(1).nullable(),
				record: massiveTickerSchema
			})
			.parse(
				JSON.parse(await readFile(detailCheckpointPath(directory, ticker), 'utf8')) as unknown
			);
		return { record: checkpoint.record, requestId: checkpoint.requestId };
	} catch (error) {
		if (isNodeError(error, 'ENOENT')) return null;
		throw error;
	}
}

async function saveDetailCheckpoint(
	directory: string,
	record: MassiveTicker,
	requestAsOf: string,
	requestId: string | null
): Promise<void> {
	const target = detailCheckpointPath(directory, record.ticker);
	const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(
		temporary,
		`${JSON.stringify({ asOf: requestAsOf, requestId, record }, null, 2)}\n`,
		{
			encoding: 'utf8',
			flag: 'wx'
		}
	);
	await rename(temporary, target);
}

function detailCheckpointPath(directory: string, ticker: string): string {
	const digest = createHash('sha256').update(ticker).digest('hex');
	return join(directory, `${digest}.json`);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error && error.code === code;
}
