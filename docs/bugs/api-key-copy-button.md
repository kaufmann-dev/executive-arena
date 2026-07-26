# API key copy button fails

- Recorded: 2026-07-26 14:17:14 CEST (+0200)
- Base commit: `4228b814e21bb0909d464040a0380984e9c38847`

## Symptom

Clicking **Copy key** could leave the button unchanged and put no API key on the clipboard.

## Root cause

The click handler called `navigator.clipboard.writeText()` without checking whether the Clipboard API
was available or handling permission and browser-context failures. The handler rejected before it could
update the UI, and the key was rendered as non-selectable code with no fallback copy path.

## Fix

- Render the one-time key in a read-only, selectable input.
- Try the Clipboard API first, then use selection-based browser copying when it is unavailable or denied.
- Keep the key selected and show manual-copy instructions if both automatic methods are blocked.
- Announce successful and manual-copy states through an `aria-live` message.
- Cover the Clipboard API, fallback, and manual-selection paths with focused unit tests.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm exec vitest run src/lib/copy-to-clipboard.spec.ts`
- Production build with representative required environment variables
- Browser check with the Clipboard API unavailable; the fallback value pasted as `ea_test_browser_copy`
