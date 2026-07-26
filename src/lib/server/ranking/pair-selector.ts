export const MINIMUM_APPEARANCES = 4;

export type PairingPhase = 'connectivity' | 'coverage' | 'adaptive' | 'exploration';

export interface PairingRecord {
	leftSlateId: string;
	rightSlateId: string;
}

export interface PairingRanking {
	slateId: string;
	rank: number;
	strength: number;
}

export interface PairSelectionInput {
	activeSlateIds: readonly string[];
	comparisons: readonly PairingRecord[];
	rankingEntries: readonly PairingRanking[];
	seed: string;
}

export interface PairSelection {
	leftSlateId: string;
	rightSlateId: string;
	phase: PairingPhase;
}

interface SelectionState {
	slateIds: string[];
	appearances: Uint32Array;
	pairCounts: Map<string, number>;
	unionFind: UnionFind;
	rankingByIndex: PairingRanking[];
	rankedIndexes: number[];
	coverageCompletionIndex: number | null;
}

/**
 * Chooses the next ordered presentation. Input comparisons must be in
 * chronological order so the tenth post-coverage exploration can be derived.
 */
export function selectPair(input: PairSelectionInput): PairSelection | null {
	const state = buildSelectionState(input);
	const { slateIds, unionFind, appearances } = state;

	if (slateIds.length < 2) return null;

	let selected: [number, number];
	let phase: PairingPhase;

	if (unionFind.componentCount > 1) {
		selected = selectConnectivityPair(state, input.seed, input.comparisons.length);
		phase = 'connectivity';
	} else if (appearances.some((appearance) => appearance < MINIMUM_APPEARANCES)) {
		selected = selectCoveragePair(state, input.seed, input.comparisons.length);
		phase = 'coverage';
	} else {
		const completedPostCoverageSelections =
			state.coverageCompletionIndex === null
				? 0
				: input.comparisons.length - state.coverageCompletionIndex - 1;
		const shouldExplore = (completedPostCoverageSelections + 1) % 10 === 0;

		if (shouldExplore) {
			selected = selectExplorationPair(state, input.seed, input.comparisons.length);
			phase = 'exploration';
		} else {
			selected = selectAdaptivePair(state, input.seed, input.comparisons.length);
			phase = 'adaptive';
		}
	}

	return orientPair(selected, phase, state, input.seed, input.comparisons.length);
}

function buildSelectionState(input: PairSelectionInput): SelectionState {
	if (typeof input.seed !== 'string' || input.seed.length === 0) {
		throw new Error('Pairing seed must be a non-empty string');
	}

	const slateIds = validateAndSortSlateIds(input.activeSlateIds);
	const indexes = new Map(slateIds.map((slateId, index) => [slateId, index]));
	const appearances = new Uint32Array(slateIds.length);
	const pairCounts = new Map<string, number>();
	const unionFind = new UnionFind(slateIds.length);
	let coverageCompletionIndex: number | null = null;
	let belowMinimum = slateIds.length;

	for (const [comparisonIndex, comparison] of input.comparisons.entries()) {
		const [leftIndex, rightIndex] = validatePairingRecord(comparison, comparisonIndex, indexes);
		const leftBefore = appearances[leftIndex];
		const rightBefore = appearances[rightIndex];

		appearances[leftIndex] += 1;
		appearances[rightIndex] += 1;

		if (leftBefore === MINIMUM_APPEARANCES - 1) belowMinimum -= 1;
		if (rightBefore === MINIMUM_APPEARANCES - 1) belowMinimum -= 1;

		unionFind.union(leftIndex, rightIndex);
		const key = pairKey(leftIndex, rightIndex);
		pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);

		if (
			coverageCompletionIndex === null &&
			slateIds.length >= 2 &&
			unionFind.componentCount === 1 &&
			belowMinimum === 0
		) {
			coverageCompletionIndex = comparisonIndex;
		}
	}

	const rankingByIndex = validateRankingEntries(input.rankingEntries, slateIds, indexes);
	const rankedIndexes = slateIds
		.map((_, index) => index)
		.sort((first, second) => {
			const rankOrder = rankingByIndex[first].rank - rankingByIndex[second].rank;
			return rankOrder === 0 ? compareStrings(slateIds[first], slateIds[second]) : rankOrder;
		});

	return {
		slateIds,
		appearances,
		pairCounts,
		unionFind,
		rankingByIndex,
		rankedIndexes,
		coverageCompletionIndex
	};
}

function selectConnectivityPair(
	state: SelectionState,
	seed: string,
	selectionIndex: number
): [number, number] {
	const components = new Map<number, number[]>();

	for (let index = 0; index < state.slateIds.length; index += 1) {
		const root = state.unionFind.find(index);
		const members = components.get(root);
		if (members) members.push(index);
		else components.set(root, [index]);
	}

	const representatives = [...components.values()].map((members) =>
		members.reduce((best, candidate) =>
			compareItemsByExposure(best, candidate, state, seed, selectionIndex, 'connectivity') <= 0
				? best
				: candidate
		)
	);

	representatives.sort((first, second) =>
		compareItemsByExposure(first, second, state, seed, selectionIndex, 'component')
	);

	return [representatives[0], representatives[1]];
}

function selectCoveragePair(
	state: SelectionState,
	seed: string,
	selectionIndex: number
): [number, number] {
	const undercovered = state.slateIds
		.map((_, index) => index)
		.filter((index) => state.appearances[index] < MINIMUM_APPEARANCES)
		.sort((first, second) =>
			compareItemsByExposure(first, second, state, seed, selectionIndex, 'coverage-anchor')
		);

	for (const anchor of undercovered) {
		const unseenPartners = state.slateIds
			.map((_, index) => index)
			.filter((candidate) => candidate !== anchor && getPairCount(state, anchor, candidate) === 0);

		if (unseenPartners.length > 0) {
			unseenPartners.sort((first, second) => {
				const firstCovered = state.appearances[first] >= MINIMUM_APPEARANCES ? 1 : 0;
				const secondCovered = state.appearances[second] >= MINIMUM_APPEARANCES ? 1 : 0;
				if (firstCovered !== secondCovered) return firstCovered - secondCovered;

				return compareItemsByExposure(
					first,
					second,
					state,
					seed,
					selectionIndex,
					`coverage-partner:${anchor}`
				);
			});

			return [anchor, unseenPartners[0]];
		}
	}

	// A repeat is necessary when every undercovered slate has met every peer.
	const anchor = undercovered[0];
	const partners = state.slateIds
		.map((_, index) => index)
		.filter((candidate) => candidate !== anchor)
		.sort((first, second) => {
			const countOrder = getPairCount(state, anchor, first) - getPairCount(state, anchor, second);
			if (countOrder !== 0) return countOrder;

			return compareItemsByExposure(
				first,
				second,
				state,
				seed,
				selectionIndex,
				`coverage-repeat:${anchor}`
			);
		});

	return [anchor, partners[0]];
}

function selectAdaptivePair(
	state: SelectionState,
	seed: string,
	selectionIndex: number
): [number, number] {
	const anchors = state.slateIds
		.map((_, index) => index)
		.sort((first, second) =>
			compareItemsByExposure(first, second, state, seed, selectionIndex, 'adaptive-anchor')
		);

	for (const anchor of anchors) {
		const unseenPartners = state.slateIds
			.map((_, index) => index)
			.filter((candidate) => candidate !== anchor && getPairCount(state, anchor, candidate) === 0);

		if (unseenPartners.length > 0) {
			unseenPartners.sort((first, second) =>
				compareAdaptivePartners(anchor, first, second, state, seed, selectionIndex)
			);
			return [anchor, unseenPartners[0]];
		}
	}

	// All unordered pairs have been seen. Prefer the least-used close matchup.
	const anchor = anchors[0];
	const partners = state.slateIds
		.map((_, index) => index)
		.filter((candidate) => candidate !== anchor)
		.sort((first, second) => {
			const countOrder = getPairCount(state, anchor, first) - getPairCount(state, anchor, second);
			if (countOrder !== 0) return countOrder;
			return compareAdaptivePartners(anchor, first, second, state, seed, selectionIndex);
		});

	return [anchor, partners[0]];
}

function selectExplorationPair(
	state: SelectionState,
	seed: string,
	selectionIndex: number
): [number, number] {
	const ranked = state.rankedIndexes;

	// Search widest rank gaps first without materializing all O(n²) pairs.
	for (let gap = ranked.length - 1; gap >= 1; gap -= 1) {
		const candidates: [number, number][] = [];

		for (let firstPosition = 0; firstPosition < ranked.length - gap; firstPosition += 1) {
			const secondPosition = firstPosition + gap;
			const first = ranked[firstPosition];
			const second = ranked[secondPosition];
			if (getPairCount(state, first, second) === 0) candidates.push([first, second]);
		}

		if (candidates.length > 0) {
			candidates.sort((first, second) =>
				compareExplorationPairs(first, second, state, seed, selectionIndex)
			);
			return candidates[0];
		}
	}

	// Every unordered pair has been seen; rotate through the least-repeated one.
	let best: [number, number] | null = null;
	let bestGap = -1;

	for (let firstPosition = 0; firstPosition < ranked.length - 1; firstPosition += 1) {
		for (
			let secondPosition = firstPosition + 1;
			secondPosition < ranked.length;
			secondPosition += 1
		) {
			const candidate: [number, number] = [ranked[firstPosition], ranked[secondPosition]];
			const candidateGap = secondPosition - firstPosition;

			if (best === null) {
				best = candidate;
				bestGap = candidateGap;
				continue;
			}

			const countOrder =
				getPairCount(state, candidate[0], candidate[1]) - getPairCount(state, best[0], best[1]);
			if (countOrder < 0) {
				best = candidate;
				bestGap = candidateGap;
				continue;
			}
			if (countOrder > 0) continue;

			if (
				candidateGap > bestGap ||
				(candidateGap === bestGap &&
					compareExplorationPairs(candidate, best, state, seed, selectionIndex) < 0)
			) {
				best = candidate;
				bestGap = candidateGap;
			}
		}
	}

	if (best === null) {
		throw new Error('Unable to select an exploration pair');
	}

	return best;
}

function compareAdaptivePartners(
	anchor: number,
	first: number,
	second: number,
	state: SelectionState,
	seed: string,
	selectionIndex: number
): number {
	const anchorRanking = state.rankingByIndex[anchor];
	const firstRanking = state.rankingByIndex[first];
	const secondRanking = state.rankingByIndex[second];
	const firstDistance = Math.abs(
		Math.log(anchorRanking.strength) - Math.log(firstRanking.strength)
	);
	const secondDistance = Math.abs(
		Math.log(anchorRanking.strength) - Math.log(secondRanking.strength)
	);

	if (firstDistance !== secondDistance) return firstDistance - secondDistance;

	const exposureOrder = state.appearances[first] - state.appearances[second];
	if (exposureOrder !== 0) return exposureOrder;

	const firstRankDistance = Math.abs(anchorRanking.rank - firstRanking.rank);
	const secondRankDistance = Math.abs(anchorRanking.rank - secondRanking.rank);
	if (firstRankDistance !== secondRankDistance) return firstRankDistance - secondRankDistance;

	return compareSeeded(
		state.slateIds[first],
		state.slateIds[second],
		seed,
		selectionIndex,
		`adaptive-partner:${state.slateIds[anchor]}`
	);
}

function compareExplorationPairs(
	first: [number, number],
	second: [number, number],
	state: SelectionState,
	seed: string,
	selectionIndex: number
): number {
	const firstTotal = state.appearances[first[0]] + state.appearances[first[1]];
	const secondTotal = state.appearances[second[0]] + state.appearances[second[1]];
	if (firstTotal !== secondTotal) return firstTotal - secondTotal;

	const firstMaximum = Math.max(state.appearances[first[0]], state.appearances[first[1]]);
	const secondMaximum = Math.max(state.appearances[second[0]], state.appearances[second[1]]);
	if (firstMaximum !== secondMaximum) return firstMaximum - secondMaximum;

	return compareSeeded(
		pairId(state, first[0], first[1]),
		pairId(state, second[0], second[1]),
		seed,
		selectionIndex,
		'exploration-pair'
	);
}

function compareItemsByExposure(
	first: number,
	second: number,
	state: SelectionState,
	seed: string,
	selectionIndex: number,
	scope: string
): number {
	const exposureOrder = state.appearances[first] - state.appearances[second];
	if (exposureOrder !== 0) return exposureOrder;

	return compareSeeded(state.slateIds[first], state.slateIds[second], seed, selectionIndex, scope);
}

function orientPair(
	pair: [number, number],
	phase: PairingPhase,
	state: SelectionState,
	seed: string,
	selectionIndex: number
): PairSelection {
	const [first, second] = pair;
	const shouldSwap =
		stableHash(
			JSON.stringify([seed, selectionIndex, phase, pairId(state, first, second), 'side'])
		) %
			2 ===
		1;
	const left = shouldSwap ? second : first;
	const right = shouldSwap ? first : second;

	return {
		leftSlateId: state.slateIds[left],
		rightSlateId: state.slateIds[right],
		phase
	};
}

function validateAndSortSlateIds(activeSlateIds: readonly string[]): string[] {
	const seen = new Set<string>();

	for (const [index, slateId] of activeSlateIds.entries()) {
		if (typeof slateId !== 'string' || slateId.length === 0) {
			throw new Error(`Active slate ID at index ${index} must be a non-empty string`);
		}
		if (seen.has(slateId)) throw new Error(`Active slate ID "${slateId}" is duplicated`);
		seen.add(slateId);
	}

	return [...seen].sort(compareStrings);
}

function validatePairingRecord(
	comparison: PairingRecord,
	comparisonIndex: number,
	indexes: ReadonlyMap<string, number>
): [number, number] {
	if (typeof comparison !== 'object' || comparison === null) {
		throw new Error(`Pairing record at index ${comparisonIndex} must be an object`);
	}

	const left = indexes.get(comparison.leftSlateId);
	const right = indexes.get(comparison.rightSlateId);

	if (left === undefined) {
		throw new Error(
			`Pairing record at index ${comparisonIndex} references inactive left slate "${comparison.leftSlateId}"`
		);
	}
	if (right === undefined) {
		throw new Error(
			`Pairing record at index ${comparisonIndex} references inactive right slate "${comparison.rightSlateId}"`
		);
	}
	if (left === right) {
		throw new Error(`Pairing record at index ${comparisonIndex} must contain distinct slates`);
	}

	return [left, right];
}

function validateRankingEntries(
	rankingEntries: readonly PairingRanking[],
	slateIds: readonly string[],
	indexes: ReadonlyMap<string, number>
): PairingRanking[] {
	if (rankingEntries.length !== slateIds.length) {
		throw new Error('Ranking entries must contain every active slate exactly once');
	}

	const byIndex: Array<PairingRanking | undefined> = new Array(slateIds.length);
	const ranks = new Set<number>();

	for (const [entryIndex, entry] of rankingEntries.entries()) {
		if (typeof entry !== 'object' || entry === null) {
			throw new Error(`Ranking entry at index ${entryIndex} must be an object`);
		}

		const index = indexes.get(entry.slateId);
		if (index === undefined) {
			throw new Error(`Ranking entry at index ${entryIndex} references an inactive slate`);
		}
		if (byIndex[index] !== undefined) {
			throw new Error(`Ranking entry for "${entry.slateId}" is duplicated`);
		}
		if (!Number.isInteger(entry.rank) || entry.rank < 1 || ranks.has(entry.rank)) {
			throw new Error(`Ranking entry for "${entry.slateId}" must have a unique positive rank`);
		}
		if (!Number.isFinite(entry.strength) || entry.strength <= 0) {
			throw new Error(`Ranking entry for "${entry.slateId}" must have a positive finite strength`);
		}

		byIndex[index] = entry;
		ranks.add(entry.rank);
	}

	return byIndex as PairingRanking[];
}

function getPairCount(state: SelectionState, first: number, second: number): number {
	return state.pairCounts.get(pairKey(first, second)) ?? 0;
}

function pairKey(first: number, second: number): string {
	return first < second ? `${first}:${second}` : `${second}:${first}`;
}

function pairId(state: SelectionState, first: number, second: number): string {
	const firstId = state.slateIds[first];
	const secondId = state.slateIds[second];
	return JSON.stringify(firstId < secondId ? [firstId, secondId] : [secondId, firstId]);
}

function compareSeeded(
	first: string,
	second: string,
	seed: string,
	selectionIndex: number,
	scope: string
): number {
	const firstHash = stableHash(JSON.stringify([seed, selectionIndex, scope, first]));
	const secondHash = stableHash(JSON.stringify([seed, selectionIndex, scope, second]));
	if (firstHash !== secondHash) return firstHash - secondHash;
	return compareStrings(first, second);
}

function stableHash(value: string): number {
	let hash = 0x811c9dc5;

	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}

	return hash >>> 0;
}

function compareStrings(first: string, second: string): number {
	if (first < second) return -1;
	if (first > second) return 1;
	return 0;
}

class UnionFind {
	readonly parents: Int32Array;
	readonly sizes: Uint32Array;
	componentCount: number;

	constructor(size: number) {
		this.parents = new Int32Array(size);
		this.sizes = new Uint32Array(size);
		this.componentCount = size;

		for (let index = 0; index < size; index += 1) {
			this.parents[index] = index;
			this.sizes[index] = 1;
		}
	}

	find(index: number): number {
		let root = index;
		while (this.parents[root] !== root) root = this.parents[root];

		while (this.parents[index] !== index) {
			const parent = this.parents[index];
			this.parents[index] = root;
			index = parent;
		}

		return root;
	}

	union(first: number, second: number): void {
		let firstRoot = this.find(first);
		let secondRoot = this.find(second);
		if (firstRoot === secondRoot) return;

		if (this.sizes[firstRoot] < this.sizes[secondRoot]) {
			[firstRoot, secondRoot] = [secondRoot, firstRoot];
		}

		this.parents[secondRoot] = firstRoot;
		this.sizes[firstRoot] += this.sizes[secondRoot];
		this.componentCount -= 1;
	}
}
