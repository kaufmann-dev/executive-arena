# Editor rows have inconsistent right margins

- **Recorded:** 2026-07-27 10:22:21 UTC (+0000)
- **Base commit:** `4436e8f16f381e35d168c158dbb120fad06f0920`

## Symptom

Single portrait and citation rows ended farther from the editor's right edge than the fields above
them.

## Root cause

The row grids retained an empty action column and its preceding gap when no removal action was
rendered.

## Fix

Use a single-column citation grid, and collapse the portrait grid's action column when no direct
remove button exists.

## Verification

- `pnpm check`
- `pnpm lint`
