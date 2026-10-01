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
- `BODY_SIZE_LIMIT` — optional adapter-node request-limit override; production defaults to `25M`, while the application accepts images up to 20 MB.
- `ORIGIN` — public application origin, including scheme and without a path. It must also be available at build time, where it becomes SvelteKit's `paths.origin` for CSRF checks behind the reverse proxy.
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
5. Use `exclude_companies` for a verified blank-check or non-operating shell, an executive profile that cannot be completed after diligent research, or overlapping executive coverage where another related company or investment vehicle is retained. Batches of up to 25 exclusions are atomic and exact repeats are idempotent.
6. Check `get_cohort_status`. Its `claimed` and `available` counts distinguish assigned from unassigned not-ready work. When every included company is ready, call `freeze_cohort`.

Universe synchronization must finish before the cohort is frozen. Interrupted Massive requests can be retried with the same date and resume saved ticker details. Every schema-version 4 profile requires a current top-executive role, a 50–100 word summary, and at least one shared HTTP(S) source per executive; facts and portrait provenance are optional. Profiles without portraits are saved as missing-image profiles and stay out of comparisons until every top executive has a portrait. Agents should preferably submit three distinct direct HTTPS portraits when readily available, while invalid or unavailable images no longer block the sourced text profile.

Portrait `image_url` values must point directly to downloadable HTTPS image assets, not leadership, investor-relations, or SEC HTML pages or PDF documents. Portraits are downloaded with browser-style request metadata and validated before publication. When portrait provenance is supplied, the query-free source page is also sent as the request referrer. JPEG, PNG, WebP, AVIF/HEIF, GIF, and TIFF inputs are normalized from their first frame or page into metadata-free WebP without enlargement. After orientation, each accepted image must be at least 100 pixels on both sides and contain at least 15,000 pixels. Failed portrait candidates are diagnosed and discarded without blocking an otherwise valid sourced text profile. Duplicate normalized image content is rejected. Valid submissions become visible immediately, while rejected publication and candidate-validation responses expose only sanitized HTTP and decoded-image diagnostics.

An included company is ready exactly when it has an active leadership slate and every active leader has a portrait. Manual exclusions use one of three enumerated reasons: blank-check or non-operating shell, incomplete executive profile, or overlapping executive coverage. Overlap exclusions record the related company whose coverage is retained. Manual exclusions preserve leadership research and portraits and can be reversed from the company administration page. Universe-detected blank-check exclusions remain locked until the universe changes, while issuers absent from the latest universe are archived and omitted from active administration and MCP coverage.
Claims are temporary coordination state, not readiness or completion history. An active claim protects its company from other MCP publishers, while unclaimed companies can still be published directly. Expired claims become available automatically, explicit release makes them available immediately, and successful publication or exclusion removes them. Inspection responses expose only an active claim's expiry; claim tokens, token hashes, and owners remain private.

Manage MCP credentials from **API Keys** in the authenticated application. Each independently named key has full research read/write access, remains active until explicitly deleted, and is shown only once. PostgreSQL stores only a SHA-256 digest; no MCP API key belongs in Coolify or another environment variable.

Configure an MCP client with the deployed `https://<origin>/mcp` URL and an `Authorization: Bearer <generated-key>` HTTP header. Deletion is checked from PostgreSQL on every call and takes effect immediately. MCP keys cannot access browser pages, manage other keys, include companies, or submit comparisons.

## Portrait Backfill

The authenticated **Portraits** page at `/admin/portrait-backfill` provides an assisted manual
workflow for one company at a time. **No images** targets executives without a portrait, while
**Fewer than 3** targets executives with open portrait slots. Skipping a company removes it from
both active queues until it is saved or returned through the **Skipped** queue. Each executive has
an unquoted Google Images query combining their name, concise title, shortened issuer name, and
ticker. The explicit search link reuses one named browser tab; the application does not call,
scrape, or proxy Google.

Copy an image from the search results and paste it into the matching executive's upload area, or
drop/select local image files. Repeated pastes accumulate up to the executive's three-portrait
limit and show removable previews. A submitted batch is limited to 20 MB, normalized to
metadata-free WebP, checked for image dimensions and exact-content duplicates, and saved in one
database transaction. If any image fails validation, none of the batch is saved. Successful saves
advance directly to the next queue company. Manual backfill stores only the normalized portrait
bytes and generated alt text; it does not require or store search-result URLs or provenance.
When any active leader has no portrait, **Exclude & show next** records the reversible
**Executive profile incomplete** reason, preserves all existing research and portraits, and
advances the queue after native confirmation.

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
- Set these required runtime environment variables in Coolify: `DATABASE_URL`, `ORIGIN`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`. `BODY_SIZE_LIMIT` may override the `25M` production default. Keep `ORIGIN` available at build time as well (Coolify's default), because the build embeds it as SvelteKit's public origin.
- Set `MASSIVE_API_KEY` as a secret runtime variable so MCP agents can synchronize the company
  universe.
- No MCP credential is configured in Coolify; generate and delete MCP keys from the deployed authenticated website.
