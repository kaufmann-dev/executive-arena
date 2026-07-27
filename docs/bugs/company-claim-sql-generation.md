# Company claim tools fail before assignment

- Recorded: 2026-07-27 13:09:42 UTC (+0000)
- Base commit: `5e198b3994387aa4dac2ae367d21797032ae32bf`

## Symptom

`claim_companies` failed before returning work while deleting expired rows from
`executive_research_claim`. `get_cohort_status` also failed after claim coverage fields were added,
while `list_companies` could successfully join the same claim table.

## Root cause

Expired-claim cleanup interpolated a JavaScript `Date` into a raw SQL fragment. That bypassed the
claim table's timestamp column encoder, so the PostgreSQL driver received the unsupported raw date
value. Separately, the coverage count embedded a correlated claim lookup directly in raw SQL.
Drizzle removed the outer table qualifier and generated `"company_id" = "id"` instead of
correlating `executive_research_claim.company_id` to `company.id`.

The working `list_companies` query proved that the deployed claim table and migration existed. The
live coverage error exposed the malformed correlation, and compiled local SQL showed the raw cleanup
parameter remained a `Date` while the typed comparison encoded it as an ISO timestamp.

## Fix

- Use Drizzle's typed `lte()` comparison for expired-claim deletion.
- Build active-claim correlation with a query-builder subquery and `exists()`.
- Add SQL-generation regression tests for timestamp encoding and qualified outer references.

## Verification

- Live MCP reproduction before the fix for `claim_companies` and `get_cohort_status`.
- `pnpm exec vitest run src/lib/server/research-claim-query.spec.ts`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
