export interface ProfileSource {
	id: string;
	url: string;
	title: string;
	publisher: string;
	retrievedAt: Date;
}

export interface ProfileFact {
	id: string;
	category: string;
	value: string;
}

export interface ProfilePortrait {
	id: string;
	imageUrl: string | null;
	altText: string;
	source: ProfileSource | null;
}

export interface LeaderProfile {
	id: string;
	name: string;
	summary: string;
	leadershipAsOf: string;
	title: string;
	roleKind: string;
	isInterim: boolean;
	portraits: ProfilePortrait[];
	sources: ProfileSource[];
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

export interface PortraitReviewPortrait {
	id: string;
	altText: string;
	width: number;
	height: number;
	displayOrder: number;
}

export interface PortraitReviewLeader {
	id: string;
	name: string;
	title: string;
	roleKind: string;
	isInterim: boolean;
	displayOrder: number;
	portraits: PortraitReviewPortrait[];
}

export interface CompanyPortraitReview {
	companyId: string;
	activeSlateId: string | null;
	leaders: PortraitReviewLeader[];
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
	missingImage: number;
	notReady: number;
	excluded: number;
	percent: number;
	frozenAt: Date | null;
	revision: number;
	comparisons: number;
	coveredCompanies: number;
	minimumAppearances: number;
	connected: boolean;
}
