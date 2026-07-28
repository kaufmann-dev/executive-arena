# Companies status filter uses inconsistent capitalization

- Recorded: 2026-07-28 15:21:28 CEST (+0200)
- Base commit: `79e9360d68fc0b8bf0af0a43db96e98b66a82070`

## Symptom

The Companies status filter displayed `not ready` while every other option used sentence case.

## Root cause

The visible text for the `not_ready` option was hardcoded in lowercase. This was separate from the
shared readiness label used by badges, where lowercase `not ready` is intentional.

## Fix

- Changed only the status filter option text to `Not ready`.
- Preserved the `not_ready` query value and the lowercase readiness badge label.

## Verification

- Svelte autofixer reports no issues.
- `pnpm check`
- `pnpm lint`
