import { describe, expect, it } from 'vitest';
import {
	BRADLEY_TERRY_MAX_ITERATIONS,
	fitBradleyTerry,
	type ComparisonOutcome
} from './bradley-terry';

describe('fitBradleyTerry', () => {
	it('recovers ordered synthetic strengths anchored around the neutral baseline', () => {
		const expectedStrengths = new Map([
			['very-low', 0.25],
			['low', 0.5],
			['neutral', 1],
			['high', 2],
			['very-high', 4]
		]);
		const slateIds = [...expectedStrengths.keys()];
		const outcomes: ComparisonOutcome[] = [];

		for (let first = 0; first < slateIds.length; first += 1) {
			for (let second = first + 1; second < slateIds.length; second += 1) {
				const firstId = slateIds[first];
				const secondId = slateIds[second];
				const firstStrength = expectedStrengths.get(firstId)!;
				const secondStrength = expectedStrengths.get(secondId)!;
				const comparisonCount = 400;
				const firstWins = Math.round(
					comparisonCount * (firstStrength / (firstStrength + secondStrength))
				);

				for (let index = 0; index < comparisonCount; index += 1) {
					outcomes.push({
						leftSlateId: firstId,
						rightSlateId: secondId,
						winnerSlateId: index < firstWins ? firstId : secondId
					});
				}
			}
		}

		const result = fitBradleyTerry(slateIds, outcomes);
		const fitted = new Map(result.entries.map((entry) => [entry.slateId, entry]));

		expect(result.converged).toBe(true);
		expect(result.iterations).toBeLessThan(BRADLEY_TERRY_MAX_ITERATIONS);
		expect(result.comparisonCount).toBe(outcomes.length);
		expect(result.entries.map((entry) => entry.slateId)).toEqual([
			'very-high',
			'high',
			'neutral',
			'low',
			'very-low'
		]);

		for (const [slateId, expected] of expectedStrengths) {
			expect(fitted.get(slateId)?.strength).toBeCloseTo(expected, 1);
		}
	});

	it('keeps sparse, undefeated, winless, and unseen slates finite', () => {
		const outcomes: ComparisonOutcome[] = [
			...Array.from({ length: 20 }, () => ({
				leftSlateId: 'undefeated',
				rightSlateId: 'winless',
				winnerSlateId: 'undefeated'
			})),
			{
				leftSlateId: 'undefeated',
				rightSlateId: 'sparse',
				winnerSlateId: 'undefeated'
			}
		];

		const result = fitBradleyTerry(['unseen', 'winless', 'undefeated', 'sparse'], outcomes);
		const entries = new Map(result.entries.map((entry) => [entry.slateId, entry]));

		expect(result.converged).toBe(true);
		expect(entries.get('undefeated')).toMatchObject({
			wins: 21,
			losses: 0,
			comparisonCount: 21
		});
		expect(entries.get('winless')).toMatchObject({
			wins: 0,
			losses: 20,
			comparisonCount: 20
		});
		expect(entries.get('unseen')).toMatchObject({
			wins: 0,
			losses: 0,
			comparisonCount: 0
		});
		expect(entries.get('unseen')?.strength).toBeCloseTo(1, 8);
		expect(entries.get('unseen')?.score).toBeCloseTo(50, 7);

		for (const entry of result.entries) {
			expect(Number.isFinite(entry.strength)).toBe(true);
			expect(entry.strength).toBeGreaterThan(0);
			expect(entry.score).toBeGreaterThan(0);
			expect(entry.score).toBeLessThan(100);
		}
	});

	it('is deterministic regardless of active ID and outcome order', () => {
		const outcomes: ComparisonOutcome[] = [
			{ leftSlateId: 'b', rightSlateId: 'a', winnerSlateId: 'b' },
			{ leftSlateId: 'c', rightSlateId: 'b', winnerSlateId: 'c' },
			{ leftSlateId: 'a', rightSlateId: 'c', winnerSlateId: 'c' },
			{ leftSlateId: 'a', rightSlateId: 'b', winnerSlateId: 'a' }
		];

		const first = fitBradleyTerry(['c', 'a', 'b'], outcomes);
		const second = fitBradleyTerry(['b', 'c', 'a'], [...outcomes].reverse());

		expect(second).toEqual(first);
	});

	it('breaks equal-strength ranks by slate ID', () => {
		const result = fitBradleyTerry(['zeta', 'alpha', 'middle'], []);

		expect(result).toMatchObject({
			comparisonCount: 0,
			iterations: 1,
			converged: true,
			maxDelta: 0
		});
		expect(
			result.entries.map(({ slateId, rank, strength, score }) => ({
				slateId,
				rank,
				strength,
				score
			}))
		).toEqual([
			{ slateId: 'alpha', rank: 1, strength: 1, score: 50 },
			{ slateId: 'middle', rank: 2, strength: 1, score: 50 },
			{ slateId: 'zeta', rank: 3, strength: 1, score: 50 }
		]);
	});

	it('rejects malformed or inactive outcomes', () => {
		expect(() =>
			fitBradleyTerry(['a', 'b'], [{ leftSlateId: 'a', rightSlateId: 'a', winnerSlateId: 'a' }])
		).toThrow('distinct');
		expect(() =>
			fitBradleyTerry(
				['a', 'b'],
				[{ leftSlateId: 'a', rightSlateId: 'b', winnerSlateId: 'outside' }]
			)
		).toThrow('winner');
		expect(() =>
			fitBradleyTerry(
				['a', 'b'],
				[{ leftSlateId: 'a', rightSlateId: 'inactive', winnerSlateId: 'a' }]
			)
		).toThrow('inactive right');
		expect(() => fitBradleyTerry(['duplicate', 'duplicate'], [])).toThrow('duplicated');
	});
});
