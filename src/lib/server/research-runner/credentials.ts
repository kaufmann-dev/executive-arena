import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const CREDENTIAL_VERSION = 1;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

export function encryptProviderApiKey(
	apiKey: string,
	providerId: string,
	masterKey = readCredentialEncryptionKey()
): Buffer {
	const normalized = apiKey.trim();
	if (normalized.length < 8 || normalized.length > 10_000) {
		throw new Error('Provider API key must contain between 8 and 10,000 characters');
	}

	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv('aes-256-gcm', masterKey, nonce);
	cipher.setAAD(Buffer.from(providerId, 'utf8'));
	const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return Buffer.concat([Buffer.from([CREDENTIAL_VERSION]), nonce, authTag, ciphertext]);
}

export function decryptProviderApiKey(
	payload: Buffer,
	providerId: string,
	masterKey = readCredentialEncryptionKey()
): string {
	const minimumLength = 1 + NONCE_BYTES + AUTH_TAG_BYTES + 1;
	if (payload.byteLength < minimumLength || payload[0] !== CREDENTIAL_VERSION) {
		throw new Error('Provider credential payload is invalid or uses an unsupported version');
	}

	const nonceStart = 1;
	const tagStart = nonceStart + NONCE_BYTES;
	const ciphertextStart = tagStart + AUTH_TAG_BYTES;
	const nonce = payload.subarray(nonceStart, tagStart);
	const authTag = payload.subarray(tagStart, ciphertextStart);
	const ciphertext = payload.subarray(ciphertextStart);
	const decipher = createDecipheriv('aes-256-gcm', masterKey, nonce);
	decipher.setAAD(Buffer.from(providerId, 'utf8'));
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function providerKeyHint(apiKey: string): string {
	const normalized = apiKey.trim();
	return normalized.slice(-4).padStart(4, '•');
}

export function readCredentialEncryptionKey(
	value = process.env.RESEARCH_CREDENTIAL_ENCRYPTION_KEY
): Buffer {
	if (!value) {
		throw new Error('RESEARCH_CREDENTIAL_ENCRYPTION_KEY is not configured');
	}
	if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
		throw new Error('RESEARCH_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
	}
	const key = Buffer.from(value, 'base64');
	if (key.byteLength !== KEY_BYTES || key.toString('base64') !== value) {
		throw new Error('RESEARCH_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
	}
	return key;
}
