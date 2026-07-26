# Executive Arena

Executive Arena is a private, single-owner experiment that ranks active US-listed public companies through repeated choices between their leadership slates. A frozen, cited executive dataset feeds pair selection and a Bradley–Terry leaderboard. The company universe is imported offline from Massive, while executive profiles can be researched and published through the hosted MCP server.

## Local Setup

Requirements: Node.js 24 or newer, pnpm 11.16.0, and PostgreSQL.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:migrate
pnpm dev
```

Build and run the production server with `pnpm build` followed by `pnpm start`.

## Environment

Runtime variables, all required:

- `DATABASE_URL` — PostgreSQL connection URL.
- `ORIGIN` — public application origin, including scheme and without a path.
- `OIDC_ISSUER` — OIDC provider issuer URL.
- `OIDC_CLIENT_ID` — confidential OIDC client identifier.
- `OIDC_CLIENT_SECRET` — confidential OIDC client secret.

Offline research variable:

- `MASSIVE_API_KEY` — required only by the universe import; do not deploy it with the web application.

## Offline Research Pipeline

Create `data/reviewed-issuer-aliases.json` as a JSON object. It may start as `{}`; when Massive returns an eligible listing without a CIK, add every reviewed share-class ticker as an uppercase key pointing to the same stable value in the form `alias:issuer-name`.

Generate a fixed-date, self-verifying Massive snapshot and ten-company research batches:

```sh
pnpm research:universe -- 2026-07-24 data/reviewed-issuer-aliases.json data/universe.json
pnpm research:prepare -- data/universe.json data/research-batches.json
pnpm research:import -- universe data/universe.json
```

Choose the intended market snapshot date instead of copying the example date blindly. Ticker Overview responses and their Massive request IDs are cached atomically under `data/universe.json.checkpoint/`; rerunning the same command after a transient failure resumes completed tickers. The output records the provider date, retrieval time, exact counts, request IDs, and a SHA-256 payload hash.

Produce cited profiles from `prompts/executive-profile.md`, then validate and import them:

```sh
pnpm research:validate -- --tasks data/research-batches.json data/profiles/*.json
pnpm research:import -- profiles --approved data/profiles/*.json
pnpm cohort:freeze
```

Manifest-aware validation fails unless profile coverage is exact: every expected issuer appears once, every identity field matches its task, and there are no invalid, `needs_review`, duplicate, missing, or unexpected results. The import commands require `DATABASE_URL`. Profile import requires the explicit `--approved` acknowledgment after human review, processes at most ten profiles per transaction, needs outbound access to each HTTPS portrait URL, and accepts either one profile or an array per JSON file. Every leadership role must cite an official-company or SEC source. The cohort can be frozen only after every included company has a complete, valid leadership profile.

## Hosted Research MCP

The deployed application exposes a stateless Streamable HTTP MCP server at `/mcp`. It lists research coverage and company tasks, accepts complete schema-version-1 executive profiles, and records structured `needs_review` issues when evidence is insufficient. A valid submission uses the same validation, portrait transformation, cohort revision, and ranking-refresh path as an approved offline import and becomes visible immediately.

Manage MCP credentials from **API Keys** in the authenticated application. Each independently named key has full research read/write access, remains active until explicitly revoked, and is shown only once. PostgreSQL stores only a SHA-256 digest; no MCP API key belongs in Coolify or another environment variable.

Configure an MCP client with the deployed `https://<origin>/mcp` URL and an `Authorization: Bearer <generated-key>` HTTP header. Revocation is checked from PostgreSQL on every call and takes effect immediately. MCP keys cannot access browser pages, manage other keys, exclude companies, or submit comparisons.

## Authentication Setup

Configure a confidential Authorization Code client with ClientSecretPost, PKCE S256, and the provider access policy as the sole admission control; do not create an application allowlist. Executive Arena stores only an opaque application session in its cookie.

Public Client: Off  
Callback URL: `/auth/callback`  
Logout Callback URL: `/auth/logged-out`  
Authentication environment variables: `ORIGIN`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` are required; see [Environment](#environment).

## Coolify Deployment

- Build Pack: Nixpacks.
- Base Directory: `/`.
- Do not enable static-site mode or set a Publish Directory.
- No pre- or post-deployment command is required; the server applies checked-in database migrations before serving requests.
- Set these required runtime environment variables in Coolify: `DATABASE_URL`, `ORIGIN`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`.
- No MCP credential is configured in Coolify; generate and revoke MCP keys from the deployed authenticated website.
- Keep `MASSIVE_API_KEY` out of Coolify; it is used only by the offline research pipeline.
