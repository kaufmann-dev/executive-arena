import { describe, expect, it } from 'vitest';
import { MAX_PORTRAIT_INPUT_BYTES, portraitInputSizeError } from './portrait-upload';

describe('portrait upload limits', () => {
	it('accepts files through 20 MB', () => {
		expect(portraitInputSizeError(MAX_PORTRAIT_INPUT_BYTES)).toBeNull();
	});

	it('returns the user-facing error above 20 MB', () => {
		expect(portraitInputSizeError(MAX_PORTRAIT_INPUT_BYTES + 1)).toBe(
			'Portrait files must be 20 MB or smaller'
		);
	});
});
