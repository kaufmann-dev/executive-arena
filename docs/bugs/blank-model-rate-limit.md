# Blank model rate limit fails validation

- Recorded: 2026-07-26 16:39:42 CEST (+0200)
- Base commit: `949c8cba641a6ba8a1ded89a4fe22e68703b2d95`

## Symptom

Saving a research model with a blank tokens-per-minute field failed with a Zod error saying
`tokensPerMinute` was too small and must be at least 1, although the form states that blank means
unlimited.

## Root cause

The form schema correctly transformed an empty string into `null`. The page action then passed that
parsed object to `createResearchModel()` or `updateResearchModel()`, which parsed it with the same
schema a second time. During the second parse, `z.coerce.number()` converted `null` to `0`, causing the
positive-integer validation error.

## Fix

- Preprocess only the empty-string form value into `null`.
- Validate the resulting value with a nullable positive-integer schema, making repeated validation
  idempotent.
- Cover the actual form-parse followed by service-parse sequence with a focused regression test.

## Verification

- `pnpm check`
- `pnpm exec vitest run src/lib/server/research-runner/configuration.spec.ts`
