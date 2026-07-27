import type { ExecutiveProfile, ResearchSource } from './schemas';

export function collectProfileSources(profile: ExecutiveProfile): ResearchSource[] {
	const sources = profile.leaders.flatMap((leader) => [
		...leader.sources,
		...leader.portraits.flatMap((portrait) => (portrait.source ? [portrait.source] : []))
	]);
	return [...new Map(sources.map((source) => [source.url, source])).values()].sort((left, right) =>
		left.url.localeCompare(right.url, 'en-US')
	);
}
