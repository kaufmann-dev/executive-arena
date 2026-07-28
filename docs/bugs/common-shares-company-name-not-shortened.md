# Common-shares company name is not shortened

- Recorded: 2026-07-28 11:46:43 CEST (+0200)
- Base commit: `9d953f4ddafc59c2444302fbad0c3cc94c831190`

## Symptom

The portrait Google query shortened `707 Cayman Holdings Limited Ordinary Shares` to `707 Cayman`,
but left `AIOS Tech Inc. Class A Common Shares` unchanged.

## Root cause

The security-suffix expression recognized ordinary shares and common stock, but omitted common
shares. Because `Class A Common Shares` remained at the end, the legal-suffix pass could not remove
the preceding `Inc.` either.

## Fix

- Recognize singular and plural common shares alongside common stock.
- Cover the complete `Class A Common Shares` followed by legal-suffix shortening sequence with a
  regression test.

## Verification

- Direct reproduction returns `Li Guo - CEO of AIOS Tech (AIOS)`.
- `pnpm test:unit --run src/lib/server/portrait-backfill/google.spec.ts`
- `pnpm check`
- `pnpm lint`
