const exactLabels: Readonly<Record<string, string>> = {
	blank_check_description: 'Blank-check company description',
	ceo: 'CEO',
	co_ceo: 'Co-CEO',
	other_notable: 'Other notable',
	sic_6770: 'SIC 6770 blank-check classification'
};

export function formatDataLabel(value: string): string {
	const exact = exactLabels[value];
	if (exact) return exact;
	if (!value.includes('_')) return value;
	const label = value.replaceAll('_', ' ');
	return `${label.charAt(0).toLocaleUpperCase('en-US')}${label.slice(1)}`;
}

export function formatReadinessLabel(value: 'not_ready' | 'ready' | 'excluded'): string {
	return value.replace('_', ' ');
}
