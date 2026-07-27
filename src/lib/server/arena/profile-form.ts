import { executiveProfileSchema, type ExecutiveProfile } from '$lib/research/schemas';

export interface ProfileIdentity {
	issuerKey: string;
	canonicalTicker: string;
	companyName: string;
}

export function parseExecutiveProfileForm(
	form: FormData,
	identity: ProfileIdentity
): ReturnType<typeof executiveProfileSchema.safeParse> {
	const leaders = indexes(form, 'leaders').map((leaderIndex) => {
		const prefix = `leaders.${leaderIndex}`;
		return {
			name: field(form, `${prefix}.name`),
			title: field(form, `${prefix}.title`),
			role_kind: field(form, `${prefix}.roleKind`),
			is_interim: field(form, `${prefix}.isInterim`) === 'on',
			summary: field(form, `${prefix}.summary`),
			sources: indexes(form, `${prefix}.sources`).map((sourceIndex) =>
				source(form, `${prefix}.sources.${sourceIndex}`)
			),
			portraits: [],
			facts: indexes(form, `${prefix}.facts`).map((factIndex) => {
				const factPrefix = `${prefix}.facts.${factIndex}`;
				return {
					category: field(form, `${factPrefix}.category`),
					value: field(form, `${factPrefix}.value`)
				};
			})
		};
	});

	return executiveProfileSchema.safeParse({
		schema_version: 4,
		issuer_key: identity.issuerKey,
		canonical_ticker: identity.canonicalTicker,
		company_name: identity.companyName,
		leadership_as_of: field(form, 'leadershipAsOf'),
		leaders
	});
}

export function profileFormErrors(error: {
	issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
	return error.issues.reduce<Record<string, string>>((errors, issue) => {
		const path = issue.path
			.map((segment) => {
				const value = String(segment);
				return (
					{
						leadership_as_of: 'leadershipAsOf',
						role_kind: 'roleKind',
						is_interim: 'isInterim',
						sources: 'sources',
						image_url: 'imageUrl',
						alt_text: 'altText'
					}[value] ?? value
				);
			})
			.join('.');
		if (!errors[path]) errors[path] = issue.message;
		return errors;
	}, {});
}

function source(form: FormData, prefix: string) {
	return {
		url: field(form, `${prefix}.url`),
		...(field(form, `${prefix}.title`) ? { title: field(form, `${prefix}.title`) } : {}),
		...(field(form, `${prefix}.publisher`) ? { publisher: field(form, `${prefix}.publisher`) } : {})
	};
}

function field(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value.trim() : '';
}

function indexes(form: FormData, prefix: string): number[] {
	const expression = new RegExp(`^${escapeRegExp(prefix)}\\.(\\d+)\\.`);
	const values = new Set<number>();
	for (const key of form.keys()) {
		const match = expression.exec(key);
		if (match?.[1]) values.add(Number(match[1]));
	}
	return [...values].sort((left, right) => left - right);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type ParsedExecutiveProfile = ExecutiveProfile;
