# Local hosted-side scaffold implementation

Follow-up: the reported App recovery defect is fixed and the preserved regressions pass. E1/R2 are verified; the hosted checkout now implements the local R2 protocol. See [the newer report](dot-mcp-r2-local-integration-2026-10-05.md). The dated first-increment evidence below is historical, including its then-open blocker list.

Date: 2026-10-05. Source: `sites/nash-dot-mcp/`. Scope: the allowed local scaffold and documentation-only H1 in revision 3, section 0 of [the remote plan](dot-mcp-remote-plan.md). No Site was created/published, no real credential or pairing was provisioned, and no App source was edited by this increment.

## Implemented behavior

- Vinext/Sites starter preserved, with local D1 binding `DB` and no project ID. The preview binds to loopback; its demo sign-in is the starter's portable fixture, absent from production builds.
- Stateless MCP POST skeleton supports initialization, notifications, ping and discovery. It advertises only `nash_status`, which explicitly reports scaffold/offline/unpaired/remote-off. Data calls require verified request identity; identity-less Sites service access alone grants no owner access.
- The status input schema is extracted from v2 `params.hello`, with references resolved and source SHA-256 recorded. It does not replace R2's generated manifest or create mailbox/envelope schemas. Writes and task delivery remain unavailable.
- Owner-scoped local fixtures, hashed 32-byte random challenge IDs, five-minute logical expiry and one-statement approval CAS. Approval consumes a demo challenge, never pairs a real device or issues a credential/session.
- Persistent atomic 30-call/minute owner cap, shared by MCP data calls and UI actions. Bounded cleanup deletes at most 100 expired records by default; read/approval expiry does not depend on cleanup running.
- MCP JSON bodies are limited to 64 KiB; approval UI bodies to 2 KiB. These are application choices, not verified Sites quotas. Wrong origins, invalid payloads, anonymous data access and replayed approvals are refused. Exceptions are reduced to generic errors without stack/path/secret disclosure.

## Verification

Observed locally:

- 28 unit/storage tests passed in the final run. MCP/UI tests were written and run against missing behavior before implementation, then passed. Storage tests run actual SQLite with the generated Drizzle migration and cover owner isolation, expiry boundaries, simultaneous approval, replay, persistent concurrent rate limiting, cross-minute delayed requests and bounded purge.
- TypeScript `tsc --noEmit` passed.
- Vinext build passed, generating the root page, two scaffold API routes and `/mcp`.
- Generated migration applied successfully only to Miniflare local D1 (seven SQL statements); no hosted database operation occurred.
- Fake-agent HTTP smoke passed: page, initialization/discovery, anonymous rejection, authenticated status, single-use demo approval/replay, cross-origin rejection and persistent rate limit.
- Browser verification passed: local sign-in -> challenge review -> explicit demo approval; the page continued showing disconnected, remote off and task delivery unavailable. Screenshot: `.local/dot-mcp-scaffold/approval-preview.jpg`.

Use the checkout README for repeatable commands. The owned local preview is stopped at turn teardown; no persistent helper/service is installed.

Fresh scaffold review found one rate-window race: a request carrying the previous minute's timestamp could overwrite a newer persisted window and reset its allowance. A regression test failed before repair. The UPSERT now preserves a newer window, and the full 28-test suite, typecheck, build and fake-agent HTTP smoke passed after that fix. Other reviewed scaffold identity/Origin/expiry/projection boundaries had no material finding. This fix is independent of the still-open App recovery defect below.

## New D4 recovery blocker

The current D4 services and v1/v2 contract are present. An independent bounded run reported 37 files passing, 922 tests passing and one skipped. The earlier formatting-only golden snapshot failure is repaired.

However, `finishDotIntake` in `desktop/orca/src/main/runtime/dot-ingress/dot-ingress-intake.ts` only rechecks workspace identity/binding before retrying a received request. It does not recheck global dot enablement, workspace enablement or a lowered maximum access level. `recoverDotIntake` therefore hands that request to the door again after those policies change.

The primary agent independently reran the isolated reproduction:

```powershell
$env:ORCA_BACKGROUND_LAUNCH = '1'
node node_modules/vitest/vitest.mjs run --config ../../.local/d4-review/vitest.config.ts --maxWorkers=1
```

Run from `desktop/orca`: three tests failed, exit 1. Global-off, workspace-off and lowered-ceiling cases each expected zero new launches/zero submissions; each observed one new door call and `submitted: 1`. Test/config are preserved under `.local/d4-review/`, separate from App source/tests.

Before E1/R1 or any live remote test, fix admission immediately before execution/recovery. A revoked or narrowed policy must prevent a previously unaccepted request from starting. Preserve idempotent reconciliation if the Workbench has already accepted the request; do not falsely report cancellation of an existing run. Add the three regression cases to the App suite and verify recovery's failure/projection behavior against the versioned contract.

## Remaining gates and implementation decisions

1. The D4 recovery defect remains open; E1 startup wiring is still owned by the NASH workstream. This scaffold does not alter that shared App work.
2. R2 source appeared during this increment; the endpoint/envelope schemas and `dot-mcp-tool-manifest.json` appeared at final inspection. This increment has not verified/pinned/integrated that new output or its vectors. No hand-written substitute was created. Verify the completed R2 artifact set before extending the hosted skeleton.
3. [H1 documentation verification](dot-mcp-hosting-h1-2026-10-05.md) is complete as a documentation pass, but undocumented hosting guarantees and durable desktop service-access provisioning still block live configuration.
4. Real Site creation/deployment, real credentials, real pairing and dot connection require the plan's later authorization and technical gates. This local increment does not imply those gates passed.

Implementation decisions: keep all code in a new dedicated Site subdirectory because the shared repository has an unborn HEAD and concurrent App work; retain the existing App untouched. Use a shared owner rate cap until trusted client/device identity exists, at the cost of conservative throttling across one owner's clients. Keep challenge approval fixture-only until R2 and real service enrollment are verified, at the cost of deferring live connection. Invoke npm's installed JavaScript entrypoint when the Windows command shim breaks; dependency inputs and lockfile remain pinned.
