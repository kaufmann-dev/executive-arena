# API key copy button fails

- Recorded: 2026-07-26 17:05:09 CEST (+0200)
- Base commit: `b1a5127b9eaa7b20ab986de3a888d20ccaf8c7c8`

## Symptom

After clicking **Copy key**, the button and helper text remained unchanged and no API key reached the
clipboard. The behavior persisted across clipboard implementations and a fresh production deployment.

## Root cause

The application sent `Content-Security-Policy: script-src 'self'` from its server hook while SvelteKit
rendered its client bootstrap as an inline script. Chromium correctly blocked that script because it
had no allowed hash or nonce. The entire site therefore remained unhydrated: native HTML forms worked,
but no Svelte click handler was attached. Production HTML and headers proved the mismatch, and the
bootstrap global remained undefined in Chromium after loading the page.

## Fix

- Remove the conflicting hand-written CSP header from the server hook.
- Configure the same directives through SvelteKit with CSP mode `auto`.
- Let SvelteKit add a matching nonce to dynamically rendered bootstrap scripts and the response CSP.
- Retain the explicit clipboard progress, timeout, and manual-copy states as defensive behavior.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm exec vitest run src/lib/copy-to-clipboard.spec.ts`
- `pnpm build`
- Generated SvelteKit server configuration contains CSP mode `auto` and the intended directives.
- Production verification must confirm that the CSP nonce matches the rendered bootstrap script and
  that the bootstrap global is initialized in Chromium.
