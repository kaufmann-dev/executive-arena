const exactLabels: Readonly<Record<string, string>> = {
	ceo: 'CEO',
	co_ceo: 'Co-CEO',
	other_notable: 'Other notable'
};

export function formatDataLabel(value: string): string {
	const exact = exactLabels[value];
	if (exact) return exact;
	if (!value.includes('_')) return value;
	const label = value.replaceAll('_', ' ');
	return `${label.charAt(0).toLocaleUpperCase('en-US')}${label.slice(1)}`;
}

export function formatReadinessLabel(
	value: 'not_ready' | 'missing_image' | 'ready' | 'excluded'
): string {
	return value.replaceAll('_', ' ');
}
