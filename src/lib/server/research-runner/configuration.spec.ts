import { describe, expect, it } from 'vitest';
import { modelInputSchema } from './configuration';

const modelFormInput = {
	providerId: '6fd70e3a-6d89-417d-b59a-175cb83a5f3e',
	name: 'Research model',
	modelId: 'research-model',
	maxConcurrency: '50',
	requestsPerMinute: '',
	tokensPerMinute: '',
	requestTimeoutMs: '180000',
	maxOutputTokens: '12000',
	maxAttempts: '3',
	enabled: true
};

describe('research model input', () => {
	it('keeps blank rate limits unlimited across the form and service validation boundaries', () => {
		const formParsed = modelInputSchema.parse(modelFormInput);

		expect(formParsed).toMatchObject({
			requestsPerMinute: null,
			tokensPerMinute: null
		});
		expect(modelInputSchema.parse(formParsed)).toEqual(formParsed);
	});
});
