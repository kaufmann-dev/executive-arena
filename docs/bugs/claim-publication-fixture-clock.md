# Claim publication fixture expires against wall clock

- Recorded: 2026-07-28 12:22:41 CEST (+0200)
- Base commit: `b5aeaf24f50aa9327fc498f1e6ad0fb171127b8f`

## Symptom

The database-backed MCP lifecycle test rejected a newly claimed company's first successful profile
publication with `The company claim has expired`.

## Root cause

The test fixed its business timestamp at July 26, 2026 and created a claim expiring 45 minutes
later, but it left the publication import's separate trusted claim clock on the real wall time. Once
the real date passed the fixture date, the repository correctly treated the fixture claim as
expired.

## Fix

- Inject the fixture timestamp into the successful claim-authenticated publication's trusted claim
  clock.
- Leave production claim expiry enforcement and the test's explicit expired-claim assertions
  unchanged.

## Verification

- `DATABASE_URL=<test-database> pnpm test:unit --run src/lib/server/integration/mcp.integration.spec.ts`
- `DATABASE_URL=<test-database> pnpm test`
