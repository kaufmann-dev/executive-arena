# Legacy executive profiles rejected during MCP reads

- Recorded: 2026-07-28T14:25:33+02:00
- Base commit: `cc4195973ca04b6c19203a90b8f22bb0671baaf0`

## Symptom

The MCP rejected 357 stored executive profiles while reading company tasks because at least one
persisted summary exceeded the current 100-word publication limit. This prevented duplicate-company
research even though the historical profile was already valid database state.

## Root cause

The MCP output contract reused the publication schema for `currentProfile`. Publication refinements,
including the 50–100 word summary policy, were therefore reapplied to legacy persisted records during
serialization. A policy intended to constrain new writes incorrectly made older readable data fail
the tool's output validation.

## Fix

- Add a strict structural schema for persisted profile reads that retains field types, required
  sources, portrait shape, and portrait-count bounds without reapplying summary-word or slate-policy
  refinements.
- Keep the existing publication schemas as the only write path, including the 50–100 word summary
  constraint.
- Use the persisted schema only for MCP `currentProfile` output.

## Verification

- Added a 114-word legacy summary regression proving `get_company_profile` returns the stored
  profile while a new publication with the same summary is rejected.
- Ran focused schema and MCP server tests, the full type check, lint, test suite, and production
  build.
