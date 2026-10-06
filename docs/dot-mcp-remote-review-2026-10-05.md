# Remote dot MCP review and H1 verification

Date: 2026-10-05. Scope: current `docs/dot-mcp-remote-plan.md`, local App readiness, installed Sites documentation and primary provider documentation. Outcome: BLOCKED for implementation/deployment as written; H1 partially verified. No Site, credential, pairing, deployment or live model job was created. No App code was modified.

The user requested review and execution if the plan has no problems. The mailbox direction is sound, but the execution condition is not satisfied. Revision 3 section 0 records the required corrections; revision 2's body is retained as proposal context.

## Local readiness evidence

| Finding | Evidence in this checkout | Effect |
|---|---|---|
| Only hello is registered | `desktop/src/main/runtime/rpc/methods/dot-ingress.ts` exports one method; its test explicitly requires hello and nothing else | All planned task/control calls are unavailable despite hello advertising capabilities |
| Production startup is not wired | `installDotIngressEnabledReader`, `createOrcaPrimarySessionRuntime`/`setPrimarySessionRuntime`, `installPermissionRelay` and `createTaskExecutionRuntime` have definitions but no production installation calls | The dot endpoint remains off without its reader; primary/permission/execution adapters are not connected |
| Intake does not start a run | `desktop/src/main/runtime/workbench-intake-submit.ts` submits to the request store | A stored request is not evidence of a launched Claude session |
| Message contract is absent | `desktop/src/shared/dot-ingress/dot-ingress-params.ts` and frozen `dot-ingress-contract-v1.schema.json` | No generated message tool can be implemented against v1 |
| Proposed cloud data exceeds v1 | `dot-ingress-request.ts` permits coarse run state, requires null result, uses opaque artifact IDs and declares unsupported result/artifact capabilities; `dot-ingress-projection.ts` returns null/empty values | Progress, reviewer model, summaries and file paths require an explicit contract/disclosure decision |
| Remote implementation is absent | No remote switch, pairing client, `/nash/v1` client or remote event outbox was found | R1/R2/UI-7 are real prerequisites, not deployment-only configuration |
| Read-only does not cover arbitrary commands | `runtime/workflow-run/primary-session-settings-file.ts` denies Edit/Write/NotebookEdit; `runtime/permission-relay/permission-audience.ts` permits dot answers for command tools; `permission-request-service.ts` lacks a run-access check in `answerFromDot` | A future remote allow could authorize a writing shell command; enforce the ceiling before exposing this path |

The already implemented dot DB admission, idempotency ledger, redacted projection, dedicated transport and permission relay are reusable foundations. Their existence does not close D4/E1.

## Protocol corrections

1. Preserve `params.submit.idempotencyKey`. The existing local store checks that key and an input hash (`runtime/orchestration/db/dot-ingress-store.ts`). A fresh hosted `itemId` per MCP retry must not generate a fresh contract key. Hosted deduplication occurs transactionally before enqueueing; retries return the same receipt or a content conflict. Redelivery and restart must not launch another run.
2. Specify authenticated pairing bootstrap. A secret created only on the desktop cannot match a trusted hosted pairing record without an owner-approved registration flow. Bind owner, device, dot identity and generation; neither a client label nor a request UUID is authority.
3. Use one active device consumer, lease tokens and sequential dispatch. A batch ordered by creation time alone does not stop concurrent polls or expired leases from executing dependent cancellation/messages early. Renew/release leases if processing exceeds their lifetime.
4. Separate hosted receipts from local request views. Submission returns `itemId` before admission creates `dotRequestId`; v1 status/cancel expects the latter. Define generated receipt lookup and queued cancellation. After claim, cancellation resolves the admission outcome rather than pretending a queued deletion stopped a local run.
5. Version and allowlist events. A generic `data` field is not a safe cloud projection. Persist events locally, acknowledge retries, apply only newer source revisions and restore with snapshots/cursors. Closed prompts cannot reopen through late events. Artifact references carry no file paths or contents.
6. Permission answers use the existing relay's active-waiter/deadline/CAS path. Verify dot run ownership and access level before remote allow. Denying a command remains possible; read-only command allow requires verified local enforcement.
7. Fence revocation with pairing generation. Reject old sessions, leases, acks and event uploads; check local remote enable/pairing state immediately before dispatch. A request already accepted before revocation retains its real local state and requires normal cancellation if desired.
8. Enforce logical expiry on every relevant query, with bounded cleanup. Preserve deduplication tombstones throughout the allowed replay horizon, without retaining objective bodies unnecessarily. Report provider recovery history separately from visible application retention.

## H1 answers and sources

The installed Sites references are part of `C:/Users/Administrator/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-a/skills/sites/`: `SKILL.md`, `references/site-mcp-server.md`, `references/identity-and-secrets.md` and `references/storage.md`. Native Sites tool descriptions were also inspected without calling them. These establish supported workflows; they are not a live platform probe.

| H1 question | Verified | Still required |
|---|---|---|
| Transport and protocol | Sites supports a stateless HTTP `POST /mcp` with initialization, discovery and calls; declare the mcp capability | Actual dot client version/negotiation and identity on authenticated tool calls |
| Hop A authentication | Sites manages connection authentication/OAuth and provisions a private plugin; data calls must authorize platform request identity | Install/connect and test that plugin with dot |
| Private hop B access | When supplied, service access uses `OAI-Sites-Authorization: Bearer <platform token>`; dispatch consumes it and supplies no user identity. App pairing/session authorization is also necessary | Supported durable desktop provisioning/renewal; do not create/rotate a bypass token merely to probe |
| Long polling | Cloudflare Workers behavior cannot establish Sites dispatch behavior | Start with 5 s active/30 s idle short polling; probe 25 s before enabling it |
| Timeout/body/concurrency | Sites runs server code on Workers; skill documents 128 MB per isolate | Sites-specific ingress, body, concurrency and timeout limits |
| Persistent storage | Sites provisions D1 bindings and applies generated schema migrations. D1 documents automatic encryption at rest and TLS [1] | Provisioned tier, expiry/purge implementation, recovery retention |
| Secrets/HTTPS/logs/region | Sites provides stable hosted HTTPS origins and native runtime secret configuration | Log body exclusion/retention and actual data jurisdiction; no values inferred from generic Cloudflare defaults |
| Cost | Cloudflare D1 pricing is documented [4] | The user's actual Sites cost model; it is not established by provider pricing |
| Test environment | Native Sites tool descriptions say every deployment URL is production | Separate owner-private test Site/database; test pairing only until joint gate passes |

D1's provider limits include a 2 MB row/string/BLOB limit, 100 bound parameters per query and a 30 s SQL-query duration limit [2]. Design bounded event/purge batches within those limits, but verify any stricter Sites limits separately.

A 7-day application expiry is not a promise that no recovery copy exists afterward: D1 Time Travel is always enabled, with provider-tier recovery windows [3]. No application automatic row TTL was verified; expiry filtering and cleanup remain implementation requirements.

Sources, checked 2026-10-05:

- [1: Cloudflare D1 data security](https://developers.cloudflare.com/d1/reference/data-security/)
- [2: Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [3: Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [4: Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare Workers duration](https://developers.cloudflare.com/workers/platform/limits/#duration)
- [Cloudflare D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/)

## Verification performed

Primary review command, from `desktop`, with background launch enabled:

```powershell
$env:ORCA_BACKGROUND_LAUNCH = '1'
node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/shared/dot-ingress/dot-ingress-contract-freeze.test.ts src/main/runtime/rpc/methods/dot-ingress.test.ts
```

Result: 35 tests, 34 passed, 1 failed; exit 1. The failure is `matches the golden JSON Schema snapshot`: the stored golden uses compact arrays while `JSON.stringify(snapshot, null, 2)` generates expanded arrays. The displayed diff changes JSON formatting. The test and frozen contract were preserved; no snapshot update was used to turn this into a claimed green gate.

The independent App audit additionally ran params and closed-registry tests with the same two files: 280 tests, 279 passed and the same snapshot failure. This is an independent reported result; the primary command above was observed directly. No live dot -> Sites -> NASH connection was tested.

## Next implementation sequence and exit evidence

1. D4/E1: implement the closed local service and startup/shutdown wiring, including truthful capability reporting, dot-owned run targeting and safe permission access ceilings. Prove submit -> one run/primary session and cancel/message/permission behavior through that endpoint.
2. Contract/R2: resolve message/result/progress disclosure explicitly; generate tool manifest, hosted envelope schemas and conformance vectors. Repair the formatting-sensitive freeze check without changing contract semantics, then obtain a green contract gate.
3. H2/R1/UI-7: implement authenticated pairing, scoped storage, ordered leases, durable deduplication/outbox, expiry/revocation and a default-off remote switch using the existing runtime owners.
4. H3: fake-agent tests for repeated MCP calls, payload conflicts, crash after acceptance before ack, duplicate/late events, queued cancel races, wrong-owner/device IDs, expired prompts, remote read-only command allow and revoked leased items.
5. Close outstanding H1 values, then deploy an isolated private test Site. Connect the provisioned plugin and pass G-remote with a test workspace, including offline/expiry/revocation cases. Report hosting and connection verification separately.

No implementation task in this sequence is marked complete by this review.
