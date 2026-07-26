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
	clipboard: ClipboardWriter | undefined = globalThis.navigator?.clipboard
): Promise<CopyMethod> {
	try {
		if (clipboard) {
			await clipboard.writeText(text);
			return 'clipboard';
		}
	} catch {
		// Continue to the selection-based fallback when permission is denied.
	}

	target.focus();
	target.select();
	target.setSelectionRange(0, target.value.length);
	try {
		return target.ownerDocument.execCommand('copy') ? 'fallback' : 'manual';
	} catch {
		return 'manual';
	}
}
