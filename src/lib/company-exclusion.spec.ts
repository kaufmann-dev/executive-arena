import { describe, expect, it } from 'vitest';
import {
	companyExclusionReasonLabel,
	companyExclusionReasonSchema,
	manualCompanyExclusionReasonSchema,
	universeCompanyExclusionReasonSchema
} from './company-exclusion';

describe('company exclusion reasons', () => {
	it('allows every reason for manual exclusions but only blank-check shells for universe exclusions', () => {
		expect(manualCompanyExclusionReasonSchema.parse('overlapping_executive_coverage')).toBe(
			'overlapping_executive_coverage'
		);
		expect(universeCompanyExclusionReasonSchema.parse('blank_check_or_shell_company')).toBe(
			'blank_check_or_shell_company'
		);
		expect(
			universeCompanyExclusionReasonSchema.safeParse('executive_profile_incomplete').success
		).toBe(false);
		expect(companyExclusionReasonSchema.options).toHaveLength(3);
	});

	it('provides the approved user-facing labels', () => {
		expect(companyExclusionReasonLabel('blank_check_or_shell_company')).toBe(
			'Blank-check or non-operating shell company'
		);
		expect(companyExclusionReasonLabel('executive_profile_incomplete')).toBe(
			'Executive profile incomplete'
		);
		expect(companyExclusionReasonLabel('overlapping_executive_coverage')).toBe(
			'Overlapping executive coverage'
		);
	});
});
