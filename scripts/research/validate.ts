import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { executiveReviewArtifactSchema } from '../../src/lib/research/schemas';
import { researchBatchSchema } from '../../src/lib/research/tasks';
import {
	validateExecutiveProfile,
	validateProfileCoverage,
	type LabeledProfileInput
} from '../../src/lib/research/validation';

const arguments_ = process.argv.slice(2);
const taskFlagIndex = arguments_.indexOf('--tasks');
const taskManifestPath = taskFlagIndex === -1 ? undefined : arguments_.splice(taskFlagIndex, 2)[1];
if (taskFlagIndex !== -1 && !taskManifestPath) {
	throw new Error('--tasks requires a research-batches.json path');
}
const inputPaths = arguments_;
if (inputPaths.length === 0) {
	throw new Error(
		'Usage: tsx scripts/research/validate.ts [--tasks research-batches.json] <profile.json> [profile.json ...]'
	);
}

let failed = false;
const inputs: LabeledProfileInput[] = [];
for (const inputPath of inputPaths) {
	const absolutePath = resolve(inputPath);
	let input: unknown;
	try {
		input = JSON.parse(await readFile(absolutePath, 'utf8')) as unknown;
	} catch (error) {
		failed = true;
		process.stderr.write(
			`${absolutePath}\n  - ${error instanceof Error ? error.message : String(error)}\n`
		);
		continue;
	}

	const values = Array.isArray(input) ? input : [input];
	for (const [index, value] of values.entries()) {
		inputs.push({
			label: values.length === 1 ? absolutePath : `${absolutePath}[${index}]`,
			value
		});
	}
}

if (taskManifestPath) {
	const absoluteManifestPath = resolve(taskManifestPath);
	const manifestInput = JSON.parse(await readFile(absoluteManifestPath, 'utf8')) as unknown;
	const batches = z.array(researchBatchSchema).min(1).parse(manifestInput);
	const result = validateProfileCoverage(
		inputs,
		batches.flatMap((batch) => batch.tasks)
	);
	for (const issue of [
		...result.invalid,
		...result.needsReview,
		...result.duplicates,
		...result.unexpected
	]) {
		process.stderr.write(
			`${issue.label}\n${issue.errors.map((error) => `  - ${error}`).join('\n')}\n`
		);
	}
	for (const issuerKey of result.missing) {
		process.stderr.write(`missing\n  - ${issuerKey}\n`);
	}
	process.stdout.write(
		`Coverage: expected=${result.expected} valid=${result.valid} invalid=${result.invalid.length} needs_review=${result.needsReview.length} missing=${result.missing.length} duplicates=${result.duplicates.length} unexpected=${result.unexpected.length}\n`
	);
	if (!result.exact || failed) process.exitCode = 1;
} else {
	for (const input of inputs) {
		const review = executiveReviewArtifactSchema.safeParse(input.value);
		if (review.success) {
			failed = true;
			process.stderr.write(
				`${input.label}\n${review.data.reasons.map((reason) => `  - manual review required: ${reason}`).join('\n')}\n`
			);
			continue;
		}
		const result = validateExecutiveProfile(input.value);
		if (!result.success) {
			failed = true;
			process.stderr.write(
				`${input.label}\n${result.errors.map((error) => `  - ${error}`).join('\n')}\n`
			);
			continue;
		}
		process.stdout.write(`${input.label}: valid\n`);
	}
}

/*
 * File read/JSON errors are reported while collecting inputs so one malformed file does not hide
 * the rest of a large research run.
 */
if (failed) process.exitCode = 1;
