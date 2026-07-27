# MCP read tools fail output validation

- Recorded: 2026-07-27 10:29:12 UTC (+0000)
- Base commit: `466aa7d057d584c745fa6c3a7b59dc5b06abb559`

## Symptom

The `get_cohort_status` MCP tool failed because `universeAsOf` was a JavaScript `Date` instead of a
string. The `list_companies` tool failed because every returned item omitted the required
`included` boolean. The shared date mapping would also have caused `get_company_profile` to fail.

## Root cause

The MCP research service returned database values without fully mapping them to its public output
schemas. It passed the PostgreSQL `timestamptz` universe date through as a `Date`, and the
`list_companies` response mapper dropped the selected `included` field. Unit-test mocks already used
the intended public types, so they did not reproduce the database-backed mismatch.

## Fix

- Serialize universe dates as `YYYY-MM-DD` strings in cohort-status and company-profile responses.
- Preserve the selected `included` boolean in every company-list item.
- Assert the mapped date and inclusion fields in the database-backed MCP lifecycle test.
