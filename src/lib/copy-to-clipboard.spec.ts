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
	it('copies synchronously while the click activation is still available', async () => {
		const target = selectable();
		const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

		await expect(copyTextWithFallback(target.value, target, clipboard)).resolves.toBe('fallback');
		expect(target.focus).toHaveBeenCalledOnce();
		expect(target.select).toHaveBeenCalledOnce();
		expect(target.setSelectionRange).toHaveBeenCalledWith(0, target.value.length);
		expect(target.ownerDocument.execCommand).toHaveBeenCalledWith('copy');
		expect(clipboard.writeText).not.toHaveBeenCalled();
	});

	it('uses the Clipboard API when synchronous selection copying is unavailable', async () => {
		const target = selectable(false);
		const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

		await expect(copyTextWithFallback(target.value, target, clipboard)).resolves.toBe('clipboard');
		expect(clipboard.writeText).toHaveBeenCalledWith(target.value);
	});

	it('leaves the value selected for manual copying when both methods are unavailable', async () => {
		const target = selectable(false);
		const clipboard = { writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) };

		await expect(copyTextWithFallback(target.value, target, clipboard)).resolves.toBe('manual');
		expect(target.select).toHaveBeenCalledOnce();
		expect(target.ownerDocument.execCommand).toHaveBeenCalledWith('copy');
	});
});
