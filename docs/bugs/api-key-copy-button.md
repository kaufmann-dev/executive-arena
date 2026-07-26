# API key copy button fails

- Recorded: 2026-07-26 16:39:42 CEST (+0200)
- Base commit: `949c8cba641a6ba8a1ded89a4fe22e68703b2d95`

## Symptom

Clicking **Copy key** could report no useful result or fail to put the API key on the clipboard,
despite the earlier fallback implementation.

## Root cause

The fallback implementation awaited `navigator.clipboard.writeText()` before trying selection-based
copying. When a browser denied or stalled the asynchronous permission request, the fallback ran after
the original click's transient user activation had expired. The unit tests mocked both clipboard paths
and therefore verified calls and return values without proving that a copied value could actually be
pasted.

## Fix

- Focus and select the one-time key synchronously in the button click.
- Attempt selection-based copying while the click activation is still available.
- Use the asynchronous Clipboard API only when synchronous copying is unavailable.
- Keep the key selected and show manual-copy instructions if both automatic methods are blocked.
- Test the execution order and all three outcomes.

## Verification

- `pnpm check`
- `pnpm exec vitest run src/lib/copy-to-clipboard.spec.ts`
- Real Chrome copy/paste check: `ear_fixed_browser_copy` was copied by the synchronous path and pasted
  unchanged into a separate input.
