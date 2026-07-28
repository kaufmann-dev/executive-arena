export const MAX_PORTRAIT_INPUT_BYTES = 20 * 1024 * 1024;

export function portraitInputSizeError(byteLength: number): string | null {
	return byteLength > MAX_PORTRAIT_INPUT_BYTES ? 'Portrait files must be 20 MB or smaller' : null;
}
