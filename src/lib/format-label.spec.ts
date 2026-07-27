import { describe, expect, it } from 'vitest';

import { formatReadinessLabel } from './format-label';

describe('formatReadinessLabel', () => {
	it('preserves the lowercase readiness vocabulary', () => {
		expect(formatReadinessLabel('not_ready')).toBe('not ready');
		expect(formatReadinessLabel('ready')).toBe('ready');
		expect(formatReadinessLabel('excluded')).toBe('excluded');
	});
});
