# API key copy button fails

- Recorded: 2026-07-26 16:55:10 CEST (+0200)
- Base commit: `c60e562ca964e9c41672a145ad9e53829f449b43`

## Symptom

In Chromium Beta with graphical acceleration disabled, clicking **Copy key** could leave the button
and helper text unchanged while putting no API key on the clipboard.

## Root cause

When selection-based copying was unavailable, the handler awaited
`navigator.clipboard.writeText()` without a deadline and did not set UI state before waiting. Chromium
could leave that permission request pending indefinitely. The handler therefore never assigned its
result, so both the button label and helper text remained in their initial state. A separate silent
return was possible when the `bind:this` input reference was unavailable.

## Fix

- Resolve the key input from the clicked button instead of relying on component-level `bind:this`
  state.
- Set a visible `Copying…` state before starting any clipboard operation.
- Retain synchronous selection copying and cap the asynchronous Clipboard API wait at 1.5 seconds.
- On timeout or denial, keep the key selected, label the button `Press Ctrl+C`, and show explicit
  manual-copy instructions.
- Cover a permanently pending Clipboard API promise with a focused regression test.

## Verification

- `pnpm check`
- `pnpm exec vitest run src/lib/copy-to-clipboard.spec.ts`
- Chromium Beta 151 with `--disable-gpu`, on the production origin, with the permission request forced
  to remain pending: the button changed immediately to `Copying…`, then to `Press Ctrl+C`; the helper
  message appeared and the complete key remained selected.
