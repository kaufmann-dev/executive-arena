import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import * as oidc from 'openid-client';
import { db } from '$lib/server/db';
import { oidcTransaction } from '$lib/server/db/schema';
import { getAuthSettings } from './settings';

const TRANSACTION_LIFETIME_MS = 10 * 60 * 1000;
export const FLOW_COOKIE_NAME = 'executive_arena_oidc_flow';
const FLOW_COOKIE_PATH = '/auth';

type ConsumedTransaction = Pick<typeof oidcTransaction.$inferSelect, 'codeVerifier' | 'nonce'>;
type ConsumeTransaction = (
	stateHash: string,
	browserTokenHash: string,
	now: Date
) => Promise<ConsumedTransaction | undefined>;
type ExchangeAuthorization = (
	callbackUrl: URL,
	transaction: ConsumedTransaction,
	expectedState: string
) => Promise<string>;

let configurationPromise: Promise<oidc.Configuration> | undefined;

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('base64url');
}

function clearFlowCookie(cookies: Cookies): void {
	cookies.delete(FLOW_COOKIE_NAME, { path: FLOW_COOKIE_PATH });
}

async function consumeTransaction(
	stateHash: string,
	browserTokenHash: string,
	now: Date
): Promise<ConsumedTransaction | undefined> {
	const [transaction] = await db
		.delete(oidcTransaction)
		.where(
			and(
				eq(oidcTransaction.stateHash, stateHash),
				eq(oidcTransaction.browserTokenHash, browserTokenHash),
				gt(oidcTransaction.expiresAt, now)
			)
		)
		.returning({ codeVerifier: oidcTransaction.codeVerifier, nonce: oidcTransaction.nonce });
	return transaction;
}

function assertProviderCapabilities(metadata: oidc.ServerMetadata): void {
	if (!metadata.end_session_endpoint) {
		throw new Error('OIDC discovery metadata must advertise end_session_endpoint');
	}
	if (!metadata.code_challenge_methods_supported?.includes('S256')) {
		throw new Error('OIDC discovery metadata must advertise PKCE S256 support');
	}
}

async function discoverConfiguration(): Promise<oidc.Configuration> {
	const settings = getAuthSettings();
	const configuration = await oidc.discovery(
		settings.issuer,
		settings.clientId,
		undefined,
		oidc.ClientSecretPost(settings.clientSecret)
	);
	assertProviderCapabilities(configuration.serverMetadata());
	return configuration;
}

export function getOidcConfiguration(): Promise<oidc.Configuration> {
	configurationPromise ??= discoverConfiguration().catch((cause) => {
		configurationPromise = undefined;
		throw cause;
	});
	return configurationPromise;
}

export async function beginAuthorization(cookies: Cookies, now = new Date()): Promise<URL> {
	const [configuration, settings] = await Promise.all([
		getOidcConfiguration(),
		Promise.resolve(getAuthSettings())
	]);
	const state = oidc.randomState();
	const nonce = oidc.randomNonce();
	const codeVerifier = oidc.randomPKCECodeVerifier();
	const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
	const browserToken = randomBytes(32).toString('base64url');
	const authorizationUrl = oidc.buildAuthorizationUrl(configuration, {
		redirect_uri: settings.callbackUrl.href,
		response_type: 'code',
		scope: 'openid',
		state,
		nonce,
		code_challenge: codeChallenge,
		code_challenge_method: 'S256'
	});

	await db.transaction(async (transaction) => {
		await transaction.delete(oidcTransaction).where(lt(oidcTransaction.expiresAt, now));
		await transaction.insert(oidcTransaction).values({
			stateHash: sha256(state),
			browserTokenHash: sha256(browserToken),
			nonce,
			codeVerifier,
			expiresAt: new Date(now.getTime() + TRANSACTION_LIFETIME_MS)
		});
	});

	cookies.set(FLOW_COOKIE_NAME, browserToken, {
		path: FLOW_COOKIE_PATH,
		httpOnly: true,
		sameSite: 'lax',
		secure: settings.origin.protocol === 'https:',
		maxAge: Math.floor(TRANSACTION_LIFETIME_MS / 1000)
	});
	return authorizationUrl;
}

async function exchangeAuthorization(
	callbackUrl: URL,
	transaction: ConsumedTransaction,
	expectedState: string
): Promise<string> {
	const configuration = await getOidcConfiguration();
	const tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
		pkceCodeVerifier: transaction.codeVerifier,
		expectedState,
		expectedNonce: transaction.nonce,
		idTokenExpected: true
	});
	if (!tokens.id_token) throw new Error('OIDC token response is missing an ID token');
	return tokens.id_token;
}

export async function completeAuthorization(
	callbackUrl: URL,
	cookies: Cookies,
	now = new Date(),
	consume: ConsumeTransaction = consumeTransaction,
	exchange: ExchangeAuthorization = exchangeAuthorization
): Promise<string> {
	try {
		const state = callbackUrl.searchParams.get('state');
		if (!state) throw new Error('OIDC authorization response is missing state');

		const browserToken = cookies.get(FLOW_COOKIE_NAME);
		if (!browserToken) throw new Error('OIDC authorization transaction is invalid or expired');

		const transaction = await consume(sha256(state), sha256(browserToken), now);
		if (!transaction) throw new Error('OIDC authorization transaction is invalid or expired');

		return await exchange(callbackUrl, transaction, state);
	} finally {
		clearFlowCookie(cookies);
	}
}

export async function buildLogoutUrl(idToken: string): Promise<URL> {
	const [configuration, settings] = await Promise.all([
		getOidcConfiguration(),
		Promise.resolve(getAuthSettings())
	]);
	return oidc.buildEndSessionUrl(configuration, {
		id_token_hint: idToken,
		post_logout_redirect_uri: settings.postLogoutUrl.href
	});
}
