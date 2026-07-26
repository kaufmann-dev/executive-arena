import { describe, expect, it, vi } from 'vitest';
import { copyTextWithFallback } from './copy-to-clipboard';

function selectable(execResult = true) {
	const target = {
		value: 'ear_test_key',
		focus: vi.fn(),
		select: vi.fn(),
		setSelectionRange: vi.fn(),
		ownerDocument: {
			execCommand: vi.fn(() => execResult)
		}
	};
	return target;
}

describe('copyTextWithFallback', () => {
	it('uses the asynchronous Clipboard API when available', async () => {
		const target = selectable();
		const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

		await expect(copyTextWithFallback(target.value, target, clipboard)).resolves.toBe('clipboard');
		expect(clipboard.writeText).toHaveBeenCalledWith(target.value);
		expect(target.select).not.toHaveBeenCalled();
	});

	it('selects the visible value and falls back when Clipboard API access is denied', async () => {
		const target = selectable();
		const clipboard = { writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) };

		await expect(copyTextWithFallback(target.value, target, clipboard)).resolves.toBe('fallback');
		expect(target.focus).toHaveBeenCalledOnce();
		expect(target.select).toHaveBeenCalledOnce();
		expect(target.setSelectionRange).toHaveBeenCalledWith(0, target.value.length);
		expect(target.ownerDocument.execCommand).toHaveBeenCalledWith('copy');
	});

	it('leaves the value selected for manual copying when both methods are unavailable', async () => {
		const target = selectable(false);

		await expect(copyTextWithFallback(target.value, target, undefined)).resolves.toBe('manual');
		expect(target.select).toHaveBeenCalledOnce();
		expect(target.ownerDocument.execCommand).toHaveBeenCalledWith('copy');
	});
});
