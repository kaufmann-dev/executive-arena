import { z } from 'zod';
import {
	executiveProfileSchema,
	executiveReviewArtifactSchema,
	type ExecutiveProfile,
	type ExecutiveReviewArtifact,
	type ResearchSource
} from './schemas';
import { researchTaskSchema, type ResearchTask } from './tasks';

export interface ValidationSuccess {
	success: true;
	profile: ExecutiveProfile;
}

export interface ValidationFailure {
	success: false;
	errors: string[];
}

export type ProfileValidationResult = ValidationSuccess | ValidationFailure;

export interface LabeledProfileInput {
	label: string;
	value: unknown;
}

export interface ProfileCoverageIssue {
	label: string;
	errors: string[];
}

export interface ProfileCoverageResult {
	exact: boolean;
	expected: number;
	valid: number;
	invalid: ProfileCoverageIssue[];
	needsReview: ProfileCoverageIssue[];
	missing: string[];
	duplicates: ProfileCoverageIssue[];
	unexpected: ProfileCoverageIssue[];
}

export function validateExecutiveProfile(value: unknown): ProfileValidationResult {
	const result = executiveProfileSchema.safeParse(value);
	if (result.success) return { success: true, profile: result.data };
	return { success: false, errors: formatZodIssues(result.error) };
}

export function parseExecutiveProfile(value: unknown): ExecutiveProfile {
	return executiveProfileSchema.parse(value);
}

export function validateProfileForTask(
	value: unknown,
	taskValue: unknown
): ProfileValidationResult {
	const profileResult = executiveProfileSchema.safeParse(value);
	if (!profileResult.success) {
		return { success: false, errors: formatZodIssues(profileResult.error) };
	}

	const taskResult = researchTaskSchema.safeParse(taskValue);
	if (!taskResult.success) {
		return {
			success: false,
			errors: formatZodIssues(taskResult.error, 'task')
		};
	}

	const errors = compareProfileToTask(profileResult.data, taskResult.data);
	if (errors.length > 0) return { success: false, errors };
	return { success: true, profile: profileResult.data };
}

export function validateProfileCoverage(
	inputs: readonly LabeledProfileInput[],
	tasks: readonly ResearchTask[]
): ProfileCoverageResult {
	const expected = new Map<string, ResearchTask>();
	for (const taskValue of tasks) {
		const task = researchTaskSchema.parse(taskValue);
		if (expected.has(task.issuer_key)) {
			throw new Error(
				`Research task manifest repeats issuer_key ${JSON.stringify(task.issuer_key)}`
			);
		}
		expected.set(task.issuer_key, task);
	}

	const encountered = new Map<string, string>();
	const valid = new Set<string>();
	const invalid: ProfileCoverageIssue[] = [];
	const needsReview: ProfileCoverageIssue[] = [];
	const duplicates: ProfileCoverageIssue[] = [];
	const unexpected: ProfileCoverageIssue[] = [];

	for (const input of inputs) {
		const review = executiveReviewArtifactSchema.safeParse(input.value);
		const parsed = executiveProfileSchema.safeParse(input.value);
		let record: ExecutiveProfile | ExecutiveReviewArtifact;
		if (review.success) {
			record = review.data;
		} else if (parsed.success) {
			record = parsed.data;
		} else {
			const looksLikeReview =
				typeof input.value === 'object' &&
				input.value !== null &&
				'status' in input.value &&
				input.value.status === 'needs_review';
			invalid.push({
				label: input.label,
				errors: formatZodIssues(looksLikeReview ? review.error : parsed.error)
			});
			continue;
		}

		const issuerKey = record.issuer_key;
		const firstLabel = encountered.get(issuerKey);
		if (firstLabel) {
			valid.delete(issuerKey);
			duplicates.push({
				label: input.label,
				errors: [
					`issuer_key ${JSON.stringify(issuerKey)} is duplicated; first seen in ${firstLabel}`
				]
			});
			continue;
		}
		encountered.set(issuerKey, input.label);

		const task = expected.get(issuerKey);
		if (!task) {
			unexpected.push({
				label: input.label,
				errors: [`issuer_key ${JSON.stringify(issuerKey)} is not present in the task manifest`]
			});
			continue;
		}

		const identityErrors = compareIdentityToTask(record, task);
		if (identityErrors.length > 0) {
			invalid.push({ label: input.label, errors: identityErrors });
			continue;
		}
		if ('status' in record) {
			needsReview.push({
				label: input.label,
				errors: record.reasons.map((reason) => `manual review required: ${reason}`)
			});
			continue;
		}
		valid.add(issuerKey);
	}

	const missing = [...expected.keys()]
		.filter((issuerKey) => !encountered.has(issuerKey))
		.sort((left, right) => left.localeCompare(right, 'en-US'));
	const exact =
		valid.size === expected.size &&
		invalid.length === 0 &&
		needsReview.length === 0 &&
		missing.length === 0 &&
		duplicates.length === 0 &&
		unexpected.length === 0;

	return {
		exact,
		expected: expected.size,
		valid: valid.size,
		invalid,
		needsReview,
		missing,
		duplicates,
		unexpected
	};
}

function compareProfileToTask(profile: ExecutiveProfile, task: ResearchTask): string[] {
	return compareIdentityToTask(profile, task);
}

function compareIdentityToTask(
	value: Pick<ExecutiveProfile, 'issuer_key' | 'canonical_ticker' | 'company_name'>,
	task: ResearchTask
): string[] {
	const errors: string[] = [];
	if (value.issuer_key !== task.issuer_key) {
		errors.push(
			`issuer_key: expected ${JSON.stringify(task.issuer_key)}, received ${JSON.stringify(value.issuer_key)}`
		);
	}
	if (value.canonical_ticker !== task.canonical_ticker) {
		errors.push(
			`canonical_ticker: expected ${JSON.stringify(task.canonical_ticker)}, received ${JSON.stringify(value.canonical_ticker)}`
		);
	}
	if (value.company_name !== task.company_name) {
		errors.push(
			`company_name: expected ${JSON.stringify(task.company_name)}, received ${JSON.stringify(value.company_name)}`
		);
	}
	return errors;
}

export function formatZodIssues(error: z.ZodError, prefix?: string): string[] {
	return error.issues.map((issue) => {
		const path = [prefix, ...issue.path.map(String)].filter(Boolean).join('.');
		return `${path || '<root>'}: ${issue.message}`;
	});
}

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
