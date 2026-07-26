import type { ExecutiveProfile, ResearchSource } from './schemas';

export function collectProfileSources(profile: ExecutiveProfile): ResearchSource[] {
	const sources = profile.leaders.flatMap((leader) => [
		leader.role_source,
		leader.portrait.source,
		...leader.summary_sources,
		...leader.facts.flatMap((fact) => fact.sources)
	]);
	return [...new Map(sources.map((source) => [source.url, source])).values()].sort((left, right) =>
		left.url.localeCompare(right.url, 'en-US')
	);
}
