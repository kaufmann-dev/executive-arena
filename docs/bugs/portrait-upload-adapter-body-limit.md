# Portrait upload rejected before inline validation

- Recorded: 2026-07-28T13:06:49+02:00
- Base commit: `f766683465c40616853327c5944b21725fd6bf99`

## Symptom

Submitting a 610 KB portrait from an authenticated company administration page returned HTTP 413.
The server logged that the request exceeded 524,288 bytes, while the browser did not show the
action's existing 20 MB portrait-limit message.

## Root cause

The Nixpacks start command ran `node build` directly. That bypassed the package start command's
`BODY_SIZE_LIMIT=25M` default, so the adapter-node server used its 512 KiB default request-body
limit. Adapter-node rejected the request before the page action could read the multipart form and
return a normal form failure.

The enhanced portrait form also delegated adapter-level errors to SvelteKit's error-page behavior
instead of translating a 413 action error into a message beside the affected upload.

## Fix

- Set the same overridable 25 MiB body limit in the Nixpacks production start command.
- Share the application's 20 MB portrait limit with browser code and reject larger selected files
  before submission.
- Handle an adapter-level 413 response in the portrait form enhancer and expose it through an
  assertive inline alert without clearing the selected file.

## Verification

- Reproduced the original response by running the production build with
  `BODY_SIZE_LIMIT=512K` and submitting a 610 KB authenticated multipart request.
- Ran the corrected production start command without a `BODY_SIZE_LIMIT` override and confirmed
  the same request reached the portrait action instead of returning adapter-level 413.
- Used `agent-browser` at desktop and 390 px widths to confirm both the 20 MB client limit and a
  forced adapter-level 413 remain on the company page and display an inline alert.
- Ran the focused portrait tests, Svelte autofixer, `pnpm check`, `pnpm lint`, and `pnpm build`.
