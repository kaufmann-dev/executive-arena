# Mobile page shell shrink-wraps content

- Recorded: 2026-07-27 09:01:45 UTC (+0000)
- Base commit: `9537838c7d4897454e7a5368c3350fb0a714d37a`

## Symptom

On narrow mobile views, authenticated pages could occupy only the intrinsic minimum width of their
content instead of the full viewport. The API Keys page used roughly two-thirds of the screen and
left a large empty strip on the right. Its no-wrap table also increased horizontal sizing pressure.

## Root cause

The document roots and authenticated shell relied on automatic and percentage sizing without
explicitly establishing a viewport-wide containing block. Nested grid panels retained their default
minimum-content sizing, including the API key grid's 260px first-column minimum. In mobile embedding
contexts that shrink-wrap descendants, those constraints allowed the shell to collapse to the
content minimum instead of stretching across the viewport.

## Fix

- Give the document roots, authenticated header, and main content an explicit full width.
- Allow the shared shell and panels to shrink below their intrinsic content width.
- Clip document-level horizontal overflow while retaining local navigation and table scrollers.
- Constrain the API-key grid and table wrapper to their panel width.

## Verification

- `pnpm check`
- `pnpm lint`
- Mobile browser measurement at 379px confirms the header and authenticated main fill the viewport.
- The API-key table remains horizontally scrollable inside its panel.
