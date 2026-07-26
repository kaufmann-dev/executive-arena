# Massive universe sync fails during MCP output validation

- Recorded: 2026-07-26 15:13:23 CEST (+0200)
- Base commit: `4fa5366a0a1a81c2f9e668a38e47e49fa98af6f4`

## Symptom

Calling `sync_massive_universe` returned `Cannot read properties of undefined (reading '_zod')`
instead of the completed universe synchronization result.

## Root cause

The tool declared its output as a top-level Zod discriminated union. In
`@modelcontextprotocol/sdk` 1.29.0, MCP output validation normalizes the configured output schema to
an object schema but does not fall back to the original schema when normalization returns
`undefined`. A top-level union therefore caused the SDK to call Zod with an undefined schema after
the sync handler completed.

## Fix

- Replace the top-level union with an object-rooted MCP output schema.
- Retain the discriminated union internally and apply it through `superRefine` so fields remain
  conditional on the sync status.
- Cover imported, alias-review, and mismatched status/field outputs through the connected MCP client.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm exec vitest run src/lib/server/mcp/server.spec.ts`
