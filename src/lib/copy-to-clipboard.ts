export type CopyMethod = 'clipboard' | 'fallback' | 'manual';

interface SelectableText {
	value: string;
	focus(): void;
	select(): void;
	setSelectionRange(start: number, end: number): void;
	ownerDocument: {
		execCommand(command: string): boolean;
	};
}

interface ClipboardWriter {
	writeText(text: string): Promise<void>;
}

export async function copyTextWithFallback(
	text: string,
	target: SelectableText,
	clipboard: ClipboardWriter | undefined = globalThis.navigator?.clipboard,
	timeoutMs = 1_500
): Promise<CopyMethod> {
	target.focus();
	target.select();
	target.setSelectionRange(0, target.value.length);

	try {
		if (target.ownerDocument.execCommand('copy')) return 'fallback';
	} catch {
		// Continue to the Clipboard API when selection copying is unavailable.
	}

	if (!clipboard) return 'manual';
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			clipboard.writeText(text),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(new Error('Clipboard write timed out')), timeoutMs);
			})
		]);
		return 'clipboard';
	} catch {
		return 'manual';
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
