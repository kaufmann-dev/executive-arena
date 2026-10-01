import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { mcpApiKey } from '#lib/server/db/schema.js';

const TOKEN_PATTERN = /^ear_([a-f0-9]{12})_([A-Za-z0-9_-]{43})$/;

export interface AuthenticatedMcpApiKey {
	id: string;
	name: string;
	prefix: string;
	createdAt: Date;
	lastUsedAt: Date | null;
}

export interface CreatedMcpApiKey extends AuthenticatedMcpApiKey {
	token: string;
}

export function generateMcpApiKeyToken(): { prefix: string; token: string } {
	const prefix = randomBytes(6).toString('hex');
	const secret = randomBytes(32).toString('base64url');
	return { prefix, token: `ear_${prefix}_${secret}` };
}

export function parseMcpApiKeyToken(token: string): { prefix: string } | null {
	const match = TOKEN_PATTERN.exec(token);
	return match ? { prefix: match[1]! } : null;
}

export function hashMcpApiKeyToken(token: string): string {
	return createHash('sha256').update(token).digest('base64url');
}

export function mcpApiKeyHashesMatch(actual: string, expected: string): boolean {
	const actualBytes = Buffer.from(actual);
	const expectedBytes = Buffer.from(expected);
	return (
		actualBytes.byteLength === expectedBytes.byteLength &&
		timingSafeEqual(actualBytes, expectedBytes)
	);
}

export function readBearerToken(authorization: string | null): string | null {
	if (!authorization) return null;
	const match = /^Bearer ([^\s]+)$/.exec(authorization);
	return match?.[1] ?? null;
}

export async function createMcpApiKey(name: string, now = new Date()): Promise<CreatedMcpApiKey> {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const generated = generateMcpApiKeyToken();
		try {
			const [created] = await db
				.insert(mcpApiKey)
				.values({
					name,
					prefix: generated.prefix,
					tokenHash: hashMcpApiKeyToken(generated.token),
					createdAt: now
				})
				.returning({
					id: mcpApiKey.id,
					name: mcpApiKey.name,
					prefix: mcpApiKey.prefix,
					createdAt: mcpApiKey.createdAt,
					lastUsedAt: mcpApiKey.lastUsedAt
				});
			if (!created) throw new Error('API key creation did not return a record');
			return { ...created, token: generated.token };
		} catch (cause) {
			if (isUniqueViolation(cause) && attempt < 2) continue;
			throw cause;
		}
	}
	throw new Error('Could not generate a unique API key');
}

export async function listMcpApiKeys() {
	return db
		.select({
			id: mcpApiKey.id,
			name: mcpApiKey.name,
			prefix: mcpApiKey.prefix,
			createdAt: mcpApiKey.createdAt,
			lastUsedAt: mcpApiKey.lastUsedAt
		})
		.from(mcpApiKey)
		.orderBy(desc(mcpApiKey.createdAt), desc(mcpApiKey.id));
}

export async function deleteMcpApiKey(id: string): Promise<boolean> {
	const [deleted] = await db
		.delete(mcpApiKey)
		.where(eq(mcpApiKey.id, id))
		.returning({ id: mcpApiKey.id });
	return Boolean(deleted);
}

export async function authenticateMcpApiKey(
	authorization: string | null,
	now = new Date()
): Promise<AuthenticatedMcpApiKey | null> {
	const token = readBearerToken(authorization);
	if (!token) return null;
	const parsed = parseMcpApiKeyToken(token);
	if (!parsed) return null;

	const [stored] = await db
		.select()
		.from(mcpApiKey)
		.where(eq(mcpApiKey.prefix, parsed.prefix))
		.limit(1);
	if (!stored || !mcpApiKeyHashesMatch(hashMcpApiKeyToken(token), stored.tokenHash)) return null;

	const [touched] = await db
		.update(mcpApiKey)
		.set({ lastUsedAt: now })
		.where(eq(mcpApiKey.id, stored.id))
		.returning({
			id: mcpApiKey.id,
			name: mcpApiKey.name,
			prefix: mcpApiKey.prefix,
			createdAt: mcpApiKey.createdAt,
			lastUsedAt: mcpApiKey.lastUsedAt
		});
	return touched ?? null;
}

function isUniqueViolation(cause: unknown): boolean {
	return (
		typeof cause === 'object' &&
		cause !== null &&
		'code' in cause &&
		(cause as { code?: unknown }).code === '23505'
	);
}
