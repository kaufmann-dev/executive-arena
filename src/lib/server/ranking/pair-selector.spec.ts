import { describe, expect, it } from 'vitest';
import {
	MINIMUM_APPEARANCES,
	selectPair,
	type PairingRanking,
	type PairingRecord,
	type PairSelection
} from './pair-selector';

describe('selectPair', () => {
	it('connects every active slate before moving to exposure coverage', () => {
		const slateIds = makeSlateIds(8);
		const rankings = makeRankings(slateIds);
		const comparisons: PairingRecord[] = [];

		for (let index = 0; index < slateIds.length - 1; index += 1) {
			const selection = requireSelection(
				selectPair({
					activeSlateIds: [...slateIds].reverse(),
					comparisons,
					rankingEntries: rankings,
					seed: 'connectivity-seed'
				})
			);

			expect(selection.phase).toBe('connectivity');
			comparisons.push(selection);
		}

		expect(componentCount(slateIds, comparisons)).toBe(1);
		expect(new Set(comparisons.map(pairKey)).size).toBe(comparisons.length);

		const next = requireSelection(
			selectPair({
				activeSlateIds: slateIds,
				comparisons,
				rankingEntries: rankings,
				seed: 'connectivity-seed'
			})
		);
		expect(next.phase).toBe('coverage');
	});

	it('reaches four appearances per slate without repeats when unseen peers exist', () => {
		const slateIds = makeSlateIds(8);
		const comparisons = reachCoverage(slateIds, 'coverage-seed');
		const appearances = countAppearances(slateIds, comparisons);

		expect([...appearances.values()].every((count) => count >= MINIMUM_APPEARANCES)).toBe(true);
		expect(componentCount(slateIds, comparisons)).toBe(1);
		expect(new Set(comparisons.map(pairKey)).size).toBe(comparisons.length);

		const next = requireSelection(
			selectPair({
				activeSlateIds: slateIds,
				comparisons,
				rankingEntries: makeRankings(slateIds),
				seed: 'coverage-seed'
			})
		);
		expect(next.phase).toBe('adaptive');
	});

	it('uses every tenth post-coverage selection for cross-rank exploration', () => {
		const slateIds = makeSlateIds(8);
		const rankings = makeRankings(slateIds);
		const comparisons = reachCoverage(slateIds, 'exploration-seed', rankings);
		const phases: string[] = [];
		let exploration: PairSelection | null = null;

		for (let index = 0; index < 10; index += 1) {
			const selection = requireSelection(
				selectPair({
					activeSlateIds: slateIds,
					comparisons,
					rankingEntries: rankings,
					seed: 'exploration-seed'
				})
			);

			phases.push(selection.phase);
			comparisons.push(selection);
			if (selection.phase === 'exploration') exploration = selection;
		}

		expect(phases).toEqual([
			'adaptive',
			'adaptive',
			'adaptive',
			'adaptive',
			'adaptive',
			'adaptive',
			'adaptive',
			'adaptive',
			'adaptive',
			'exploration'
		]);

		const positions = new Map(rankings.map((entry, index) => [entry.slateId, index]));
		const leftPosition = positions.get(exploration!.leftSlateId)!;
		const rightPosition = positions.get(exploration!.rightSlateId)!;
		const topHalfEnd = Math.floor(slateIds.length / 2);
		const bottomHalfStart = Math.ceil(slateIds.length / 2);

		expect(
			Math.min(leftPosition, rightPosition) < topHalfEnd &&
				Math.max(leftPosition, rightPosition) >= bottomHalfStart
		).toBe(true);
	});

	it('adapts toward close strengths while anchoring the least-exposed slate', () => {
		const slateIds = ['a', 'b', 'c', 'd'];
		const rankings: PairingRanking[] = [
			{ slateId: 'a', rank: 1, strength: 4 },
			{ slateId: 'b', rank: 2, strength: 2 },
			{ slateId: 'c', rank: 3, strength: 1 },
			{ slateId: 'd', rank: 4, strength: 0.5 }
		];
		const comparisons: PairingRecord[] = [
			{ leftSlateId: 'a', rightSlateId: 'c' },
			{ leftSlateId: 'a', rightSlateId: 'd' },
			{ leftSlateId: 'b', rightSlateId: 'd' },
			{ leftSlateId: 'b', rightSlateId: 'c' },
			{ leftSlateId: 'a', rightSlateId: 'b' },
			{ leftSlateId: 'c', rightSlateId: 'd' },
			{ leftSlateId: 'a', rightSlateId: 'c' },
			{ leftSlateId: 'b', rightSlateId: 'd' }
		];

		// Coverage is complete and every unordered pair has already appeared, so
		// the selector rotates to the least-repeated close matchup.
		const first = requireSelection(
			selectPair({
				activeSlateIds: slateIds,
				comparisons,
				rankingEntries: rankings,
				seed: 'adaptive-seed'
			})
		);
		const second = requireSelection(
			selectPair({
				activeSlateIds: [...slateIds].reverse(),
				comparisons: [...comparisons],
				rankingEntries: [...rankings].reverse(),
				seed: 'adaptive-seed'
			})
		);

		expect(first.phase).toBe('adaptive');
		expect(second).toEqual(first);
		expect(new Set([first.leftSlateId, first.rightSlateId])).toEqual(new Set(['c', 'd']));
	});

	it('returns null for fewer than two slates and validates selector inputs', () => {
		expect(
			selectPair({
				activeSlateIds: ['only'],
				comparisons: [],
				rankingEntries: [{ slateId: 'only', rank: 1, strength: 1 }],
				seed: 'seed'
			})
		).toBeNull();

		expect(() =>
			selectPair({
				activeSlateIds: ['a', 'b'],
				comparisons: [{ leftSlateId: 'a', rightSlateId: 'outside' }],
				rankingEntries: makeRankings(['a', 'b']),
				seed: 'seed'
			})
		).toThrow('inactive right');
		expect(() =>
			selectPair({
				activeSlateIds: ['a', 'b'],
				comparisons: [],
				rankingEntries: [{ slateId: 'a', rank: 1, strength: 1 }],
				seed: 'seed'
			})
		).toThrow('every active slate');
		expect(() =>
			selectPair({
				activeSlateIds: ['a', 'b'],
				comparisons: [],
				rankingEntries: makeRankings(['a', 'b']),
				seed: ''
			})
		).toThrow('seed');
	});
});

function reachCoverage(
	slateIds: string[],
	seed: string,
	rankings = makeRankings(slateIds)
): PairingRecord[] {
	const comparisons: PairingRecord[] = [];

	for (let guard = 0; guard < 100; guard += 1) {
		const appearances = countAppearances(slateIds, comparisons);
		if (
			componentCount(slateIds, comparisons) === 1 &&
			[...appearances.values()].every((count) => count >= MINIMUM_APPEARANCES)
		) {
			return comparisons;
		}

		comparisons.push(
			requireSelection(
				selectPair({
					activeSlateIds: slateIds,
					comparisons,
					rankingEntries: rankings,
					seed
				})
			)
		);
	}

	throw new Error('Coverage did not complete within the test guard');
}

function makeSlateIds(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `slate-${String(index + 1).padStart(2, '0')}`);
}

function makeRankings(slateIds: readonly string[]): PairingRanking[] {
	return slateIds.map((slateId, index) => ({
		slateId,
		rank: index + 1,
		strength: Math.exp((slateIds.length - index - 1) / 4)
	}));
}

function requireSelection(selection: PairSelection | null): PairSelection {
	if (selection === null) throw new Error('Expected a pairing selection');
	return selection;
}

function pairKey(pair: PairingRecord): string {
	return [pair.leftSlateId, pair.rightSlateId].sort().join(':');
}

function countAppearances(
	slateIds: readonly string[],
	comparisons: readonly PairingRecord[]
): Map<string, number> {
	const counts = new Map(slateIds.map((slateId) => [slateId, 0]));

	for (const comparison of comparisons) {
		counts.set(comparison.leftSlateId, counts.get(comparison.leftSlateId)! + 1);
		counts.set(comparison.rightSlateId, counts.get(comparison.rightSlateId)! + 1);
	}

	return counts;
}

function componentCount(
	slateIds: readonly string[],
	comparisons: readonly PairingRecord[]
): number {
	const parents = new Map(slateIds.map((slateId) => [slateId, slateId]));

	const find = (slateId: string): string => {
		const parent = parents.get(slateId)!;
		if (parent === slateId) return slateId;
		const root = find(parent);
		parents.set(slateId, root);
		return root;
	};

	for (const comparison of comparisons) {
		const leftRoot = find(comparison.leftSlateId);
		const rightRoot = find(comparison.rightSlateId);
		if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot);
	}

	return new Set(slateIds.map(find)).size;
}
