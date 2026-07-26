# Executive Arena

Executive Arena is a private, single-owner experiment that ranks active US-listed public companies through repeated choices between their leadership slates. A frozen, cited executive dataset feeds pair selection and a Bradley–Terry leaderboard. The hosted MCP server synchronizes the Massive company universe and manages executive research from end to end.

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
- `MASSIVE_API_KEY` — Massive credential used by the MCP universe synchronization tool.
- `RESEARCH_CREDENTIAL_ENCRYPTION_KEY` — base64-encoded 32-byte AES key used to encrypt
  website-managed model-provider credentials. Generate it once with
  `openssl rand -base64 32`, store it as a secret, and keep the same value for the web and
  research-worker services.

## Agent Research Pipeline

The deployed application exposes a stateless Streamable HTTP MCP server at `/mcp`. A local agent can operate the complete research workflow without local manifests, profile files, or import commands:

1. Call `sync_massive_universe`. Omit `asOf` to use the current UTC date. The server fetches Massive directly, checkpoints ticker overviews in PostgreSQL, validates the complete snapshot, and imports it atomically.
2. If the result is `needs_alias_review`, review every returned no-CIK listing and call the same tool again with `reviewedAliases`. Map every share-class ticker for one issuer to the same stable `alias:issuer-name` value. Accepted aliases are retained for later synchronizations.
3. Page through `list_research_companies`, call `get_executive_research_task` for each pending company, and submit either `publish_executive_profile` or `report_executive_research_issue`.
4. Check `get_research_coverage`. When every included company is ready and no review issues remain, call `freeze_cohort`.

Universe synchronization must finish before the cohort is frozen. Interrupted Massive requests can be retried with the same date and resume saved ticker details. Every schema-version 2 profile is validated, every leadership role must cite an official-company or SEC source, every factual claim requires citations, and each executive must provide one to three ordered HTTPS portraits. Portraits are downloaded and transformed before publication, and valid submissions become visible immediately.

Manage MCP credentials from **API Keys** in the authenticated application. Each independently named key has full research read/write access, remains active until explicitly deleted, and is shown only once. PostgreSQL stores only a SHA-256 digest; no MCP API key belongs in Coolify or another environment variable.

Configure an MCP client with the deployed `https://<origin>/mcp` URL and an `Authorization: Bearer <generated-key>` HTTP header. Deletion is checked from PostgreSQL on every call and takes effect immediately. MCP keys cannot access browser pages, manage other keys, exclude companies, or submit comparisons.

## Automated Research Runner

The authenticated **Research** page manages OpenAI-compatible model providers and resumable
population runs. Provider API keys are encrypted with AES-256-GCM before PostgreSQL storage and
are never returned to the browser after submission. A provider can have multiple model
configurations, each with its own concurrency, requests-per-minute, tokens-per-minute, timeout,
output-token, and retry limits.

Every run snapshots the selected endpoint, model identifier, limits, prompt version, and Massive
universe revision. PostgreSQL jobs use leases, retry backoff, and idempotent atomic profile imports,
so a worker restart or deployment does not lose progress. The worker gathers official company pages
and SEC filings, extracts responsive and lazy-loaded official portrait candidates, requires the model
to return a validated cited artifact, and publishes only through the existing research importer.
Insufficient evidence is recorded for manual review.

Run one worker process against the same PostgreSQL database:

```sh
pnpm research:worker
```

Use `pnpm research:worker --once` to process one available batch and exit. The website reports a
worker as online while its database heartbeat is current. Starting, pausing, resuming, or cancelling
a run happens through the website and does not require restarting the worker.

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
- Set `MASSIVE_API_KEY` as a secret runtime variable so MCP agents can synchronize the company universe.
- Set `RESEARCH_CREDENTIAL_ENCRYPTION_KEY` to the same base64-encoded 32-byte secret in both
  services.
- No MCP credential is configured in Coolify; generate and delete MCP keys from the deployed authenticated website.
- Deploy a second service from this repository for automated research, using
  `node --import tsx src/research-worker.ts` as its Start Command and the same `DATABASE_URL`,
  `ORIGIN`, and `RESEARCH_CREDENTIAL_ENCRYPTION_KEY` values as the web service. Leave its domain and
  HTTP health check empty. After adding or changing the Start Command, redeploy with **Rebuild
  without cache** so Coolify does not reuse the previous pnpm-based launch configuration.
