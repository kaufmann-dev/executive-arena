# Massive universe atomic import rejects fractional market caps

- Recorded: 2026-07-26 15:27:16 CEST (+0200)
- Base commit: `a094a6e7e1030311fc2e837f5ef6e1f79498e987`

## Symptom

The 2026-07-26 Massive universe synchronized and validated 5,304 listings, but its atomic database
import failed during the company upsert. The transaction rolled back without publishing a partial
universe.

## Root cause

Massive returns market capitalization as a finite nonnegative number and real responses contain
fractional values, such as Agilent Technologies' `39136594480.08`. The normalized universe preserved
those values, but the `company.market_cap` and `security_listing.market_cap` columns were PostgreSQL
`bigint` columns. PostgreSQL rejected the first fractional market cap written by the atomic import.

## Fix

- Change both persisted market-cap columns to `double precision`, matching the provider and
  application number contract without rounding away fractional values.
- Add a migration that converts existing nullable `bigint` values in place.
- Exercise the complete database-backed MCP synchronization with a production-shaped fractional
  market cap and assert the value in both company and listing rows.

## Verification

- `pnpm check`
- `pnpm lint`
- `DATABASE_URL=<test-database> pnpm db:migrate`
- `DATABASE_URL=<test-database> pnpm exec vitest run src/lib/server/integration/mcp.integration.spec.ts`
- Production build with representative required environment variables
