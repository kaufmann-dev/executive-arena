# Repository Instructions

## Build and Verification

Derive commands from `package.json`, `pnpm-workspace.yaml`, and `drizzle.config.ts`. Use:

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm db:generate
pnpm db:migrate
```

- Run `pnpm check` after Svelte or TypeScript changes.
- Run `pnpm lint` after source or styling changes.
- Run focused Vitest files while iterating, then the smallest reliable broader test command.
- Run `pnpm build` after deployment, routing, server-entry, or adapter changes.
- Generate and execute database migrations through the checked-in Drizzle scripts. Keep
  `src/lib/server/db/schema.ts`, `drizzle/`, and `drizzle.config.ts` aligned.

## Tooling

- Use the Svelte MCP before writing, reviewing, or refactoring Svelte or SvelteKit code:
  - Call `list-sections` first.
  - Fetch every relevant section with `get-documentation`.
  - Run `svelte-autofixer` on changed Svelte files until it reports no issues or suggestions.
  - Generate a playground link only when requested and only for code not written into this repository.
- Use the configured `svelte-file-editor` agent for Svelte component or module work when agent
  delegation is available and appropriate.
- Use `agent-browser` for browser interaction and responsive UI verification. Run
  `agent-browser --help` before its first use in a task.
- Use Podman rather than Docker for local container operations.

## Technology Stack

- Framework: Svelte 5 and SvelteKit with `@sveltejs/adapter-node`
- UI: custom responsive CSS with Tailwind CSS available through Vite
- Icons: `@lucide/svelte`
- Database: Drizzle ORM with PostgreSQL
- Authentication: confidential OIDC Authorization Code flow through `openid-client`
- Validation: Zod
- Images: Sharp with privately stored WebP portraits
- Testing: Vitest with separate server and database-integration projects
- Agent API: Model Context Protocol over stateless Streamable HTTP

Do not introduce optional template infrastructure unless the product feature requires it. This
project does not use Better Auth, shadcn-svelte, Superforms, mode-watcher, Resend, or Paraglide.

## Svelte 5 Patterns

The project forces runes mode for application files.

- Use `$props()` and treat props as changeable.
- Use `$state` only for values that update rendered output or reactive computations.
- Use `$state.raw` for large values that are replaced wholesale rather than deeply mutated.
- Use `$derived` for computed state and `$derived.by` only for multi-line computation.
- Avoid `$effect`. Prefer derived values or react at an event boundary. Use `<svelte:window>` or
  `<svelte:document>` for global listeners instead of lifecycle effects.
- Use snippets and `{@render ...}` for reusable markup.
- Use `onclick`, `onchange`, and other event attributes rather than legacy `on:` directives.
- Use class arrays or objects rather than `class:` directives in new and refactored code.
- Key `{#each}` blocks with stable object identifiers. Do not use array indexes as keys.
- Use CSS custom properties at component boundaries and preserve the established editorial visual
  language.
- Prefer attachments for new reusable DOM behavior. SvelteKit's existing `use:enhance` form action
  is allowed.

Avoid legacy `export let`, `$$props`, `$:` statements, slots, `<svelte:component>`,
`<svelte:self>`, and `on:` event attributes in new code.

## UI and Accessibility

- Use `@lucide/svelte` for interface icons.
- Preserve semantic HTML, visible focus states, keyboard operation, useful ARIA labels, and minimum
  42px touch targets for primary mobile controls.
- Keep wide tables and navigation within local horizontal scrollers; never make the document itself
  horizontally scroll.
- Verify changed layouts at desktop and narrow mobile widths.

## Server, Data, and Security

- Validate server-action and MCP inputs with Zod before mutation.
- Keep browser authentication and MCP API-key authentication separate.
- Preserve readiness as a derived property: included companies with an active slate are ready;
  included companies without one are not ready; excluded companies are excluded.
- Keep profile publication atomic and schema-version 3. Roles, summaries, facts, and portraits require
  citations, and each executive requires one to three real HTTPS portraits.
- Do not expose portrait bytes, session secrets, OIDC secrets, Massive credentials, or MCP tokens in
  logs or client data.
- Read deployment variables from `process.env`; required variables are documented in `README.md` and
  `.env.example`.

## Deployment

- Keep the Node and pnpm versions in `package.json` authoritative.
- Preserve the adapter-node and SvelteKit CSP configuration in `vite.config.ts`.
- Keep Coolify/Nixpacks changes scoped to the confirmed failing layer.
- Database migrations must remain safe to run automatically before the production server starts.
