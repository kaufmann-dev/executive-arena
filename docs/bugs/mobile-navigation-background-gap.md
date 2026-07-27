# Mobile navigation exposes a background strip

- **Recorded:** 2026-07-27 10:20:16 UTC (+0000)
- **Base commit:** `4436e8f16f381e35d168c158dbb120fad06f0920`

## Symptom

Opening the mobile navigation exposed a one-pixel strip of the underlying page between the fixed
header and the navigation panel.

## Root cause

At the mobile breakpoint, the rendered header was 64 pixels tall while the fixed navigation panel
used a 65-pixel top inset. Browser measurements confirmed a one-pixel gap between the header bottom
and panel top.

## Fix

Align the navigation panel's top inset and viewport-height calculation with the rendered 64-pixel
mobile header.

## Verification

- `pnpm check`
- `pnpm lint`
- At a 379-by-844 browser viewport, the header bottom and navigation panel top both measure 64 pixels.
