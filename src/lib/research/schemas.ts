import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const isoDate = z.iso.date();
const httpUrl = z.url().refine((value) => {
	const protocol = new URL(value).protocol;
	return protocol === 'http:' || protocol === 'https:';
}, 'Must be an HTTP(S) URL');
const httpsUrl = z
	.url()
	.refine((value) => new URL(value).protocol === 'https:', 'Must be an HTTPS URL');

const optionalNullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

export const massiveAddressSchema = z.strictObject({
	address1: optionalNullable(nonEmptyString),
	address2: optionalNullable(nonEmptyString),
	city: optionalNullable(nonEmptyString),
	state: optionalNullable(nonEmptyString),
	postal_code: optionalNullable(nonEmptyString)
});

export const massiveBrandingSchema = z.strictObject({
	icon_url: optionalNullable(httpUrl),
	logo_url: optionalNullable(httpUrl)
});

/**
 * The union of fields returned by Massive's All Tickers and Ticker Overview
 * endpoints. Fields that only exist on one endpoint are optional, while the
 * fields used to establish cohort membership are required.
 */
export const massiveTickerSchema = z.strictObject({
	active: z.boolean(),
	address: optionalNullable(massiveAddressSchema),
	base_currency_name: optionalNullable(nonEmptyString),
	base_currency_symbol: optionalNullable(nonEmptyString),
	branding: optionalNullable(massiveBrandingSchema),
	cik: optionalNullable(z.string().regex(/^\d{1,10}$/)),
	composite_figi: optionalNullable(nonEmptyString),
	currency_name: optionalNullable(nonEmptyString),
	currency_symbol: optionalNullable(nonEmptyString),
	delisted_utc: optionalNullable(z.iso.datetime({ offset: true })),
	description: optionalNullable(nonEmptyString),
	homepage_url: optionalNullable(httpUrl),
	last_updated_utc: optionalNullable(z.iso.datetime({ offset: true })),
	list_date: optionalNullable(isoDate),
	locale: nonEmptyString,
	market: nonEmptyString,
	market_cap: optionalNullable(z.number().finite().nonnegative()),
	name: nonEmptyString,
	phone_number: optionalNullable(nonEmptyString),
	primary_exchange: optionalNullable(nonEmptyString),
	round_lot: optionalNullable(z.number().finite().nonnegative()),
	share_class_figi: optionalNullable(nonEmptyString),
	share_class_shares_outstanding: optionalNullable(z.number().finite().nonnegative()),
	sic_code: optionalNullable(z.string().regex(/^\d{1,4}$/)),
	sic_description: optionalNullable(nonEmptyString),
	ticker: nonEmptyString,
	ticker_root: optionalNullable(nonEmptyString),
	ticker_suffix: optionalNullable(nonEmptyString),
	total_employees: optionalNullable(z.number().int().nonnegative()),
	type: nonEmptyString,
	weighted_shares_outstanding: optionalNullable(z.number().finite().nonnegative())
});

export const massiveTickerListResponseSchema = z.strictObject({
	count: z.number().int().nonnegative().optional(),
	next_url: optionalNullable(httpUrl),
	request_id: optionalNullable(nonEmptyString),
	results: z.array(massiveTickerSchema),
	status: nonEmptyString
});

export const massiveTickerOverviewResponseSchema = z.strictObject({
	count: z.number().int().nonnegative().optional(),
	request_id: optionalNullable(nonEmptyString),
	results: massiveTickerSchema,
	status: nonEmptyString
});

export type MassiveTicker = z.infer<typeof massiveTickerSchema>;

export const researchSourceSchema = z.strictObject({
	url: httpUrl,
	title: nonEmptyString.max(300),
	publisher: nonEmptyString.max(200),
	retrieved_at: isoDate
});

export const leadershipRoleSchema = z.enum([
	'ceo',
	'co_ceo',
	'president',
	'executive_chair',
	'managing_director'
]);

export const factCategorySchema = z.enum([
	'birthplace',
	'upbringing',
	'origin',
	'education',
	'career',
	'achievement',
	'personal',
	'other_notable'
]);

export const executiveFactSchema = z.strictObject({
	category: factCategorySchema,
	value: nonEmptyString.max(600),
	sources: z.array(researchSourceSchema).min(1)
});

export const portraitResearchSchema = z.strictObject({
	image_url: httpsUrl,
	alt_text: nonEmptyString.max(250),
	is_real_person: z.literal(true),
	source: researchSourceSchema
});

export const MIN_EXECUTIVE_PORTRAITS = 1;
export const MAX_EXECUTIVE_PORTRAITS = 3;

export const executiveLeaderSchema = z
	.strictObject({
		name: nonEmptyString.max(200),
		title: nonEmptyString.max(200),
		role_kind: leadershipRoleSchema,
		is_interim: z.boolean(),
		summary: nonEmptyString,
		summary_sources: z.array(researchSourceSchema).min(1),
		role_source: researchSourceSchema,
		portraits: z
			.array(portraitResearchSchema)
			.min(MIN_EXECUTIVE_PORTRAITS)
			.max(MAX_EXECUTIVE_PORTRAITS),
		facts: z.array(executiveFactSchema).min(1)
	})
	.superRefine((leader, context) => {
		const wordCount = countWords(leader.summary);
		if (wordCount < 50 || wordCount > 100) {
			context.addIssue({
				code: 'custom',
				path: ['summary'],
				message: `Summary must contain 50-100 words; received ${wordCount}`
			});
		}

		const imageUrls = new Set<string>();
		for (const [index, portrait] of leader.portraits.entries()) {
			if (imageUrls.has(portrait.image_url)) {
				context.addIssue({
					code: 'custom',
					path: ['portraits', index, 'image_url'],
					message: 'An executive portrait URL may appear only once'
				});
			}
			imageUrls.add(portrait.image_url);
		}
	});

export const executiveProfileSchema = z
	.strictObject({
		schema_version: z.literal(3),
		issuer_key: nonEmptyString.max(100),
		canonical_ticker: nonEmptyString.max(32),
		company_name: nonEmptyString.max(300),
		leadership_as_of: isoDate,
		leaders: z.array(executiveLeaderSchema).min(1)
	})
	.superRefine((profile, context) => {
		const normalizedNames = new Set<string>();
		for (const [index, leader] of profile.leaders.entries()) {
			const normalizedName = leader.name.toLocaleLowerCase('en-US');
			if (normalizedNames.has(normalizedName)) {
				context.addIssue({
					code: 'custom',
					path: ['leaders', index, 'name'],
					message: 'A leader may appear only once in a leadership slate'
				});
			}
			normalizedNames.add(normalizedName);
		}

		if (profile.leaders.length > 1) {
			for (const [index, leader] of profile.leaders.entries()) {
				if (leader.role_kind !== 'co_ceo') {
					context.addIssue({
						code: 'custom',
						path: ['leaders', index, 'role_kind'],
						message: 'Multiple-person leadership slates must consist entirely of co-CEOs'
					});
				}
			}
		} else if (profile.leaders[0]?.role_kind === 'co_ceo') {
			context.addIssue({
				code: 'custom',
				path: ['leaders', 0, 'role_kind'],
				message: 'A co-CEO slate must include every co-CEO and therefore cannot contain one person'
			});
		}
	});

export type ResearchSource = z.infer<typeof researchSourceSchema>;
export type LeadershipRole = z.infer<typeof leadershipRoleSchema>;
export type ExecutiveFact = z.infer<typeof executiveFactSchema>;
export type ExecutiveLeader = z.infer<typeof executiveLeaderSchema>;
export type ExecutiveProfile = z.infer<typeof executiveProfileSchema>;

export function countWords(value: string): number {
	return value.trim().match(/\p{L}[\p{L}\p{M}\p{N}'’.-]*/gu)?.length ?? 0;
}
