# Readiness label uses title case

- Recorded: 2026-07-27 09:47:11 UTC (+0000)
- Base commit: `eedd525fdade1cf8a6c6573e988de0f0556a96ce`

## Symptom

Some company readiness badges displayed `Not ready` despite the product vocabulary requiring the
lowercase label `not ready`.

## Root cause

The Companies detail page and Coverage page passed readiness values through the generic
`formatDataLabel()` helper, which title-cases underscore-separated field names. Only the Companies
list had an inline lowercase conversion, so the same status rendered differently between pages.

## Fix

- Add `formatReadinessLabel()` to preserve lowercase readiness labels while replacing underscores
  with spaces.
- Use the shared formatter in every Companies and Coverage readiness badge.
- Add a regression test for all supported readiness values.

## Verification

- `pnpm exec vitest run src/lib/format-label.spec.ts`
- `pnpm check`
- `pnpm lint`
