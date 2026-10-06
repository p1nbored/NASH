# NASH Remote MCP

## Private Sites deployment

Published origin: `https://nash-dot-mcp.taojuguo.chatgpt.site`. This checkout targets an owner-private test Site, with 12 MCP tools, 13 routes and 37 generated v3 conformance vectors. A publication does not establish a NASH App or MCP client connection.

Sites dispatch owns authentication and consumes service access before forwarding to the Worker. Data-bearing MCP calls and browser approval/revocation require the verified ChatGPT user. Device operations additionally enforce `Nash-Session` or the rotating `Nash-Device-Credential`; neither substitutes for platform service access. The fixed registered origin and production runtime enable hosted routes. Keep this Site owner-private; changing its audience requires another server admission design. Never embed a platform service token in this source or the browser.

Production hides the simulation UI and refuses legacy `/api/scaffold/*` writes. The disposable admission literal works only on a development loopback preview. Pairing approval never claims a connected App until the device finishes enrollment and publishes its heartbeat.

Storage remains a bounded 1 MiB atomic snapshot for this private test deployment, with 64 KiB reserved for security revocation. Pairing allocations also preserve their own headroom; expired metadata is cleaned in bounded batches. This layout has not been certified for production scale or physical backup deletion. The actual App polling integration, durable platform service-access provisioning and an installed MCP client's tool call remain separate live checks.

Refresh generated contracts with the pin/compiler scripts after reviewing upstream changes. Do not hand-edit generated artifacts. Hosted migrations are applied by Sites during deployment; never replay or edit already applied migrations.

## Validation decisions (contract v3)

The Site supports `nash_list_validation_decisions` and `nash_decide_validation` alongside the existing tools. It preserves the desktop-masked title, fixed reason and summary unchanged, lists only the oldest 50 open decisions per binding, and queues waive/reject with decisionId deduplication and an accepted-submit dependency. A settled decision cannot reopen. The decide item TTL starts at the call; pending visibility lasts seven days. Status exposes the bundled manifest hash `94bbd6fc2964a3a8ef79fb4000dfafd3d14a8d5567f5d6f20269fc223bad4c19`.

Rebuild NASH with the v3 contract before pairing: v2 heartbeats are rejected. Old accepted receipts/events remain readable and old request snapshots acquire an empty validation fold. Queued v2 payloads retain their original hash, remain cancelable/readable and expire at their original TTL; they are not delivered as v3. The isolated v2 scaffold tests remain historical fixtures, outside the production generated catalog.

## Current R2 increment

The following sections record the earlier local increments; the private deployment section above supersedes their unavailable-hosted-route statements.

The local implementation now exposes all 10 generated tools and 11 routes. The original single-tool scaffold description below is historical. Pinned bundle/static validators are under `generated/`; production rejects local fixture admission. There is still no deployed Site or real NASH connection. Final evidence: 102 tests and all24 vectors pass; typecheck/build and actual local HTTP flow pass. See repository report `docs/dot-mcp-r2-local-integration-2026-10-05.md`.

Builds verify bundled pins and static validators without a parent App checkout. To intentionally update from a reviewed new App contract, run `node scripts/pin-remote-artifacts.mjs`, then `node scripts/compile-remote-schemas.mjs`; do not edit generated files. Use `--check` on each script to detect source or generated drift.

Migration `drizzle/0001_heavy_magdalene.sql` adds the atomic local state table and has already been applied to this preview. Apply pending migrations only, never replay prior SQL. The persistent snapshot is capped at 1 MiB for local tests and is not the approved production storage layout.

The `/pairing` page approves a local fake-client code via `/pairing/approve`. All NASH routes admit only the disposable development fixture. Real Sites service access, credentials and enrollment remain outside this local increment. Run `node scripts/remote-http-smoke.mjs http://127.0.0.1:5178` against the dev preview; the older fake-agent script now forwards there. Production Worker checks must keep their XDG config directory inside `.sites-runtime` when the host config path is sandboxed.

## Original scaffold reference

This checkout is the local-only hosted-side increment authorized in `docs/dot-mcp-remote-plan.md`. No Site identity, real pairing, credentials, mailbox or task execution exists here. Do not publish it as a working connection.

Implemented: stateless `/mcp` initialization/discovery with one read-only scaffold `nash_status` tool; owner identity required for status calls; bounded JSON bodies and same-origin checks; owner-scoped local D1 fixtures; hashed five-minute, single-use approval challenges; persistent 30-call/minute **shared owner** limits; bounded expiry cleanup; fake-client tests and an explicit simulation page.

The shared owner cap is deliberately conservative: self-reported client labels cannot evade it. A verified caller/device scope will come from the generated R2 integration. Only `params.hello` is extracted from the v2 golden for the scaffold status input, with source SHA-256 recorded. This is not the R2 manifest. Write tools, inbox/ack/events, queued receipts and real sessions stay unavailable until generated R2 files are pinned and integrated.

## Local commands

From `sites/nash-dot-mcp` on Node 24:

```powershell
node scripts/extract-scaffold-schema.mjs
node --experimental-strip-types --test tests/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

On this Windows host the generic plugin/npm command shim resolves its npm JS paths incorrectly. Invoke the installed entrypoint directly when that happens:

```powershell
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' --prefix . --workspaces=false run build
```

After the first build, apply the generated migration **once** to local D1, then start the loopback development preview:

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_eminent_jubilee.sql
npm run dev -- --hostname 127.0.0.1 --port 5178
```

The migration was applied locally during the 2026-10-05 implementation. Do not replay it against that same local database. Never replace `--local` with `--remote` for scaffold verification.

The portable starter supplies local demo sign-in; it is not included in the built production Worker. Click **Sign in for local test**, create a challenge, then approve the demo device. Approval consumes only the fixture record and never establishes access. Run the fake client against that running preview:

```powershell
node scripts/fake-agent-smoke.mjs http://127.0.0.1:5178
```

The fake client deliberately reaches the local account rate limit. Wait until its next minute window before rerunning or testing more UI actions. It keeps the local demo cookie in memory and refuses non-loopback URLs. No Site service-access token or real NASH secret is used.

Unit/storage tests execute the generated migration against real `node:sqlite`; the HTTP smoke uses local Miniflare D1. Current evidence and deployment blockers are recorded in `docs/dot-mcp-local-scaffold-2026-10-05.md` and `docs/dot-mcp-hosting-h1-2026-10-05.md` at the repository root.

## Retained Sites starter reference

A clean full-stack starter running on [vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Portable: Windows, macOS, or Linux; no Bash required
- Managed Linux: managed Linux runtime with Bash, `flock`, `curl`, `sha256sum`, and GNU `timeout`
- Git is required only for publishing

## Sites Lifecycle

The Sites initializer copies the shared starter and selects managed-linux only when `SITES_MANAGED_LINUX_CONTAINER=1`; otherwise it selects portable. It saves the selection only in ignored `.sites-runtime/execution-profile.json`. Both profiles copy/configure first, then use the plugin's separate `install-dependencies.mjs` step to measure installation independently. Edit source under `app/` and follow the Sites skill for installation, preview, builds, and publishing.

Run `node <plugin-root>/scripts/configure-execution-profile.mjs` only when the profile is unknown for the current checkout and environment. Profile changes do not alter tracked source or require reinstalling otherwise-valid dependencies; restart an existing preview to use the new selection. Do not commit or upload `.sites-runtime/`.

This starter does not use `wrangler.jsonc`.

`install:ci` runs `npm ci` once against the shared lockfile, disables parent-workspace discovery, and includes required dev/optional dependencies despite production/omit settings. Sharp defaults to prebuilt binaries unless explicitly configured otherwise. Do not overlap installers.

- **Portable:** Preserve host HOME, npm cache, registry, proxy, temporary paths, retry/concurrency settings, and lifecycle-script policy. Use `--prefer-offline --no-audit --no-fund`.
- **Managed Linux:** Use the existing project-local HOME/cache/tmp setup and Linux install lock, tarball preflight, and timeout. Restore the image-seeded npm cache only when its lockfile hash matches; retain network fallback. Builds keep their existing timeout. These helpers are not invoked by the portable profile.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

On portable, `npm run dev` uses `vinext dev` with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state, rejects an ordinary duplicate launch, and recovers stale state after a stopped process; exactly simultaneous starts can race. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep portable previews on loopback.

For browser QA on managed Linux, use `sites-preview start`. The project's dev script runs Vite and accepts the supervisor's `--host 0.0.0.0 --port 4173 --strictPort` arguments. The internal browser uses `http://terminal.local:4173/`; it is not a user-facing URL. The supervisor owns the preview lifecycle. The ignored local profile survives the supervisor's cleared process environment.

The portable profile simulates ChatGPT sign-in only for loopback development requests. Visit `/signin-with-chatgpt?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`) and `/signout-with-chatgpt?return_to=/` to sign out. The development cookie preserves that identity across server restarts. Mock auth is disabled in the managed-linux profile and is not included in production builds; hosted authentication remains dispatch-owned.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. From the project root, apply each pending migration in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_example.sql
```

Replace the filename with the pending migration and `DB` with your D1 binding name if different. Use `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories. Do not replay migrations already applied locally. This updates only the preview database; publishing applies production migrations separately.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

The portable build runs Vinext directly without a host `timeout` command. The managed-linux build uses `scripts/build-verified.sh` and its existing `SITES_BUILD_TIMEOUT` setting.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
