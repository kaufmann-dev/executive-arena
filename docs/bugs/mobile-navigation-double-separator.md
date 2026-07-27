# Mobile navigation shows a double separator

- Recorded: 2026-07-27 10:08:51 UTC (+0000)
- Base commit: `674332a1063d6ead5c26caca617d51e21af8a70a`

## Symptom

Opening the mobile navigation displayed two parallel horizontal separator lines between the header
and the navigation links.

## Root cause

The sticky site header already rendered a bottom border. The fixed mobile navigation panel began
directly beneath it and rendered its own top border, leaving both separators visible.

## Fix

Remove the mobile navigation panel’s top border and retain the site header’s bottom border as the
single separator.

## Verification

- `pnpm check`
- `pnpm lint`
- Mobile browser styles report a header bottom border and no navigation-panel top border.
