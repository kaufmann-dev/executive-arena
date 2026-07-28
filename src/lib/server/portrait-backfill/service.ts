import { randomUUID } from 'node:crypto';
import { and, asc, eq, exists, gt, or, sql } from 'drizzle-orm';
import {
	downloadAndTransformPortrait,
	PortraitValidationError,
	type PortraitFailureDiagnostic,
	type TransformedPortrait
} from '$lib/research/portrait';
import {
	DuplicatePortraitError,
	savePreparedExecutivePortrait
} from '$lib/server/arena/admin-service';
import { getCompanyCard } from '$lib/server/arena/read-model';
import type { LeadershipCard } from '$lib/server/arena/types';
import { db } from '$lib/server/db';
import {
	company,
	leadershipMember,
	leadershipSlate,
	person,
	portrait,
	portraitIngestAttempt
} from '$lib/server/db/schema';
import type { BravePortraitCandidate } from './brave';

export type PortraitBackfillMode = 'missing' | 'incomplete';

interface PortraitBackfillCursor {
	name: string;
	id: string;
}

export interface PortraitBackfillTarget {
	card: LeadershipCard;
	cursor: string;
}

export interface PortraitIngestResult {
	personId: string;
	portraitId: string;
	usedThumbnailFallback: boolean;
}

export async function getNextPortraitBackfillTarget(
	mode: PortraitBackfillMode,
	cursorValue?: string | null
): Promise<PortraitBackfillTarget | null> {
	const cursor = decodeCursor(cursorValue);
	const normalizedName = sql<string>`lower(${company.name})`;
	const cursorCondition = cursor
		? or(
				gt(normalizedName, cursor.name),
				and(eq(normalizedName, cursor.name), gt(company.id, cursor.id))
			)
		: undefined;
	const [target] = await db
		.select({ id: company.id, name: normalizedName })
		.from(company)
		.where(
			and(eq(company.included, true), activeExecutivePortraitEligibility(mode), cursorCondition)
		)
		.orderBy(asc(normalizedName), asc(company.id))
		.limit(1);
	if (!target) return null;
	const card = await getCompanyCard(target.id);
	if (!card) return null;
	return {
		card,
		cursor: encodeCursor({ name: target.name, id: target.id })
	};
}

export async function isPortraitBackfillCompanyEligible(
	companyId: string,
	mode: PortraitBackfillMode
): Promise<boolean> {
	const [target] = await db
		.select({ id: company.id })
		.from(company)
		.where(
			and(
				eq(company.id, companyId),
				eq(company.included, true),
				activeExecutivePortraitEligibility(mode)
			)
		)
		.limit(1);
	return Boolean(target);
}

export function executiveMatchesBackfillMode(
	portraitCount: number,
	mode: PortraitBackfillMode
): boolean {
	return mode === 'missing' ? portraitCount === 0 : portraitCount < 3;
}

export async function ingestBravePortrait(
	companyId: string,
	personId: string,
	candidate: BravePortraitCandidate,
	now = new Date()
): Promise<PortraitIngestResult> {
	const operationId = randomUUID();
	let transformed: TransformedPortrait;
	let retrievalKind: 'original' | 'brave_thumbnail' = 'original';
	let usedThumbnailFallback = false;
	try {
		transformed = await downloadAndTransformPortrait(candidate.originalUrl, undefined, undefined, {
			sourcePageUrl: candidate.sourcePageUrl
		});
	} catch (cause) {
		if (!(cause instanceof PortraitValidationError)) throw cause;
		await recordAttempt({
			operationId,
			companyId,
			personId,
			retrievalKind: 'original',
			outcome: 'rejected',
			url: candidate.originalUrl,
			validationCode: cause.code,
			diagnostic: cause.diagnostic,
			now
		});
		if (!allowsThumbnailFallback(cause)) throw cause;
		retrievalKind = 'brave_thumbnail';
		usedThumbnailFallback = true;
		try {
			transformed = await downloadAndTransformPortrait(
				candidate.thumbnailUrl,
				undefined,
				undefined,
				{ sourcePageUrl: candidate.sourcePageUrl }
			);
		} catch (fallbackCause) {
			if (fallbackCause instanceof PortraitValidationError) {
				await recordAttempt({
					operationId,
					companyId,
					personId,
					retrievalKind: 'brave_thumbnail',
					outcome: 'rejected',
					url: candidate.thumbnailUrl,
					validationCode: fallbackCause.code,
					diagnostic: fallbackCause.diagnostic,
					now
				});
			}
			throw fallbackCause;
		}
	}

	try {
		const saved = await savePreparedExecutivePortrait(
			companyId,
			{
				personId,
				portrait: transformed,
				imageUrl: candidate.originalUrl,
				altText: `Portrait of ${await activeExecutiveName(companyId, personId)}`,
				sourceUrl: candidate.sourcePageUrl,
				sourceTitle: candidate.title,
				sourcePublisher: candidate.publisher
			},
			now
		);
		await recordAttempt({
			operationId,
			companyId,
			personId,
			retrievalKind,
			outcome: 'saved',
			url: retrievalKind === 'original' ? candidate.originalUrl : candidate.thumbnailUrl,
			validationCode: null,
			diagnostic: transformedDiagnostic(transformed),
			now
		});
		return {
			personId,
			portraitId: saved.portraitId,
			usedThumbnailFallback
		};
	} catch (cause) {
		await recordAttempt({
			operationId,
			companyId,
			personId,
			retrievalKind,
			outcome: cause instanceof DuplicatePortraitError ? 'duplicate' : 'rejected',
			url: retrievalKind === 'original' ? candidate.originalUrl : candidate.thumbnailUrl,
			validationCode:
				cause instanceof DuplicatePortraitError ? 'portrait_duplicate' : 'portrait_save_failed',
			diagnostic: transformedDiagnostic(transformed),
			now
		});
		throw cause;
	}
}

export function activeExecutivePortraitEligibility(mode: PortraitBackfillMode) {
	const portraitCount = db
		.select({ count: sql<number>`count(*)::int` })
		.from(portrait)
		.where(eq(portrait.personId, leadershipMember.personId));
	return exists(
		db
			.select({ id: leadershipMember.personId })
			.from(leadershipSlate)
			.innerJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
			.where(
				and(
					eq(leadershipSlate.companyId, company.id),
					eq(leadershipSlate.status, 'active'),
					mode === 'missing' ? sql`(${portraitCount}) = 0` : sql`(${portraitCount}) < 3`
				)
			)
	);
}

function allowsThumbnailFallback(error: PortraitValidationError): boolean {
	return error.diagnostic.stage === 'download' || error.diagnostic.stage === 'decode';
}

async function activeExecutiveName(companyId: string, personId: string): Promise<string> {
	const [member] = await db
		.select({ name: person.canonicalName })
		.from(leadershipSlate)
		.innerJoin(leadershipMember, eq(leadershipMember.slateId, leadershipSlate.id))
		.innerJoin(person, eq(person.id, leadershipMember.personId))
		.where(
			and(
				eq(leadershipSlate.companyId, companyId),
				eq(leadershipSlate.status, 'active'),
				eq(leadershipMember.personId, personId)
			)
		)
		.limit(1);
	if (!member) throw new Error('Executive is not part of this company’s active leadership');
	return member.name;
}

async function recordAttempt(input: {
	operationId: string;
	companyId: string;
	personId: string;
	retrievalKind: 'original' | 'brave_thumbnail';
	outcome: 'saved' | 'rejected' | 'duplicate';
	url: string;
	validationCode: string | null;
	diagnostic: PortraitFailureDiagnostic;
	now: Date;
}): Promise<void> {
	const host = sanitizedHost(input.url);
	await db.insert(portraitIngestAttempt).values({
		operationId: input.operationId,
		companyId: input.companyId,
		personId: input.personId,
		retrievalKind: input.retrievalKind,
		outcome: input.outcome,
		host,
		validationCode: input.validationCode,
		httpStatus: input.diagnostic.httpStatus,
		contentType: input.diagnostic.contentType,
		width: input.diagnostic.originalWidth,
		height: input.diagnostic.originalHeight,
		createdAt: input.now
	});
}

function transformedDiagnostic(portraitValue: TransformedPortrait): PortraitFailureDiagnostic {
	return {
		stage: 'normalize',
		originalWidth: portraitValue.originalWidth,
		originalHeight: portraitValue.originalHeight,
		format: portraitValue.originalFormat,
		httpStatus: portraitValue.sourceHttpStatus,
		contentType: portraitValue.sourceContentType,
		finalLocation: portraitValue.sourceFinalLocation
	};
}

function sanitizedHost(value: string): string {
	try {
		return new URL(value).hostname.toLocaleLowerCase('en-US');
	} catch {
		return 'invalid';
	}
}

function encodeCursor(cursor: PortraitBackfillCursor): string {
	return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string | null | undefined): PortraitBackfillCursor | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			!('name' in parsed) ||
			typeof parsed.name !== 'string' ||
			!('id' in parsed) ||
			typeof parsed.id !== 'string'
		) {
			return null;
		}
		return { name: parsed.name, id: parsed.id };
	} catch {
		return null;
	}
}
