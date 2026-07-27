# Citation remove action appears beside fields

- **Recorded:** 2026-07-27 10:21:32 UTC (+0000)
- **Base commit:** `4436e8f16f381e35d168c158dbb120fad06f0920`

## Symptom

The **Remove citation** action appeared in a narrow column at the top-right of a citation, unlike the
related **Remove fact** action that follows its editable content.

## Root cause

Citation rows used a two-column grid with the source fields in the first column and the removal
action in the second.

## Fix

Use a single-column citation-row grid so the removal action appears directly below the citation
fields for both summary and fact citations.

## Verification

- `pnpm check`
- `pnpm lint`
