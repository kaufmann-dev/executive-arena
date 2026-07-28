import { z } from 'zod';

export const COMPANY_EXCLUSION_REASONS = [
	'blank_check_or_shell_company',
	'executive_profile_incomplete',
	'overlapping_executive_coverage'
] as const;

export const UNIVERSE_EXCLUSION_REASONS = ['blank_check_or_shell_company'] as const;

export const MANUAL_EXCLUSION_REASONS = COMPANY_EXCLUSION_REASONS;

export const companyExclusionReasonSchema = z.enum(COMPANY_EXCLUSION_REASONS);
export const universeCompanyExclusionReasonSchema = z.enum(UNIVERSE_EXCLUSION_REASONS);
export const manualCompanyExclusionReasonSchema = z.enum(MANUAL_EXCLUSION_REASONS);

export type CompanyExclusionReason = z.infer<typeof companyExclusionReasonSchema>;
export type UniverseExclusionReason = z.infer<typeof universeCompanyExclusionReasonSchema>;
export type ManualExclusionReason = z.infer<typeof manualCompanyExclusionReasonSchema>;

export const COMPANY_EXCLUSION_REASON_LABELS: Readonly<Record<CompanyExclusionReason, string>> = {
	blank_check_or_shell_company: 'Blank-check or non-operating shell company',
	executive_profile_incomplete: 'Executive profile incomplete',
	overlapping_executive_coverage: 'Overlapping executive coverage'
};

export function companyExclusionReasonLabel(reason: CompanyExclusionReason): string {
	return COMPANY_EXCLUSION_REASON_LABELS[reason];
}
