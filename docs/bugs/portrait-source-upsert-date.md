# Portrait source upsert rejects retrieved timestamp

- Recorded: 2026-07-28 09:53:31 CEST (+0200)
- Base commit: `489fc4b709f917e15014ff69e4034e697fa58660`

## Symptom

Saving a Brave portrait candidate failed while upserting its source record. PostgreSQL received an
unsupported JavaScript `Date` for the conflict update's `greatest(source.retrieved_at, retrievedAt)`
expression, so the portrait was not saved.

## Root cause

The portrait save path interpolated `retrievedAt` directly into a raw Drizzle SQL template. Unlike
the typed insert value, the raw parameter bypassed the `source.retrieved_at` column encoder and
reached the PostgreSQL driver as a JavaScript `Date`.

## Fix

- Move the existing encoded latest-source timestamp expression into a shared database query helper.
- Use `sql.param(retrievedAt, source.retrievedAt)` through that helper in both portrait and research
  source upserts.
- Keep the SQL-generation regression test asserting that every timestamp parameter is encoded as an
  ISO string.

## Verification

- `pnpm test:unit --run src/lib/server/research-import/drizzle-repository.spec.ts src/lib/server/portrait-backfill/ingest.spec.ts`
- `pnpm check`
- `pnpm lint`
