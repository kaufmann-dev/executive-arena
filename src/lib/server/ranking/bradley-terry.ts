export const BRADLEY_TERRY_TOLERANCE = 1e-9;
export const BRADLEY_TERRY_MAX_ITERATIONS = 1_000;

export interface ComparisonOutcome {
	leftSlateId: string;
	rightSlateId: string;
	winnerSlateId: string;
}

export interface BradleyTerryEntry {
	slateId: string;
	rank: number;
	strength: number;
	score: number;
	wins: number;
	losses: number;
	comparisonCount: number;
}

export interface BradleyTerryFit {
	entries: BradleyTerryEntry[];
	comparisonCount: number;
	iterations: number;
	converged: boolean;
	maxDelta: number;
}

interface PairCount {
	first: number;
	second: number;
	count: number;
}

/**
 * Fits a Bradley–Terry model with one weak, balanced comparison against a
 * fixed strength-1 baseline for each active slate.
 */
export function fitBradleyTerry(
	activeSlateIds: readonly string[],
	outcomes: readonly ComparisonOutcome[]
): BradleyTerryFit {
	const slateIds = validateAndSortSlateIds(activeSlateIds);

	if (slateIds.length === 0) {
		if (outcomes.length !== 0) {
			throw new Error('Cannot fit outcomes without active slates');
		}

		return {
			entries: [],
			comparisonCount: 0,
			iterations: 0,
			converged: true,
			maxDelta: 0
		};
	}

	const indexes = new Map(slateIds.map((slateId, index) => [slateId, index]));
	const wins = new Uint32Array(slateIds.length);
	const losses = new Uint32Array(slateIds.length);
	const pairCounts = new Map<string, PairCount>();

	for (const [outcomeIndex, outcome] of outcomes.entries()) {
		const { leftIndex, rightIndex, winnerIndex } = validateOutcome(outcome, outcomeIndex, indexes);
		const loserIndex = winnerIndex === leftIndex ? rightIndex : leftIndex;

		wins[winnerIndex] += 1;
		losses[loserIndex] += 1;

		const first = Math.min(leftIndex, rightIndex);
		const second = Math.max(leftIndex, rightIndex);
		const key = `${first}:${second}`;
		const pairCount = pairCounts.get(key);

		if (pairCount) {
			pairCount.count += 1;
		} else {
			pairCounts.set(key, { first, second, count: 1 });
		}
	}
	const orderedPairCounts = [...pairCounts.values()].sort(
		(first, second) => first.first - second.first || first.second - second.second
	);

	let strengths = new Float64Array(slateIds.length);
	strengths.fill(1);
	let iterations = 0;
	let converged = false;
	let maxDelta = 0;

	for (let iteration = 1; iteration <= BRADLEY_TERRY_MAX_ITERATIONS; iteration += 1) {
		const denominators = new Float64Array(slateIds.length);

		for (let index = 0; index < strengths.length; index += 1) {
			// One virtual comparison against the fixed neutral item.
			denominators[index] = 1 / (strengths[index] + 1);
		}

		for (const pair of orderedPairCounts) {
			const contribution = pair.count / (strengths[pair.first] + strengths[pair.second]);
			denominators[pair.first] += contribution;
			denominators[pair.second] += contribution;
		}

		const nextStrengths = new Float64Array(slateIds.length);

		for (let index = 0; index < strengths.length; index += 1) {
			// The virtual result contributes half a win and half a loss.
			const nextStrength = (wins[index] + 0.5) / denominators[index];

			if (!Number.isFinite(nextStrength) || nextStrength <= 0) {
				throw new Error(`Bradley–Terry fit produced an invalid strength for "${slateIds[index]}"`);
			}

			nextStrengths[index] = nextStrength;
		}

		// Real Bradley–Terry comparisons are invariant to a common scale.
		// Maximize that scale exactly for the fixed neutral pseudo-results; this
		// removes the otherwise very slow scale drift of a weakly anchored MM fit.
		rescaleForNeutralBaseline(nextStrengths);
		maxDelta = 0;

		for (let index = 0; index < strengths.length; index += 1) {
			maxDelta = Math.max(
				maxDelta,
				Math.abs(Math.log(nextStrengths[index]) - Math.log(strengths[index]))
			);
		}

		strengths = nextStrengths;
		iterations = iteration;

		if (maxDelta < BRADLEY_TERRY_TOLERANCE) {
			converged = true;
			break;
		}
	}

	const entries = slateIds
		.map((slateId, index) => {
			const strength = strengths[index];

			return {
				slateId,
				rank: 0,
				strength,
				score: 100 * (strength / (1 + strength)),
				wins: wins[index],
				losses: losses[index],
				comparisonCount: wins[index] + losses[index]
			};
		})
		.sort((first, second) => {
			const strengthOrder = second.strength - first.strength;
			return strengthOrder === 0 ? compareStrings(first.slateId, second.slateId) : strengthOrder;
		})
		.map((entry, index) => ({ ...entry, rank: index + 1 }));

	return {
		entries,
		comparisonCount: outcomes.length,
		iterations,
		converged,
		maxDelta
	};
}

function rescaleForNeutralBaseline(strengths: Float64Array): void {
	const logStrengths = Array.from(strengths, Math.log);
	let low = -Math.max(...logStrengths) - 40;
	let high = -Math.min(...logStrengths) + 40;
	let logScale = 0;

	// Solve sum_i s_i/(1+s_i) = n/2, the exact optimum for the
	// half-win/half-loss observations against the fixed strength-1 item.
	for (let iteration = 0; iteration < 50; iteration += 1) {
		let probabilitySum = 0;
		let derivative = 0;

		for (const logStrength of logStrengths) {
			const probability = logistic(logStrength + logScale);
			probabilitySum += probability;
			derivative += probability * (1 - probability);
		}

		const error = probabilitySum - strengths.length / 2;
		if (Math.abs(error) <= strengths.length * 1e-14) break;

		if (error < 0) low = logScale;
		else high = logScale;

		const newtonCandidate = logScale - error / derivative;
		logScale =
			Number.isFinite(newtonCandidate) && newtonCandidate > low && newtonCandidate < high
				? newtonCandidate
				: (low + high) / 2;
	}

	for (let index = 0; index < strengths.length; index += 1) {
		const strength = Math.exp(logStrengths[index] + logScale);
		if (!Number.isFinite(strength) || strength <= 0) {
			throw new Error('Bradley–Terry fit exceeded the numeric strength range');
		}
		strengths[index] = strength;
	}
}

function logistic(value: number): number {
	if (value >= 0) {
		const inverse = Math.exp(-value);
		return 1 / (1 + inverse);
	}

	const exponential = Math.exp(value);
	return exponential / (1 + exponential);
}

function validateAndSortSlateIds(activeSlateIds: readonly string[]): string[] {
	const seen = new Set<string>();

	for (const [index, slateId] of activeSlateIds.entries()) {
		if (typeof slateId !== 'string' || slateId.length === 0) {
			throw new Error(`Active slate ID at index ${index} must be a non-empty string`);
		}

		if (seen.has(slateId)) {
			throw new Error(`Active slate ID "${slateId}" is duplicated`);
		}

		seen.add(slateId);
	}

	return [...seen].sort(compareStrings);
}

function validateOutcome(
	outcome: ComparisonOutcome,
	outcomeIndex: number,
	indexes: ReadonlyMap<string, number>
): { leftIndex: number; rightIndex: number; winnerIndex: number } {
	if (typeof outcome !== 'object' || outcome === null) {
		throw new Error(`Outcome at index ${outcomeIndex} must be an object`);
	}

	const { leftSlateId, rightSlateId, winnerSlateId } = outcome;
	const leftIndex = indexes.get(leftSlateId);
	const rightIndex = indexes.get(rightSlateId);
	const winnerIndex = indexes.get(winnerSlateId);

	if (leftIndex === undefined) {
		throw new Error(
			`Outcome at index ${outcomeIndex} references inactive left slate "${leftSlateId}"`
		);
	}

	if (rightIndex === undefined) {
		throw new Error(
			`Outcome at index ${outcomeIndex} references inactive right slate "${rightSlateId}"`
		);
	}

	if (leftIndex === rightIndex) {
		throw new Error(`Outcome at index ${outcomeIndex} must compare two distinct slates`);
	}

	if (winnerIndex === undefined || (winnerIndex !== leftIndex && winnerIndex !== rightIndex)) {
		throw new Error(`Outcome at index ${outcomeIndex} winner must be one of the presented slates`);
	}

	return { leftIndex, rightIndex, winnerIndex };
}

function compareStrings(first: string, second: string): number {
	if (first < second) return -1;
	if (first > second) return 1;
	return 0;
}
