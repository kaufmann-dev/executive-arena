export function portraitSearchQuery(input: {
	personName: string;
	title: string;
	companyName: string;
	ticker: string;
}): string {
	return [
		searchTerms(input.personName),
		searchTerms(shortCompanyName(input.companyName)),
		searchTerm(input.ticker),
		conciseExecutiveTitle(input.title)
	]
		.filter(Boolean)
		.join(' ');
}

export function googleImageSearchUrl(query: string): string {
	const url = new URL('https://www.google.com/search');
	url.searchParams.set('tbm', 'isch');
	url.searchParams.set('q', searchTerms(query));
	return url.toString();
}

function shortCompanyName(companyName: string): string {
	const normalized = searchTerms(companyName);
	let shortened = normalized
		.replace(
			/\s+(?:(?:class|series)\s+[a-z0-9-]+\s+)?(?:ordinary shares?|common stocks?|depositary shares?|american depositary shares?|ads)\b.*$/i,
			''
		)
		.trim();

	for (let previous = ''; shortened && shortened !== previous;) {
		previous = shortened;
		shortened = shortened
			.replace(
				/[,\s]+(?:incorporated|inc|corporation|corp|limited|ltd|plc|p\.?l\.?c\.?|llc)\.?$/i,
				''
			)
			.replace(/[,\s]+holdings?$/i, '')
			.trim();
	}

	return shortened || normalized;
}

function conciseExecutiveTitle(title: string): string {
	if (/\bchief executive\b|\bceo\b/i.test(title)) return 'CEO';
	if (/\bpresident\b/i.test(title)) return 'President';
	if (/\bexecutive chair(?:man|woman|person)?\b/i.test(title)) return 'Executive Chair';
	if (/\bmanaging director\b/i.test(title)) return 'Managing Director';
	return 'executive';
}

function searchTerms(value: string): string {
	return value.replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim();
}

function searchTerm(value: string): string {
	return value.replace(/[^\p{L}\p{N}._-]/gu, '').trim();
}
