# Active leadership profile remains pending

- Recorded: 2026-07-27 08:06:00 UTC (+0000)
- Base commit: `9e2bc23c1d753ecf6cd745fd3574dedd65bbb0f7`

## Symptom

An included company with a complete active leadership slate appeared pending on the website and from
`get_executive_research_task`, while `list_research_companies` classified the same company as ready.

## Root cause

The shared readiness helper embedded a correlated subquery directly in a raw Drizzle SQL template.
When an outer query selected only from `company`, Drizzle removed table qualifiers and emitted
`leadership_slate.company_id = leadership_slate.id` instead of correlating to `company.id`. Queries
with an outer join retained the qualifier, which made the MCP list path work while the task and
website paths failed.

## Fix

- Build the active-slate correlated subquery with Drizzle's query builder and `exists()`.
- Keep readiness derived exclusively from company inclusion and active-slate existence.
- Assert the generated SQL keeps `company.id` qualified for single-table and joined outer queries.

## Verification

- `pnpm check`
- `pnpm lint`
- `pnpm exec vitest run src/lib/server/readiness.spec.ts`
