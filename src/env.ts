import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (input: string | undefined) => input;

export const variables = defineEnvVars({
	MASSIVE_API_KEY: {
		description: 'Massive API key used to sync the company universe',
		schema: optional
	},
	ORIGIN: {
		description: 'Public application origin, including scheme and without a path',
		schema: optional
	},
	OIDC_ISSUER: { description: 'OIDC issuer URL', schema: optional },
	OIDC_CLIENT_ID: { description: 'OIDC client ID', schema: optional },
	OIDC_CLIENT_SECRET: { description: 'OIDC client secret', schema: optional }
});
