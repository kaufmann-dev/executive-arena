# Mobile tables and navigation overflow

- Recorded: 2026-07-27 09:25:05 UTC (+0000)
- Base commit: `de09e0dac35c136bd7b9f4ef358450dfa9ab42be`

## Symptom

The Companies and API Keys pages could scroll the whole document horizontally on mobile. The
Companies status badge title-cased `not ready`, and the mobile navigation opened as a compact
two-column block instead of a full-height menu.

## Root cause

Both pages preserved wide desktop table layouts at phone widths, including non-wrapping API-key
cells, so their intrinsic table widths created horizontal sizing pressure. The status badge used the
generic title-casing data-label formatter. The mobile navigation stylesheet explicitly defined a
two-column, content-height grid.

## Fix

- Render both mobile tables as wrapping row cards while preserving native table markup.
- Constrain the affected panels, forms, inputs, and authenticated main content to their containers.
- Render the `not_ready` status as lowercase words instead of passing it through the title-casing
  formatter.
- Make the mobile navigation a fixed, full-height, single-column panel and prevent background
  scrolling while it is open.

## Verification

- `pnpm check`
- `pnpm lint`
- Mobile browser measurements confirm the Companies and API Keys content widths equal the viewport.
- Mobile browser interaction confirms the navigation opens as a full-height single-column panel.
