export type ProfilePublicationStage =
	'company_validation' | 'claim_validation' | 'duplicate_check' | 'profile_import' | 'publication';

export class ProfilePublicationFailure extends Error {
	constructor(
		readonly stage: ProfilePublicationStage,
		readonly companyId: string,
		readonly issuerKey: string,
		cause: unknown
	) {
		super('Executive profile publication failed', { cause });
		this.name = 'ProfilePublicationFailure';
	}
}

export interface DatabaseFailureMetadata {
	code: string | null;
	severity: string | null;
	constraint: string | null;
	schema: string | null;
	table: string | null;
	column: string | null;
	detail: string | null;
	message: string;
}

export function databaseFailureMetadata(cause: unknown): DatabaseFailureMetadata | null {
	const chain = errorCauseChain(cause);
	const drizzleError = chain.some(
		(candidate) =>
			candidate instanceof Error &&
			(candidate.name === 'DrizzleQueryError' || ('query' in candidate && 'params' in candidate))
	);
	const driverError = chain.find(
		(candidate): candidate is Record<string, unknown> & { code: string } =>
			hasDatabaseErrorCode(candidate) &&
			(drizzleError ||
				POSTGRES_SQLSTATE_PATTERN.test(candidate.code) ||
				(candidate instanceof Error && candidate.name === 'PostgresError'))
	);
	if (!driverError && !drizzleError) return null;

	const deepest = chain.at(-1);
	return {
		code: safeIdentifier(driverError?.code),
		severity: safeIdentifier(driverError?.severity),
		constraint: safeIdentifier(driverError?.constraint_name ?? driverError?.constraint),
		schema: safeIdentifier(driverError?.schema_name ?? driverError?.schema),
		table: safeIdentifier(driverError?.table_name ?? driverError?.table),
		column: safeIdentifier(driverError?.column_name ?? driverError?.column),
		detail: sanitizedDatabaseText(driverError?.detail),
		message:
			sanitizedDatabaseText(isRecord(deepest) ? deepest.message : null) ??
			'Database operation failed'
	};
}

export function logProfilePublicationFailure(
	failure: ProfilePublicationFailure,
	report: (line: string) => void = console.error
): void {
	const database = databaseFailureMetadata(failure.cause);
	const deepest = errorCauseChain(failure.cause).at(-1);
	report(
		JSON.stringify({
			event: 'mcp_profile_publication_failed',
			companyId: failure.companyId,
			issuerKey: failure.issuerKey,
			stage: failure.stage,
			errorName: deepest instanceof Error ? deepest.name : 'UnknownError',
			database
		})
	);
}

function errorCauseChain(cause: unknown): unknown[] {
	const chain: unknown[] = [];
	const seen = new Set<unknown>();
	let current = cause;
	while (current !== undefined && current !== null && !seen.has(current) && chain.length < 10) {
		chain.push(current);
		seen.add(current);
		current = isRecord(current) ? current.cause : undefined;
	}
	return chain;
}

function safeIdentifier(value: unknown): string | null {
	return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value) ? value : null;
}

function sanitizedDatabaseText(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	if (/\bparams\s*:|schema_version|"leaders"|"portraits"/i.test(value)) {
		return '[redacted structured database detail]';
	}
	const sanitized = value
		.replace(/https?:\/\/[^\s)]+/gi, (candidate) => sanitizedUrl(candidate))
		.replace(/\beac_[A-Za-z0-9_-]{43}\b/g, '[redacted claim token]')
		.replace(/\bBearer\s+[A-Za-z0-9._~-]+\b/gi, 'Bearer [redacted]')
		.replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted opaque value]')
		.replace(/\s+/g, ' ')
		.trim();
	if (!sanitized) return null;
	return sanitized.length <= 500 ? sanitized : `${sanitized.slice(0, 497)}...`;
}

function sanitizedUrl(value: string): string {
	try {
		const url = new URL(value);
		return `${url.origin}${url.pathname}`;
	} catch {
		return '[redacted URL]';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

const POSTGRES_SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

function hasDatabaseErrorCode(value: unknown): value is Record<string, unknown> & { code: string } {
	return (
		isRecord(value) &&
		typeof value.code === 'string' &&
		value.code.length > 0 &&
		value.code.length <= 64
	);
}
