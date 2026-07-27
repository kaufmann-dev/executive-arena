import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
	excludeCompany,
	importCompanyProfile,
	updateCompanyMetadata
} from '$lib/server/arena/admin-service';
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
