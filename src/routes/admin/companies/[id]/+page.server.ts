import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
	deleteExecutivePortrait,
	excludeCompany,
	importCompanyProfile,
	saveExecutivePortrait,
	updateCompanyMetadata
} from '$lib/server/arena/admin-service';
import { MAX_PORTRAIT_INPUT_BYTES, PortraitValidationError } from '$lib/research/portrait';
import { profileFormErrors, parseExecutiveProfileForm } from '$lib/server/arena/profile-form';
import { getAdminCompany, getCompanyProfileDocument } from '$lib/server/arena/read-model';
import type { Actions, PageServerLoad } from './$types';

const optionalUrl = z
	.string()
	.trim()
	.max(500)
	.transform((value) => (value === '' ? null : value))
	.refine(
		(value) =>
			value === null ||
			(() => {
				try {
					const url = new URL(value);
					return url.protocol === 'https:' || url.protocol === 'http:';
				} catch {
					return false;
				}
			})(),
		'Homepage must be an HTTP(S) URL'
	);

const metadataSchema = z.strictObject({
	name: z.string().trim().min(1).max(300),
	description: z.string().trim().max(10_000),
	homepageUrl: optionalUrl
});

const exclusionSchema = z.strictObject({
	reason: z.string().trim().min(10).max(500),
	confirmation: z.literal('on', {
		error: 'Confirm that stored portraits will be permanently removed'
	})
});

const portraitMetadataSchema = z.strictObject({
	personId: z.uuid(),
	portraitId: z
		.string()
		.trim()
		.transform((value) => (value === '' ? null : value))
		.pipe(z.uuid().nullable()),
	altText: z.string().trim().max(250),
	sourceUrl: z
		.string()
		.trim()
		.transform((value) => (value === '' ? null : value))
		.pipe(
			z
				.url()
				.refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))
				.nullable()
		),
	sourceTitle: z.string().trim().max(300),
	sourcePublisher: z.string().trim().max(200)
});

const portraitDeleteSchema = z.strictObject({ portraitId: z.uuid() });

export const load: PageServerLoad = async ({ params, url }) => {
	const record = await getAdminCompany(params.id);
	if (!record) error(404, 'Company not found');
	return {
		record,
		profile: await getCompanyProfileDocument(params.id),
		notice: url.searchParams.get('notice')
	};
};

export const actions: Actions = {
	update: async ({ request, params }) => {
		const form = await request.formData();
		const values = {
			name: stringField(form, 'name'),
			description: stringField(form, 'description'),
			homepageUrl: stringField(form, 'homepageUrl')
		};
		const parsed = metadataSchema.safeParse(values);
		if (!parsed.success) {
			return fail(400, {
				action: 'update',
				message: parsed.error.issues[0]?.message ?? 'Invalid company metadata',
				values
			});
		}
		try {
			await updateCompanyMetadata(params.id, parsed.data);
		} catch (cause) {
			return fail(400, { action: 'update', message: errorMessage(cause), values });
		}
		redirect(303, `/admin/companies/${params.id}?notice=metadata-updated`);
	},

	profile: async ({ request, params }) => {
		const form = await request.formData();
		const record = await getAdminCompany(params.id);
		if (!record) error(404, 'Company not found');
		const profile = parseExecutiveProfileForm(form, {
			issuerKey: record.issuerKey,
			canonicalTicker: record.canonicalTicker,
			companyName: record.name
		});
		if (!profile.success) {
			return fail(400, {
				action: 'profile',
				message: 'Complete the highlighted profile fields before publishing',
				fieldErrors: profileFormErrors(profile.error)
			});
		}

		let importedAction: string;
		try {
			const imported = await importCompanyProfile(params.id, profile.data);
			importedAction = imported.action;
		} catch (cause) {
			return fail(400, {
				action: 'profile',
				message: errorMessage(cause)
			});
		}
		redirect(303, `/admin/companies/${params.id}?notice=profile-${importedAction}`);
	},

	portrait: async ({ request, params }) => {
		const form = await request.formData();
		const parsed = portraitMetadataSchema.safeParse({
			personId: stringField(form, 'personId'),
			portraitId: stringField(form, 'portraitId'),
			altText: stringField(form, 'altText'),
			sourceUrl: stringField(form, 'sourceUrl'),
			sourceTitle: stringField(form, 'sourceTitle'),
			sourcePublisher: stringField(form, 'sourcePublisher')
		});
		const image = form.get('image');
		if (!parsed.success) {
			return fail(400, {
				action: 'portrait',
				message: parsed.error.issues[0]?.message ?? 'Invalid portrait metadata'
			});
		}
		if (!(image instanceof File) || image.size === 0) {
			return fail(400, { action: 'portrait', message: 'Paste or select an image first' });
		}
		if (image.size > MAX_PORTRAIT_INPUT_BYTES) {
			return fail(413, {
				action: 'portrait',
				message: 'Portrait files must be 20 MB or smaller'
			});
		}
		try {
			await saveExecutivePortrait(params.id, {
				personId: parsed.data.personId,
				portraitId: parsed.data.portraitId,
				bytes: new Uint8Array(await image.arrayBuffer()),
				altText: parsed.data.altText,
				sourceUrl: parsed.data.sourceUrl,
				sourceTitle: parsed.data.sourceTitle || null,
				sourcePublisher: parsed.data.sourcePublisher || null
			});
		} catch (cause) {
			return fail(400, {
				action: 'portrait',
				message: cause instanceof PortraitValidationError ? cause.message : errorMessage(cause)
			});
		}
		redirect(303, `/admin/companies/${params.id}?notice=portrait-saved`);
	},

	deletePortrait: async ({ request, params }) => {
		const form = await request.formData();
		const parsed = portraitDeleteSchema.safeParse({
			portraitId: stringField(form, 'portraitId')
		});
		if (!parsed.success) {
			return fail(400, { action: 'deletePortrait', message: 'Invalid portrait' });
		}
		try {
			await deleteExecutivePortrait(params.id, parsed.data.portraitId);
		} catch (cause) {
			return fail(400, {
				action: 'deletePortrait',
				message: errorMessage(cause)
			});
		}
		redirect(303, `/admin/companies/${params.id}?notice=portrait-deleted`);
	},

	exclude: async ({ request, params }) => {
		const form = await request.formData();
		const values = {
			reason: stringField(form, 'reason'),
			confirmation: stringField(form, 'confirmation')
		};
		const parsed = exclusionSchema.safeParse(values);
		if (!parsed.success) {
			return fail(400, {
				action: 'exclude',
				message: parsed.error.issues[0]?.message ?? 'An exclusion reason is required',
				values
			});
		}
		try {
			await excludeCompany(params.id, parsed.data.reason);
		} catch (cause) {
			return fail(400, { action: 'exclude', message: errorMessage(cause), values });
		}
		redirect(303, `/admin/companies/${params.id}?notice=company-excluded`);
	}
};

function stringField(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : 'The operation failed';
}
