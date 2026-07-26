import { z } from 'zod';
import { normalizedIssuerSchema, type NormalizedIssuer } from './universe';

export const researchTaskSchema = z.strictObject({
	issuer_key: z.string().min(1),
	canonical_ticker: z.string().min(1),
	company_name: z.string().min(1),
	description: z.string(),
	homepage_url: z.string().nullable(),
	cik: z.string().nullable()
});

export const researchBatchSchema = z.strictObject({
	schema_version: z.literal(1),
	batch_number: z.number().int().positive(),
	tasks: z.array(researchTaskSchema).min(1).max(10)
});

export type ResearchTask = z.infer<typeof researchTaskSchema>;
export type ResearchBatch = z.infer<typeof researchBatchSchema>;

export function createResearchTasks(issuers: readonly NormalizedIssuer[]): ResearchTask[] {
	return issuers
		.map((issuer) => normalizedIssuerSchema.parse(issuer))
		.filter((issuer) => issuer.included)
		.sort(
			(left, right) =>
				(left.canonicalTicker < right.canonicalTicker
					? -1
					: left.canonicalTicker > right.canonicalTicker
						? 1
						: 0) ||
				(left.issuerKey < right.issuerKey ? -1 : left.issuerKey > right.issuerKey ? 1 : 0)
		)
		.map((issuer) => ({
			issuer_key: issuer.issuerKey,
			canonical_ticker: issuer.canonicalTicker,
			company_name: issuer.name,
			description: issuer.description,
			homepage_url: issuer.homepageUrl,
			cik: issuer.cik
		}));
}

export function batchResearchTasks(
	tasks: readonly ResearchTask[],
	batchSize = 10
): ResearchBatch[] {
	if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) {
		throw new Error('batchSize must be an integer from 1 through 10');
	}

	const validatedTasks = tasks.map((task) => researchTaskSchema.parse(task));
	const batches: ResearchBatch[] = [];
	for (let index = 0; index < validatedTasks.length; index += batchSize) {
		batches.push({
			schema_version: 1,
			batch_number: batches.length + 1,
			tasks: validatedTasks.slice(index, index + batchSize)
		});
	}
	return batches;
}
