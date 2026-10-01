import { OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_ISSUER, ORIGIN } from '$app/env/private';

export interface AuthSettings {
	issuer: URL;
	clientId: string;
	clientSecret: string;
	origin: URL;
	callbackUrl: URL;
	postLogoutUrl: URL;
}

type AuthEnvironment = Readonly<Record<string, string | undefined>>;

function required(name: string, value: string | undefined): string {
	const normalized = value?.trim();
	if (!normalized) throw new Error(`${name} is not set`);
	return normalized;
}

function absoluteUrl(name: string, value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${name} must be an absolute URL`);
	}

	const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
		throw new Error(`${name} must use HTTPS outside local development`);
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error(`${name} must not contain credentials, a query, or a fragment`);
	}
	return url;
}

export function parseAuthSettings(source: AuthEnvironment): AuthSettings {
	const issuer = absoluteUrl('OIDC_ISSUER', required('OIDC_ISSUER', source.OIDC_ISSUER));
	const origin = absoluteUrl('ORIGIN', required('ORIGIN', source.ORIGIN));
	if (origin.pathname !== '/') throw new Error('ORIGIN must not contain a path');

	return {
		issuer,
		clientId: required('OIDC_CLIENT_ID', source.OIDC_CLIENT_ID),
		clientSecret: required('OIDC_CLIENT_SECRET', source.OIDC_CLIENT_SECRET),
		origin,
		callbackUrl: new URL('/auth/callback', origin),
		postLogoutUrl: new URL('/auth/logged-out', origin)
	};
}

export function getAuthSettings(): AuthSettings {
	return parseAuthSettings({ OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_ISSUER, ORIGIN });
}
