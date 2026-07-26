export interface ProfileSource {
	id: string;
	url: string;
	title: string;
	publisher: string;
	kind: string;
	retrievedAt: Date;
}

export interface ProfileFact {
	id: string;
	category: string;
	value: string;
	sources: ProfileSource[];
}

export interface LeaderProfile {
	id: string;
	name: string;
	summary: string;
	leadershipAsOf: string;
	title: string;
	roleKind: string;
	isInterim: boolean;
	portraitId: string;
	portraitImageUrl: string;
	portraitAltText: string;
	portraitSource: ProfileSource;
	summarySources: ProfileSource[];
	roleSources: ProfileSource[];
	facts: ProfileFact[];
}

export interface LeadershipCard {
	companyId: string;
	slateId: string;
	companyName: string;
	ticker: string;
	description: string;
	homepageUrl: string | null;
	marketCap: number | null;
	effectiveAt: string;
	leaders: LeaderProfile[];
}

export interface LeaderboardRow {
	companyId: string;
	slateId: string;
	rank: number;
	companyName: string;
	ticker: string;
	leaderNames: string[];
	score: number;
	wins: number;
	losses: number;
	comparisonCount: number;
}

export interface ReadinessSummary {
	total: number;
	ready: number;
	pending: number;
	excluded: number;
	needsReview: number;
	percent: number;
	frozenAt: Date | null;
	revision: number;
	comparisons: number;
	coveredCompanies: number;
	minimumAppearances: number;
	connected: boolean;
}
