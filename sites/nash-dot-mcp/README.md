# NASH Remote MCP Site

The owner-private mailbox connecting Dot to the NASH desktop. Current source uses remote contract v4 with ingress v3 payloads: 12 tools, 13 device routes and 38 conformance vectors.

See [Dot integration](../../docs/dot-mcp.md) for authorization, delivery, policy defaults and the last recorded deployment. Desktop v1.4.215 did not redeploy this Site; its optional coordinator attachment requires the new generated bundle.

## Source and generated contracts

- `lib/`: mailbox, pairing, MCP and device endpoints.
- `generated/`: pinned desktop schemas, manifest, vectors and static validators.
- `tests/`: local fixtures, persistence and protocol checks.
- `drizzle/`: applied and pending database migrations; never replay applied migrations.

Update contracts only from a reviewed desktop change:

```text
node scripts/pin-remote-artifacts.mjs
node scripts/compile-remote-schemas.mjs
```

Both scripts accept `--check`. Build checks validate the bundled artifacts without requiring the parent desktop checkout. Do not hand-edit generated files.

## Local checks

From this directory with the installed Node/dependencies:

```text
node --experimental-strip-types --test tests/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node scripts/verify-remote-bundle.mjs
node scripts/compile-remote-schemas.mjs --check
npm run build
```

For a disposable loopback preview, use `npm run dev` and `node scripts/remote-http-smoke.mjs http://127.0.0.1:5178` with the matching port. Local demo sign-in and fixture admission are development-only; production hides simulation controls.

## Deployment

Keep the existing Site owner-private and preserve its storage bindings. Sites manages service authentication; device session credentials do not replace it. Service tokens must not enter browser code or source.

Apply pending migrations through the hosting workflow. A successful publication proves a deployed build, not a paired desktop, refreshed connector schema or successful real task. Record the published version and source/manifest hash in the shared Dot guide after deployment.
