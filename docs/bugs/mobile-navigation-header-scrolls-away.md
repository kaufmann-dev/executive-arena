# Mobile navigation header scrolls away

- **Observed:** 2026-07-27 10:14:59 UTC (+0000)
- **Base commit:** `988091fd932f83115957993a5b75e2dfd87c667c`

## Symptom

With the mobile navigation open, scrolling could move the sticky header out of the viewport while the fixed navigation panel remained offset below it. This exposed the underlying page above the menu.

## Root cause

The open state disabled scrolling on `body` only. Mobile browsers can use the root `html` element as the scrolling container, and the header remained `position: sticky` while the menu panel used a fixed top offset.

## Fix

Pin the header with `position: fixed` while the mobile menu is open. Lock scrolling and overscroll on both `html` and `body` for the same state.

## Verification

Run `pnpm check` and `pnpm lint`. At a mobile viewport, open the navigation and attempt to scroll the page; the header must remain at the top and no page content may appear above the navigation panel.
