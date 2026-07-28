# Portrait review readiness badge wraps and misaligns

- Recorded: 2026-07-28 13:18:37 CEST (+0200)
- Base commit: `b5b954dd5e00e214bab87dcab9a5f05266068b68`

## Symptom

In the Companies portrait review table, the `missing image` readiness badge could wrap onto two
lines when the readiness column narrowed. In taller rows, the `ready` badge appeared near the top
while the Manage action was vertically centered.

## Root cause

The shared pill style allowed normal whitespace wrapping. The portrait table also aligned every
cell to the top and only overrode the action cell to middle alignment. At a 700 px browser width,
the readiness column narrowed enough to wrap `missing image`, and the readiness and action centers
differed by about 45 px in a row containing a portrait.

## Fix

- Mark the portrait review readiness cell with a focused class.
- Vertically center that cell to match the Manage action.
- Prevent whitespace wrapping inside only that cell's readiness pill.

## Verification

- Svelte autofixer reported no issues or suggestions.
- `pnpm check`
- `pnpm lint`
- At 700 px, both badges measured 26 px high and their vertical centers matched Manage exactly.
- At 390 px, both badges remained one line, Manage retained a 42 px target, and the document width
  matched the viewport without horizontal overflow.
