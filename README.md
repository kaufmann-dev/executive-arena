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

## Agent Research Pipeline

The deployed application exposes a stateless Streamable HTTP MCP server at `/mcp`. A local agent can operate the complete research workflow without local manifests, profile files, or import commands:

1. Call `sync_massive_universe`. Omit `asOf` to use the current UTC date. The server fetches Massive directly, checkpoints ticker overviews in PostgreSQL, validates the complete snapshot, and imports it atomically.
2. If the result is `needs_alias_review`, review every returned no-CIK listing and call the same tool again with `reviewedAliases`. Map every share-class ticker for one issuer to the same stable `alias:issuer-name` value. Accepted aliases are retained for later synchronizations.
3. For parallel work, call `claim_companies` to atomically receive up to ten unclaimed not-ready companies, their complete research tasks, and distinct 45-minute bearer claim tokens. Use `renew_company_claim` when active work needs more time and `release_company_claim` when abandoning work. `list_companies` and `get_company_profile` remain available for inspection and deliberate unclaimed work. Use `get_company_profiles` to retrieve up to 25 known company tasks in one request.
4. Test uncertain direct image assets with `validate_portrait_candidate`, then submit `publish_executive_profile` when the complete profile is supported by citations. Prepared batches can use `validate_portrait_candidates` and `publish_executive_profiles` for up to 25 inputs. Batch publication isolates each company and reports individual rejections without aborting successful items. Pass matching `claimToken` values for actively claimed companies; successful publication consumes each claim atomically.
5. Check `get_cohort_status`. Its `claimed` and `available` counts distinguish assigned from unassigned not-ready work. When every included company is ready, call `freeze_cohort`.

Universe synchronization must finish before the cohort is frozen. Interrupted Massive requests can be retried with the same date and resume saved ticker details. Every schema-version 3 profile is validated, every leadership role and factual claim requires citations, and each executive must provide one to three ordered HTTPS portraits. Agents should seek two or three distinct portraits across official sites, SEC exhibits, press releases, conference or speaker biographies, reputable news, and professional biographies; one is acceptable after reasonable research finds no additional attributable option. Reputable secondary HTTP(S) citations are accepted.

Portrait `image_url` values must point directly to downloadable HTTPS image assets, not leadership, investor-relations, or SEC HTML pages or PDF documents. Portraits are downloaded and validated before publication. JPEG, PNG, WebP, AVIF/HEIF, GIF, and TIFF inputs are normalized from their first frame or page into metadata-free WebP without enlargement. After orientation, each accepted image must be at least 100 pixels on both sides and contain at least 15,000 pixels. A failed first portrait rejects the complete profile before an atomic database write; failed optional second or third portraits are diagnosed and discarded when the executive retains the required valid portrait. Duplicate image content remains a hard failure. Valid submissions become visible immediately, while rejected publication and candidate-validation responses expose only sanitized HTTP and decoded-image diagnostics.

An included company is ready exactly when it has an active leadership slate; excluded companies and included companies without an active slate are derived as excluded and not ready, respectively.
Claims are temporary coordination state, not readiness or completion history. An active claim protects its company from other MCP publishers, while unclaimed companies can still be published directly. Expired claims become available automatically, explicit release makes them available immediately, and successful publication or exclusion removes them. Inspection responses expose only an active claim's expiry; claim tokens, token hashes, and owners remain private.

Manage MCP credentials from **API Keys** in the authenticated application. Each independently named key has full research read/write access, remains active until explicitly deleted, and is shown only once. PostgreSQL stores only a SHA-256 digest; no MCP API key belongs in Coolify or another environment variable.

Configure an MCP client with the deployed `https://<origin>/mcp` URL and an `Authorization: Bearer <generated-key>` HTTP header. Deletion is checked from PostgreSQL on every call and takes effect immediately. MCP keys cannot access browser pages, manage other keys, exclude companies, or submit comparisons.

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
- No MCP credential is configured in Coolify; generate and delete MCP keys from the deployed authenticated website.
