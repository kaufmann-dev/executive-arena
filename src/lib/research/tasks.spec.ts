import { describe, expect, it } from 'vitest';
import { batchResearchTasks, createResearchTasks, type ResearchTask } from './tasks';
import type { NormalizedIssuer } from './universe';

function issuer(index: number, included = true): NormalizedIssuer {
	return {
		issuerKey: `cik:${String(index).padStart(10, '0')}`,
		cik: String(index).padStart(10, '0'),
		name: `Company ${index}`,
		description: `Description ${index}`,
		homepageUrl: null,
		sicCode: null,
		sicDescription: null,
		canonicalTicker: `T${String(index).padStart(2, '0')}`,
		marketCap: index,
		included,
		exclusionReason: included ? null : 'sic_6770',
		listings: [
			{
				ticker: `T${String(index).padStart(2, '0')}`,
				name: `Company ${index}`,
				primaryExchange: null,
				type: 'CS',
				active: true,
				compositeFigi: null,
				shareClassFigi: null,
				marketCap: index,
				lastUpdatedAt: null,
				isCanonical: true
			}
		]
	};
}

describe('research task batching', () => {
	it('omits excluded issuers and emits deterministic batches of ten', () => {
		const issuers = [
			...Array.from({ length: 21 }, (_, index) => issuer(index + 1)),
			issuer(22, false)
		].reverse();

		const tasks = createResearchTasks(issuers);
		const batches = batchResearchTasks(tasks);

		expect(tasks).toHaveLength(21);
		expect(batches.map((batch) => batch.tasks.length)).toEqual([10, 10, 1]);
		expect(batches.map((batch) => batch.batch_number)).toEqual([1, 2, 3]);
		expect(batches[0]!.tasks[0]!.canonical_ticker).toBe('T01');
	});

	it('rejects batch sizes above the ten-company agent limit', () => {
		expect(() => batchResearchTasks([] as ResearchTask[], 11)).toThrow('1 through 10');
	});
});
