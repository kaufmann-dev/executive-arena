import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import {
	batchResearchTasks,
	createResearchTasks,
	researchBatchSchema
} from '../../src/lib/research/tasks';
import { normalizedUniverseSnapshotSchema } from '../../src/lib/research/universe';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) {
	throw new Error(
		'Usage: tsx scripts/research/prepare.ts <normalized-universe.json> <batches.json>'
	);
}

const input = JSON.parse(await readFile(resolve(inputPath), 'utf8')) as unknown;
const snapshot = normalizedUniverseSnapshotSchema.parse(input);
const batches = z
	.array(researchBatchSchema)
	.parse(batchResearchTasks(createResearchTasks(snapshot.issuers), 10));
const absoluteOutputPath = resolve(outputPath);
await mkdir(dirname(absoluteOutputPath), { recursive: true });
await writeFile(absoluteOutputPath, `${JSON.stringify(batches, null, 2)}\n`, {
	encoding: 'utf8',
	flag: 'wx'
});
process.stdout.write(
	`Wrote ${batches.length} ten-company research batches (${batches.reduce((sum, batch) => sum + batch.tasks.length, 0)} tasks) to ${absoluteOutputPath}\n`
);
