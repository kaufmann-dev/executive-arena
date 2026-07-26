import { describe, expect, test } from 'vitest';
import { parseAuthSettings } from './settings';

const VALID_ENVIRONMENT = {
	ORIGIN: 'https://executives.example.com',
	OIDC_ISSUER: 'https://identity.example.com/oidc/',
	OIDC_CLIENT_ID: 'executive-arena',
	OIDC_CLIENT_SECRET: 'provider-secret'
};

describe('OIDC authentication settings', () => {
	test('derives the fixed callback URLs from the configured application origin', () => {
		const settings = parseAuthSettings(VALID_ENVIRONMENT);

		expect(settings.issuer.href).toBe('https://identity.example.com/oidc/');
		expect(settings.origin.href).toBe('https://executives.example.com/');
		expect(settings.callbackUrl.href).toBe('https://executives.example.com/auth/callback');
		expect(settings.postLogoutUrl.href).toBe('https://executives.example.com/auth/logged-out');
		expect(settings.clientId).toBe('executive-arena');
		expect(settings.clientSecret).toBe('provider-secret');
	});

	test('trims surrounding whitespace from all environment values', () => {
		const settings = parseAuthSettings({
			ORIGIN: '  https://executives.example.com  ',
			OIDC_ISSUER: '  https://identity.example.com/oidc/  ',
			OIDC_CLIENT_ID: '  executive-arena  ',
			OIDC_CLIENT_SECRET: '  provider-secret  '
		});

		expect(settings.origin.href).toBe('https://executives.example.com/');
		expect(settings.issuer.href).toBe('https://identity.example.com/oidc/');
		expect(settings.clientId).toBe('executive-arena');
		expect(settings.clientSecret).toBe('provider-secret');
	});

	test.each(['ORIGIN', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'] as const)(
		'requires %s',
		(name) => {
			expect(() =>
				parseAuthSettings({
					...VALID_ENVIRONMENT,
					[name]: '   '
				})
			).toThrow(`${name} is not set`);
		}
	);

	test('requires absolute issuer and origin URLs', () => {
		expect(() => parseAuthSettings({ ...VALID_ENVIRONMENT, OIDC_ISSUER: '/oidc' })).toThrow(
			'OIDC_ISSUER must be an absolute URL'
		);
		expect(() =>
			parseAuthSettings({ ...VALID_ENVIRONMENT, ORIGIN: 'executives.example.com' })
		).toThrow('ORIGIN must be an absolute URL');
	});

	test('requires HTTPS for non-loopback issuer and origin URLs', () => {
		expect(() =>
			parseAuthSettings({
				...VALID_ENVIRONMENT,
				OIDC_ISSUER: 'http://identity.example.com'
			})
		).toThrow('OIDC_ISSUER must use HTTPS outside local development');
		expect(() =>
			parseAuthSettings({
				...VALID_ENVIRONMENT,
				ORIGIN: 'http://executives.example.com'
			})
		).toThrow('ORIGIN must use HTTPS outside local development');
	});

	test('allows HTTP only for loopback local development', () => {
		const settings = parseAuthSettings({
			...VALID_ENVIRONMENT,
			OIDC_ISSUER: 'http://127.0.0.1:1411/',
			ORIGIN: 'http://localhost:5173'
		});

		expect(settings.issuer.href).toBe('http://127.0.0.1:1411/');
		expect(settings.origin.href).toBe('http://localhost:5173/');
	});

	test('rejects URL credentials, query parameters, and fragments', () => {
		expect(() =>
			parseAuthSettings({
				...VALID_ENVIRONMENT,
				OIDC_ISSUER: 'https://user:password@identity.example.com'
			})
		).toThrow('OIDC_ISSUER must not contain credentials, a query, or a fragment');
		expect(() =>
			parseAuthSettings({
				...VALID_ENVIRONMENT,
				OIDC_ISSUER: 'https://identity.example.com/?tenant=one'
			})
		).toThrow('OIDC_ISSUER must not contain credentials, a query, or a fragment');
		expect(() =>
			parseAuthSettings({
				...VALID_ENVIRONMENT,
				ORIGIN: 'https://executives.example.com/#fragment'
			})
		).toThrow('ORIGIN must not contain credentials, a query, or a fragment');
	});

	test('rejects a deployment origin with a path', () => {
		expect(() =>
			parseAuthSettings({
				...VALID_ENVIRONMENT,
				ORIGIN: 'https://executives.example.com/app/'
			})
		).toThrow('ORIGIN must not contain a path');
	});
});
