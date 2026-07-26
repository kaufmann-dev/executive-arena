import { describe, expect, it } from 'vitest';
import {
	decryptProviderApiKey,
	encryptProviderApiKey,
	providerKeyHint,
	readCredentialEncryptionKey
} from './credentials';

const masterKey = Buffer.alloc(32, 7);
const providerId = 'f3528fe5-a21c-4ae8-8acf-8e8e7d6c3ef5';

describe('provider credential encryption', () => {
	it('round-trips a provider key and binds it to the provider ID', () => {
		const encrypted = encryptProviderApiKey('secret-provider-key', providerId, masterKey);

		expect(encrypted.equals(Buffer.from('secret-provider-key'))).toBe(false);
		expect(decryptProviderApiKey(encrypted, providerId, masterKey)).toBe('secret-provider-key');
		expect(() =>
			decryptProviderApiKey(encrypted, '5fd5b718-4db9-4a15-9d24-2be8a700dfcb', masterKey)
		).toThrow();
	});

	it('rejects malformed master keys', () => {
		expect(() => readCredentialEncryptionKey('not-base64')).toThrow('base64-encoded 32-byte key');
	});

	it('returns only the final four key characters as a hint', () => {
		expect(providerKeyHint('secret-provider-key')).toBe('-key');
	});
});
