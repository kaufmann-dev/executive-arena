import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
	excludeCompany,
	importCompanyProfile,
	updateCompanyMetadata
} from '$lib/server/arena/admin-service';
import { getAdminCompany } from '$lib/server/arena/read-model';
import { executiveProfileSchema } from '$lib/research/schemas';
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

const profileJsonSchema = z.string().trim().min(1).max(2_000_000);

export const load: PageServerLoad = async ({ params, url }) => {
	const record = await getAdminCompany(params.id);
	if (!record) error(404, 'Company not found');
	return {
		record,
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
		const profileJson = stringField(form, 'profileJson');
		const text = profileJsonSchema.safeParse(profileJson);
		if (!text.success) {
			return fail(400, {
				action: 'profile',
				message: text.error.issues[0]?.message ?? 'Profile JSON is required',
				profileJson
			});
		}

		let json: unknown;
		try {
			json = JSON.parse(text.data) as unknown;
		} catch {
			return fail(400, {
				action: 'profile',
				message: 'Profile must be valid JSON',
				profileJson
			});
		}
		const profile = executiveProfileSchema.safeParse(json);
		if (!profile.success) {
			return fail(400, {
				action: 'profile',
				message: profile.error.issues[0]?.message ?? 'Profile does not match schema version 1',
				profileJson
			});
		}
		const record = await getAdminCompany(params.id);
		if (!record) error(404, 'Company not found');
		if (
			profile.data.issuer_key !== record.issuerKey ||
			profile.data.canonical_ticker !== record.canonicalTicker ||
			profile.data.company_name !== record.name
		) {
			return fail(400, {
				action: 'profile',
				message: 'Profile issuer key, ticker, and company name must match this company',
				profileJson
			});
		}

		let importedAction: string;
		try {
			const imported = await importCompanyProfile(params.id, profile.data);
			importedAction = imported.action;
		} catch (cause) {
			return fail(400, {
				action: 'profile',
				message: errorMessage(cause),
				profileJson
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
