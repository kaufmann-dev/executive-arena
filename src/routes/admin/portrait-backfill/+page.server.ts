import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
	DuplicatePortraitError,
	saveExecutivePortraitBatch,
	type PortraitBatchUploadInput
} from '$lib/server/arena/admin-service';
import { MAX_PORTRAIT_INPUT_BYTES, PortraitValidationError } from '$lib/research/portrait';
import { googleImageSearchUrl, portraitSearchQuery } from '$lib/server/portrait-backfill/google';
import {
	executiveMatchesBackfillMode,
	getNextPortraitBackfillTarget,
	restorePortraitBackfillCompany,
	skipPortraitBackfillCompany,
	type PortraitBackfillMode
} from '$lib/server/portrait-backfill/service';
import type { Actions, PageServerLoad } from './$types';

const modeSchema = z.enum(['missing', 'incomplete', 'skipped']);
const imageFieldPrefix = 'image:';

export const load: PageServerLoad = async ({ url }) => {
	const mode = parsedMode(url.searchParams.get('mode'));
	const cursor = url.searchParams.get('cursor');
	const target = await getNextPortraitBackfillTarget(mode, cursor);
	const searches = target
		? target.card.leaders.flatMap((leader) => {
				if (!executiveMatchesBackfillMode(leader.portraits.length, mode)) return [];
				const query = portraitSearchQuery({
					personName: leader.name,
					title: leader.title,
					companyName: target.card.companyName,
					ticker: target.card.ticker
				});
				return [{ personId: leader.id, query, url: googleImageSearchUrl(query) }];
			})
		: [];

	return {
		mode,
		cursor,
		target,
		searches,
		notice: { saved: nonnegativeInteger(url.searchParams.get('saved')) }
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

		const target = await getNextPortraitBackfillTarget(mode, beforeCursor || null);
		if (!target || target.card.companyId !== companyId) {
			return fail(409, {
				action: 'save',
				message: 'This queue item changed; reload before saving'
			});
		}

		const leaders = new Map(target.card.leaders.map((leader) => [leader.id, leader]));
		const filesByPerson = new Map<string, File[]>();
		let totalBytes = 0;
		for (const [field, value] of form.entries()) {
			if (!field.startsWith(imageFieldPrefix)) continue;
			const personId = field.slice(imageFieldPrefix.length);
			const leader = leaders.get(personId);
			if (value instanceof File && value.size === 0) continue;
			if (
				!leader ||
				!executiveMatchesBackfillMode(leader.portraits.length, mode) ||
				!(value instanceof File)
			) {
				return fail(400, { action: 'save', message: 'A portrait upload was invalid' });
			}
			if (!value.type.startsWith('image/')) {
				return fail(400, { action: 'save', message: `${value.name} is not an image` });
			}
			if (value.size > MAX_PORTRAIT_INPUT_BYTES) {
				return fail(413, { action: 'save', message: 'Portrait files must be 20 MB or smaller' });
			}
			totalBytes += value.size;
			if (totalBytes > MAX_PORTRAIT_INPUT_BYTES) {
				return fail(413, {
					action: 'save',
					message: 'The portrait batch must be 20 MB or smaller'
				});
			}
			const files = filesByPerson.get(personId) ?? [];
			files.push(value);
			if (files.length > 3 - leader.portraits.length) {
				return fail(400, {
					action: 'save',
					message: `Too many portraits added for ${leader.name}`
				});
			}
			filesByPerson.set(personId, files);
		}
		if (filesByPerson.size === 0) {
			return fail(400, { action: 'save', message: 'Paste or select at least one image' });
		}

		const inputs: PortraitBatchUploadInput[] = [];
		for (const [personId, files] of filesByPerson) {
			inputs.push({
				personId,
				images: await Promise.all(
					files.map(async (file) => ({
						bytes: new Uint8Array(await file.arrayBuffer())
					}))
				)
			});
		}

		let savedCount: number;
		try {
			const saved = await saveExecutivePortraitBatch(companyId, inputs);
			savedCount = saved.portraitIds.length;
		} catch (cause) {
			return fail(400, {
				action: 'save',
				message: portraitErrorMessage(cause)
			});
		}
		redirect(303, backfillUrl(mode, currentCursor, savedCount));
	},

	skip: async ({ request }) => {
		const form = await request.formData();
		const mode = parsedMode(stringField(form, 'mode'));
		const companyId = stringField(form, 'companyId');
		const currentCursor = stringField(form, 'currentCursor');
		const beforeCursor = stringField(form, 'beforeCursor');
		if (!z.uuid().safeParse(companyId).success || !currentCursor) {
			return fail(400, { action: 'skip', message: 'Invalid portrait queue item' });
		}
		const target = await getNextPortraitBackfillTarget(mode, beforeCursor || null);
		if (!target || target.card.companyId !== companyId) {
			return fail(409, {
				action: 'skip',
				message: 'This queue item changed; reload before continuing'
			});
		}
		if (mode !== 'skipped') {
			try {
				await skipPortraitBackfillCompany(companyId, mode);
			} catch (cause) {
				return fail(409, { action: 'skip', message: portraitErrorMessage(cause) });
			}
		}
		redirect(303, backfillUrl(mode, currentCursor));
	},

	restore: async ({ request }) => {
		const form = await request.formData();
		const mode = parsedMode(stringField(form, 'mode'));
		const companyId = stringField(form, 'companyId');
		const currentCursor = stringField(form, 'currentCursor');
		const beforeCursor = stringField(form, 'beforeCursor');
		if (mode !== 'skipped' || !z.uuid().safeParse(companyId).success || !currentCursor) {
			return fail(400, { action: 'restore', message: 'Invalid skipped portrait queue item' });
		}
		const target = await getNextPortraitBackfillTarget(mode, beforeCursor || null);
		if (!target || target.card.companyId !== companyId) {
			return fail(409, {
				action: 'restore',
				message: 'This queue item changed; reload before restoring it'
			});
		}
		try {
			await restorePortraitBackfillCompany(companyId);
		} catch (cause) {
			return fail(409, { action: 'restore', message: portraitErrorMessage(cause) });
		}
		redirect(303, backfillUrl(mode, currentCursor));
	}
};

function parsedMode(value: string | null): PortraitBackfillMode {
	const parsed = modeSchema.safeParse(value);
	return parsed.success ? parsed.data : 'missing';
}

function backfillUrl(mode: PortraitBackfillMode, cursor: string, saved?: number): string {
	const search = new URLSearchParams({ mode, cursor });
	if (saved !== undefined) search.set('saved', String(saved));
	return `/admin/portrait-backfill?${search.toString()}`;
}

function portraitErrorMessage(cause: unknown): string {
	if (cause instanceof PortraitValidationError || cause instanceof DuplicatePortraitError) {
		return cause.message;
	}
	return cause instanceof Error ? cause.message : 'Portrait batch could not be saved';
}

function nonnegativeInteger(value: string | null): number {
	const parsed = Number.parseInt(value ?? '', 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function stringField(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}
