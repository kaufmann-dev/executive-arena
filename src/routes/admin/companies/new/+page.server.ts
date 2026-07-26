import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { createCompanyWithProfile } from '$lib/server/arena/admin-service';
import { executiveProfileSchema } from '$lib/research/schemas';
import type { Actions } from './$types';

const optionalText = (maximum: number) =>
	z
		.string()
		.trim()
		.max(maximum)
		.transform((value) => (value === '' ? null : value));

const newCompanySchema = z.strictObject({
	issuerKey: z.string().trim().min(1).max(100),
	cik: optionalText(10).refine((value) => value === null || /^\d{10}$/.test(value), {
		message: 'CIK must contain exactly 10 digits'
	}),
	name: z.string().trim().min(1).max(300),
	canonicalTicker: z
		.string()
		.trim()
		.min(1)
		.max(32)
		.transform((value) => value.toUpperCase()),
	description: z.string().trim().max(10_000),
	homepageUrl: optionalText(500).refine(
		(value) => {
			if (value === null) return true;
			try {
				const url = new URL(value);
				return url.protocol === 'http:' || url.protocol === 'https:';
			} catch {
				return false;
			}
		},
		{ message: 'Homepage must be an HTTP(S) URL' }
	),
	primaryExchange: optionalText(100),
	marketCap: z
		.string()
		.trim()
		.transform((value) => (value === '' ? null : Number(value)))
		.refine(
			(value) =>
				value === null || (Number.isSafeInteger(value) && Number.isFinite(value) && value >= 0),
			'Market cap must be a non-negative whole dollar amount'
		),
	profileJson: z.string().trim().min(1).max(2_000_000)
});

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const values = {
			issuerKey: stringField(form, 'issuerKey'),
			cik: stringField(form, 'cik'),
			name: stringField(form, 'name'),
			canonicalTicker: stringField(form, 'canonicalTicker'),
			description: stringField(form, 'description'),
			homepageUrl: stringField(form, 'homepageUrl'),
			primaryExchange: stringField(form, 'primaryExchange'),
			marketCap: stringField(form, 'marketCap'),
			profileJson: stringField(form, 'profileJson')
		};
		const parsed = newCompanySchema.safeParse(values);
		if (!parsed.success) {
			return fail(400, {
				message: parsed.error.issues[0]?.message ?? 'Invalid company record',
				values
			});
		}

		let json: unknown;
		try {
			json = JSON.parse(parsed.data.profileJson) as unknown;
		} catch {
			return fail(400, { message: 'Profile must be valid JSON', values });
		}
		const profile = executiveProfileSchema.safeParse(json);
		if (!profile.success) {
			return fail(400, {
				message: profile.error.issues[0]?.message ?? 'Profile does not match schema version 1',
				values
			});
		}
		if (
			profile.data.issuer_key !== parsed.data.issuerKey ||
			profile.data.canonical_ticker !== parsed.data.canonicalTicker ||
			profile.data.company_name !== parsed.data.name
		) {
			return fail(400, {
				message: 'Profile issuer key, ticker, and company name must match the new company',
				values
			});
		}

		let companyId: string;
		try {
			companyId = (
				await createCompanyWithProfile(
					{
						issuerKey: parsed.data.issuerKey,
						cik: parsed.data.cik,
						name: parsed.data.name,
						canonicalTicker: parsed.data.canonicalTicker,
						description: parsed.data.description,
						homepageUrl: parsed.data.homepageUrl,
						primaryExchange: parsed.data.primaryExchange,
						marketCap: parsed.data.marketCap
					},
					profile.data
				)
			).companyId;
		} catch (cause) {
			return fail(400, {
				message: cause instanceof Error ? cause.message : 'Company creation failed',
				values
			});
		}
		redirect(303, `/admin/companies/${companyId}?notice=profile-created`);
	}
};

function stringField(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}
