import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { PortraitValidationError } from '$lib/research/portrait';
import {
	BraveImageSearchError,
	portraitSearchQuery,
	searchBravePortraits,
	type BravePortraitCandidate
} from '$lib/server/portrait-backfill/brave';
import {
	executiveMatchesBackfillMode,
	getNextPortraitBackfillTarget,
	getPortraitIngestDiagnostics,
	ingestBravePortrait,
	isPortraitBackfillCompanyEligible,
	type PortraitBackfillMode
} from '$lib/server/portrait-backfill/service';
import type { Actions, PageServerLoad } from './$types';

const modeSchema = z.enum(['missing', 'incomplete']);
const candidateSchema = z.strictObject({
	personId: z.uuid(),
	candidate: z.strictObject({
		title: z.string().trim().min(1).max(500),
		sourcePageUrl: httpUrl(),
		publisher: z.string().trim().min(1).max(300),
		confidence: z.string().trim().max(50).nullable(),
		originalUrl: httpsUrl(),
		originalWidth: z.number().int().nonnegative().nullable(),
		originalHeight: z.number().int().nonnegative().nullable(),
		thumbnailUrl: braveThumbnailUrl(),
		thumbnailWidth: z.number().int().nonnegative().nullable(),
		thumbnailHeight: z.number().int().nonnegative().nullable()
	})
});

export const load: PageServerLoad = async ({ url }) => {
	const mode = parsedMode(url.searchParams.get('mode'));
	const cursor = url.searchParams.get('cursor');
	const [target, diagnostics] = await Promise.all([
		getNextPortraitBackfillTarget(mode, cursor),
		getPortraitIngestDiagnostics()
	]);
	const searches: Array<{
		personId: string;
		query: string;
		candidates: BravePortraitCandidate[];
		error: string | null;
	}> = [];
	if (target) {
		for (const leader of target.card.leaders) {
			if (!executiveMatchesBackfillMode(leader.portraits.length, mode)) continue;
			const query = portraitSearchQuery({
				personName: leader.name,
				title: leader.title,
				companyName: target.card.companyName,
				ticker: target.card.ticker
			});
			try {
				searches.push({
					personId: leader.id,
					query,
					candidates: await searchBravePortraits(query),
					error: null
				});
			} catch (cause) {
				searches.push({
					personId: leader.id,
					query,
					candidates: [],
					error: braveErrorMessage(cause)
				});
			}
		}
	}
	return {
		mode,
		cursor,
		target,
		searches,
		diagnostics,
		notice: {
			saved: nonnegativeInteger(url.searchParams.get('saved')),
			failed: nonnegativeInteger(url.searchParams.get('failed'))
		}
	};
};

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await request.formData();
		const mode = parsedMode(stringField(form, 'mode'));
		const companyId = stringField(form, 'companyId');
		const currentCursor = stringField(form, 'currentCursor');
		const beforeCursor = stringField(form, 'beforeCursor');
		if (!z.uuid().safeParse(companyId).success || currentCursor.length === 0) {
			return fail(400, { action: 'save', message: 'Invalid backfill company' });
		}
		const rawSelections = form.getAll('selection');
		const selections = rawSelections
			.map((value) => parseSelection(value))
			.filter((value): value is z.infer<typeof candidateSchema> => value !== null);
		if (selections.length !== rawSelections.length) {
			return fail(400, { action: 'save', message: 'A portrait selection was invalid' });
		}
		if (selections.length === 0) {
			return fail(400, { action: 'save', message: 'Select at least one portrait' });
		}
		const target = await getNextPortraitBackfillTarget(mode, beforeCursor || null);
		if (!target || target.card.companyId !== companyId) {
			return fail(409, {
				action: 'save',
				message: 'This queue item changed; reload before saving'
			});
		}
		const leaders = new Map(target.card.leaders.map((leader) => [leader.id, leader]));
		const selectionCounts = new Map<string, number>();
		for (const selection of selections) {
			const leader = leaders.get(selection.personId);
			if (!leader) {
				return fail(400, {
					action: 'save',
					message: 'A selected executive is no longer active at this company'
				});
			}
			const count = (selectionCounts.get(selection.personId) ?? 0) + 1;
			if (count > 3 - leader.portraits.length) {
				return fail(400, {
					action: 'save',
					message: `Too many portraits selected for ${leader.name}`
				});
			}
			selectionCounts.set(selection.personId, count);
		}

		const saved: Array<{ personId: string; usedThumbnailFallback: boolean }> = [];
		const failures: Array<{ personId: string; message: string }> = [];
		for (const selection of selections) {
			try {
				const result = await ingestBravePortrait(
					companyId,
					selection.personId,
					selection.candidate
				);
				saved.push({
					personId: result.personId,
					usedThumbnailFallback: result.usedThumbnailFallback
				});
			} catch (cause) {
				failures.push({
					personId: selection.personId,
					message: portraitErrorMessage(cause)
				});
			}
		}
		const remainsEligible = await isPortraitBackfillCompanyEligible(companyId, mode);
		if (!remainsEligible) {
			redirect(
				303,
				backfillUrl(mode, currentCursor, {
					saved: saved.length,
					failed: failures.length
				})
			);
		}
		return {
			action: 'save',
			saved,
			failures,
			message:
				failures.length === 0
					? `${saved.length} portrait${saved.length === 1 ? '' : 's'} saved`
					: `${saved.length} saved; ${failures.length} could not be saved`
		};
	},

	skip: async ({ request }) => {
		const form = await request.formData();
		const mode = parsedMode(stringField(form, 'mode'));
		const currentCursor = stringField(form, 'currentCursor');
		if (!currentCursor) {
			return fail(400, { action: 'skip', message: 'Invalid queue position' });
		}
		redirect(303, backfillUrl(mode, currentCursor));
	}
};

function parseSelection(value: FormDataEntryValue): z.infer<typeof candidateSchema> | null {
	if (typeof value !== 'string') return null;
	try {
		const parsed = candidateSchema.safeParse(JSON.parse(value));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

function parsedMode(value: string | null): PortraitBackfillMode {
	const parsed = modeSchema.safeParse(value);
	return parsed.success ? parsed.data : 'missing';
}

function backfillUrl(
	mode: PortraitBackfillMode,
	cursor: string,
	notice?: { saved: number; failed: number }
): string {
	const search = new URLSearchParams({ mode, cursor });
	if (notice) {
		search.set('saved', String(notice.saved));
		search.set('failed', String(notice.failed));
	}
	return `/admin/portrait-backfill?${search.toString()}`;
}

function braveErrorMessage(cause: unknown): string {
	if (!(cause instanceof BraveImageSearchError)) {
		return 'Brave portrait search failed';
	}
	if (cause.retryAfterSeconds !== null) {
		return `${cause.message}; retry in about ${cause.retryAfterSeconds} seconds`;
	}
	return cause.message;
}

function portraitErrorMessage(cause: unknown): string {
	if (cause instanceof PortraitValidationError) return cause.message;
	return cause instanceof Error ? cause.message : 'Portrait could not be saved';
}

function nonnegativeInteger(value: string | null): number {
	const parsed = Number.parseInt(value ?? '', 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function stringField(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}

function httpUrl() {
	return z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));
}

function httpsUrl() {
	return z.url().refine((value) => new URL(value).protocol === 'https:');
}

function braveThumbnailUrl() {
	return httpsUrl().refine((value) => new URL(value).hostname === 'imgs.search.brave.com');
}
