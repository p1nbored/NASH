# NASH remote MCP for dot: plan and handoff

- Date: 2026-10-06. Revision 7. Status: V3 OWNER-PRIVATE SITE DEPLOYED; served hash verified; refreshed validation-list client call pending.
- User decision (D-021): the MCP server is deployed on GPT Sites; Codex does the deployment and reports back.
- Revision 2 adopts the mailbox design suggested by GPT (Sites stores tasks, the app polls over HTTPS and reports back), with the amendments marked **[amendment]**. Revision 1 (a live relay over a held connection) is replaced.
- Readers: Codex (hosted side), the NASH packages (local side), the user (decisions in section 10).

## Latest verified state (revision 7)

The validation-decisions v3 Site is now published with 12 tools, 13 routes and 37 vectors. Manifest `94bbd6fc2964a3a8ef79fb4000dfafd3d14a8d5567f5d6f20269fc223bad4c19`; source `7884bcff9330ee21c5eceefedbb3f1334b885844`. All 144 tests, types, build and actual local HTTP checks passed. Native deployment succeeded and a real `nash_status` call returned the exact served hash. The current conversation still has the older ten-tool descriptors; a refreshed catalog and actual validation-list call remain pending. See [the v3 deployment record](dot-mcp-sites-deployment-2026-10-06.md). The entries below record earlier revisions and are superseded by this paragraph.

On 2026-10-06 the user updated the MCP connection. An actual call through the installed NASH Remote MCP plugin returned `paired: false`, `online: false`, `lastSeenAt: null`, `appVersion: null`, `contractVersion: null`, `onlineWindowSeconds: 90`, with no tool error. This closes the read-only MCP client connection check; it does not prove a paired App, session/device-credential forwarding or task execution. The current generated endpoint table additionally declares `ownerPages.pairingApproval: /pairing`, the already implemented browser page. See [the connection follow-up](dot-mcp-connection-check-2026-10-06.md).

The user subsequently authorized deployment. The owner-private Site is published at https://nash-dot-mcp.taojuguo.chatgpt.site, with MCP at `/mcp`. Native deployment succeeded with MCP enabled, and a signed-in browser visit verified the page. The original corrected publication used commit `46ee63717eec4a7248bf8f7fd3a0ac1c7ec0d808`; the connection follow-up records subsequent contract synchronization. See [the deployment report](dot-mcp-sites-deployment-2026-10-05.md) for the original exact version/deployment IDs and verification limits.

The R2 device-credential amendment is integrated: 10 tools, 13 routes, 29 vectors; manifest `fbfc682df32ad091fdb6834b8f98a9327ef4281cfaf7b80a49b16507650516db`. All 123 local tests, type checking, build and local HTTP smoke passed. Hosted owner identity, device/session authorization and owner revocation are wired; simulation write routes are unavailable in production. The storage is still a capacity-limited private-test snapshot, with revocation headroom. A real client status call is now verified; durable service-access provisioning and real App pairing remain unverified.

The entries below record the earlier revision-4 local-only evidence and are historical. The explicit deployment request supersedes its create/publish restriction for this Site and the required source workflow. It does not establish a real App or MCP client connection.

The earlier dated findings below are preserved as audit history. This section supersedes their statements about missing D4/E1/R2 services and the open recovery defect. Sections 1-10 remain the historical revision-2 proposal; the generated R2 artifacts govern current methods, schemas and rules.

- Claude's recovery repair, current D4/v1/v2/R2 and E1 startup checks passed 486 offline tests. The original three recovery regressions now pass, including preservation of an already accepted active run.
- The local hosted checkout implements all 10 generated tools and all 11 generated routes, with hash-pinned contracts and static Worker-compatible validators. All 24 R2 conformance vectors, 102 local tests, type checking, build and real local Worker HTTP smoke passed. See [the R2 implementation report](dot-mcp-r2-local-integration-2026-10-05.md) for hashes and evidence.
- Current generated values: lease 60 s / at most 10 items, event batch at most 50, heartbeat 30 s / online window 90 s, sessions 15 min / renew after 10 min, pairing challenge 10 min. Default submissions remain read-only, TTL 30 min, visible retention 7 days and no deliverable contents, under the generated policy's awaiting-confirmation status.
- Local pairing/HTTP fixtures are implemented, not real enrollment. No Site, real platform credential, real NASH pairing or dot connection was created. Production rejects the local service fixture; hosted service access and identity still require RG3/RG9 evidence.
- Local D1 persistence uses a 1 MiB bounded atomic snapshot for conformance work. Production persistence, real auth, R1/UI-7 and G-remote are separate remaining gates. Preserve the earlier per-step live-operation authorization limits.

Next: complete separately authorized real App pairing and G-remote checks. Hosting and a real read-only MCP client call are verified; device synchronization and execution are not yet verified.

## 0. Review outcome and required corrections

The mailbox architecture is suitable, but revision 2 cannot be executed as written. The 2026-10-05 review found missing local services and protocol/security gaps. The current user authorized execution if the plan has no problems; that condition is not met. Only review, partial H1 source verification and these document corrections have been performed. See [the review and H1 report](dot-mcp-remote-review-2026-10-05.md).

Sections 1-10 below retain the revision 2 proposal for context. The corrections in this section supersede conflicting statements there. They are requirements for the next implementation revision, not claims about working code.

| Gate | Required correction before implementation/deployment |
|---|---|
| RG1: local services and wiring | D4/E1 must be completed first. The closed ingress currently registers only `dotIngress.hello`; submit/status/list/cancel/decisions are advertised but unavailable. Production startup has not installed the dot settings reader, primary-session runtime, permission relay or task executor. Intake does not launch a run. |
| RG2: supported contract | Generate the manifest and vectors from an explicitly versioned contract. Frozen v1 has no message schema, only coarse run status, `result: null`, and unsupported results/artifacts capabilities. Do not invent message/progress/validation/deliverable schemas on Sites. Artifact metadata uses opaque IDs, not relative paths. |
| RG3: Sites authentication | Sites owns MCP connection authentication/OAuth. Remove the separate hop A OAuth/static-bearer fallback. Private desktop polling requires platform service access at dispatch in addition to app pairing/session authorization; pairing alone cannot pass that gate. Actual dot negotiation and durable desktop provisioning/renewal of platform service access remain unverified. |
| RG4: pairing and authorization | A signed-in owner must approve a short-lived, single-use desktop pairing challenge. Bind owner, device, authorized dot identity and pairing generation server-side before issuing a session. Derive identities from verified credentials, never `client.name`, payload fields or knowledge of UUIDs. Scope every read/write to that binding. |
| RG5: replay and ordering | Replace the exactly-once claim with at-least-once delivery and durable deduplication. Preserve the submitted contract `idempotencyKey`; enforce hosted transactional uniqueness on owner/device/caller/key with a canonical payload hash before enqueueing. Same key/same payload returns the original receipt; different payload is a conflict. One active device consumer processes leases sequentially, with lease nonce/generation checks, renewal and explicit submit dependencies. Messages need durable delivery receipts; uncertain terminal delivery cannot be blindly replayed. |
| RG6: receipts and projection | Add separate generated hosted receipt lookup/queued-cancel schemas: `itemId` exists before local `dotRequestId`. Cancel is atomic before claim; after claim it resolves the admission mapping. Persist local events before sending, use generated allowlisted event schemas and source revisions, reject stale updates, and recover through snapshot/cursor. Never upload raw tool input, terminal output, database rows or error stacks. |
| RG7: permissions and read-only access | D4 must route answers through the permission relay and prove the target run originated from dot. Enforce the run's access ceiling on answers too. Current read-only settings deny Edit/Write/NotebookEdit but do not sandbox shell commands; the dot-answer relay does not check run access. Until a verified sandbox enforces read-only commands, command-tool remote `allow` must be refused or kept desktop-only; remote `deny` remains possible. D-017's remote-answer decision is retained. |
| RG8: expiry and revocation | Filter expiry on every claim/read and run bounded purges. Retain deduplication records for the allowed retry/recovery horizon. Revocation invalidates all app sessions and fences leases/acks/events by generation. The local agent rechecks its switch and pairing before dispatch. Revocation stops future remote work; it does not imply already accepted runs were canceled. Provider recovery retention is separate from 7-day application visibility. |
| RG9: hosting and live verification | Use short polling until Sites dispatch proves 25 s long polling. Confirm Sites-specific timeouts, body/concurrency limits, logs, region, storage tier/recovery retention and cost. Every Sites deployment URL is production: use a separate owner-private test Site/database for isolation. A deployed Site does not prove a working dot connection; install/connect the provisioned plugin and verify a real tool call. |

### NASH-side response (2026-10-05)

- All nine corrections are accepted. The review gates are renamed RG1 to RG9 so they do not collide with the NASH plan's live gates G1 to G9.
- RG3 and RG4 were checked against the installed Sites references (`site-mcp-server.md`, `identity-and-secrets.md`): Sites owns MCP connection authentication; private Sites need service access (`OAI-Sites-Authorization`) for non-user callers, which carries no user identity, so app pairing must bind the signed-in owner (`oai-authenticated-user-id`) through an owner-approved challenge.
- RG7 is a defect in the local App, not only in the remote plan: a read-only run denies Edit, Write and NotebookEdit, but a shell command can still write, and `answerFromDot` does not check the run's access. Package D4 fixes it for the local dot path too: dot may deny any prompt, but may allow a command-tool prompt only on a run whose access allows writes, until a verified sandbox enforces read-only commands.
- The failing golden snapshot (`dot-ingress-contract-v1.schema.json`) was caused by a formatting run over the whole App tree on 2026-10-05 at 01:37 local time, which reformatted that file (and converted line endings across the tree). The contract is unchanged; the file is restored as part of the line-ending repair, without updating the snapshot.
- Contract: package D4 adds `requests.message` and the dot-run access ceiling under an explicitly versioned contract (v2, with v1 kept); package R2 generates the hosted envelope schemas (receipts, queued cancel, allowlisted events with source revisions), the tool manifest and the conformance vectors. Sections 1 to 10 will be rewritten as revision 4 from those generated schemas.

### What Codex can start now (2026-10-05)

State: D4 is done (contract v2 in `desktop/src/shared/dot-ingress/`, golden `dot-ingress-contract-v2.schema.json`). E1 (wiring) and R2 (generated hosted envelope schemas, `dot-mcp-tool-manifest.json`, conformance vectors, under `desktop/src/shared/dot-remote/`) are in progress.

Allowed now:
1. Finish H1 from documentation only: Sites ingress timeouts, body and concurrency limits, whether a 25 s request can be held, log body exclusion and retention, data region, storage tier and recovery retention, the user's cost model, and how a desktop app obtains and renews service access (`OAI-Sites-Authorization`) durably. Report each answer with its source.
2. Build a local scaffold only (local preview with local D1, never published): the MCP endpoint skeleton with tool discovery, owner-approved pairing pages (RG4), scoped storage tables, expiry filtering and purge jobs (RG8), per-client rate limits, and a fake NASH agent for tests. For write tools, take input schemas only from the v2 golden file above.

Wait for R2 before:
- receipts, queued cancel, inbox/ack/event bodies, event kinds and the tool manifest. Do not hand-write them (RG2, RG6); use R2's generated files and conformance vectors.

Not allowed until the user approves each step:
- creating, publishing or deploying any Site, including a private test Site (every Sites deployment URL is production, RG9);
- creating, copying or rotating any token or credential, including service access, even to probe;
- pairing with a real NASH or connecting dot.

### R2 output ready for Codex (2026-10-05)

Generated by NASH (do not hand-edit; regenerate from NASH source if a change is needed). All under `desktop/src/shared/dot-remote/`, LF, frozen by tests:

- `dot-mcp-tool-manifest.json`: 10 tools (`nash_status`, `nash_list_workspaces`, `nash_submit_task`, `nash_get_receipt`, `nash_get_request`, `nash_list_requests`, `nash_cancel_request`, `nash_list_permission_prompts`, `nash_answer_permission_prompt`, `nash_send_message_to_run`) with input and output schemas, annotations, policy defaults, protocol limits, the hosted rules JSON Schema cannot express (`rules`), the tool error list and `manifestSha256`. The per-tool `nash` block is for the server only; do not send it to MCP clients.
- `dot-remote-endpoints.json`: the 10 NASH-facing endpoints and the owner approval endpoint (method, path, auth headers, request and response schema pointers, error codes).
- Schemas: `dot-remote-inbox.schema.json`, `dot-remote-ack.schema.json`, `dot-remote-receipt.schema.json`, `dot-remote-events.schema.json`, `dot-remote-presence.schema.json`, `dot-remote-pairing.schema.json`; plus D4's `desktop/src/shared/dot-ingress/dot-ingress-contract-v2.schema.json` (pinned by sha256 in the manifest).
- `dot-remote-conformance-vectors.json`: 24 vectors (one accepted case per tool, plus dedup, conflict, expiry, duplicate/late/conflicting events, cancel before and after claim, wrong owner or device, revoked generation, RG7 refusals, remote access cap) and 4 worked `payloadSha256` examples. A test harness injects the generated item ids, lease nonces and the step clock.

Codex next (still local only, same limits as above): verify and pin these files by sha256, extend the local scaffold to all 10 tools and the NASH-facing endpoints from them, and pass every conformance vector against the fake NASH agent. Report the pinned hashes, results and any rule the hosted side cannot implement as written.

Update 2026-10-05, device credential (regenerated; new `manifestSha256` `fbfc682df32ad091fdb6834b8f98a9327ef4281cfaf7b80a49b16507650516db`): so the owner does not have to approve a new pairing after every NASH restart, session issue now also returns a device credential (`ndc_<24 hex>.<secret>`, shown only in issue and refresh responses; the Site stores a salted SHA-256 hash). New `POST /nash/v1/session/refresh` (credential only in the `Nash-Device-Credential` header, body `{ generation }`) returns a new session and a rotated credential; reuse of a superseded credential revokes the binding (`device_credential_reused`); the pairing ends at an absolute lifetime (default 30 days, awaiting the user; `pairing_expired`). New owner endpoint `POST /pairing/revoke`. Three new endpoint error codes and five new conformance vectors (29 in total). Re-verify and re-pin the files before extending the scaffold.

Open for verification on Sites (H1): whether a custom `Nash-Session` header reaches the Worker next to `OAI-Sites-Authorization`; what verified identity an MCP tool call carries (`dotIdentity.source` is assumed `sites_mcp_identity`); the approval page path `/pairing/approve` is a proposal.

Execution order after these corrections: D4/E1 -> versioned contract and R2 -> H2/R1/UI-7 -> fake-agent/conformance tests -> isolated private test deployment -> G-remote. Keep remote access off until its gate passes. No Site has been created, paired or published by this review.

Historical initial verification found 34 passing tests and one textual contract-snapshot failure, later repaired by the NASH workstream. This did not prove a usable task endpoint. Full initial evidence is in the review report.

### Codex local increment (2026-10-05)

- The allowed local-only scaffold is implemented at `sites/nash-dot-mcp/`: MCP skeleton/readiness discovery, owner-authenticated demo approval pages, scoped local D1 fixtures, logical expiry/bounded purge and persistent owner rate limits. No Site, real credential, pairing, mailbox or task execution was created. See [implementation and verification](dot-mcp-local-scaffold-2026-10-05.md).
- [H1 documentation verification](dot-mcp-hosting-h1-2026-10-05.md) is complete as a documentation pass. Undocumented Sites limits/retention and durable desktop service-access enrollment still need later evidence.
- D4's new v1/v2/message/permission paths pass their bounded existing tests, but a new RG8 recovery defect is reproduced: global-off, workspace-off and lowered-access settings do not prevent replay of a received request through the intake door. Three isolated regression cases fail. The App must close this before E1/R1/live connection.
- R2 generated endpoint/envelope schemas and `dot-mcp-tool-manifest.json` appeared at final inspection; this local increment has not verified/pinned/integrated them. Keep hosted write tools and mailbox endpoints unavailable until that integration is tested.

## 1. Design

```
dot --MCP over HTTPS (hop A)--> Sites: MCP server + mailbox (inbox, outbox)   <- Codex
                                   ^
                                   | HTTPS, started by the PC only (hop B): poll inbox, post events
                                   |
                         NASH sync agent (local)                                  <- NASH packages
                                   | named pipe, dot ingress token (hop C)
                                   v
                         NASH dot ingress -> intake -> one Claude Code primary session per run
```

1. dot calls MCP tools on Sites. A submission, cancel, permission answer or follow-up message becomes an **inbox item** stored on Sites.
2. The NASH app on the PC polls the inbox over HTTPS, takes each item and hands it to the existing local dot endpoint. A new task starts its own workflow run with its own primary session; a follow-up message goes to the run it names (D-019).
3. NASH posts **events** to the Sites outbox: admission result, run and task progress, permission prompts, validation (acceptance) results, deliverable summaries.
4. dot reads the outbox through MCP tools and reports to the user.

The PC opens no inbound port. Every connection starts on the PC.

**[amendment] NASH stays the single authority.** The Orca-derived runtime on the PC owns runs, tasks and attempts. Sites stores only (a) inbox items waiting for NASH and (b) a read-only copy of what NASH reported. Sites never decides a status itself, and nothing on Sites starts or changes a run except an inbox item that NASH accepts through its own checks.

## 2. Verify before building (Codex, step H1)

Confirm from GPT Sites and dot documentation or a minimal probe, and report each answer with its source. Do not assume:

1. Which MCP transport GPT Sites can serve (Streamable HTTP expected) and which MCP protocol version dot's client speaks.
2. Which authentication dot's MCP client supports toward a server: OAuth 2.1 as in the MCP authorization spec, a static bearer header, or none.
3. Whether a request can be held open for long-poll (up to 25 s) or only short requests. This sets the poll mode in section 5.
4. Request timeout, body size and concurrency limits.
5. Persistent storage for inbox, outbox and the pairing record, with expiry (TTL) support, and encryption at rest.
6. Secret storage, HTTPS on a stable hostname, logging controls (can bodies be kept out of logs), log retention, region.
7. Cost model, so the user can approve it before go-live.

## 3. Trust boundaries and authentication

| Hop | Between | Mechanism | Never carries |
|---|---|---|---|
| A | dot -> Sites MCP | OAuth 2.1 per the MCP authorization spec if dot supports it; otherwise a long random bearer secret per client, stored only as a hash. Never anonymous. | NASH secrets |
| B | NASH sync agent -> Sites | Pairing secret created on the NASH desktop by the user (trusted desktop caller only), shown once, stored by Sites only as a salted hash. The agent exchanges it over TLS for a short-lived session token (15 min, renewed). Either side can revoke. | dot's credential, NASH's CLI token, provider or Clef credentials |
| C | sync agent -> local dot endpoint | The existing per-start dot ingress token from the owner-only discovery file. Only `dotIngress.*` methods exist there. | Anything outside the dot contract |

- Hop A tokens cannot read or write the NASH-side endpoints, and hop B tokens cannot call MCP tools.
- **[amendment] A compromised or misconfigured Sites can only submit what dot could submit.** Every inbox item passes NASH's own checks again on the PC (section 7). Sites can never widen access, skip a check or reach any non-dot method.
- Secrets live in GPT Sites secret storage and in NASH's sealed credential store. Nothing secret goes into the repository, logs, inbox, outbox or this document.

## 4. What is stored on Sites

| Data | Default | Notes |
|---|---|---|
| Inbox items (task objective, cancel, permission answer, follow-up message) | stored until taken or expired | objectives are what dot wrote: English, quoted spans verbatim |
| Workspace list | refs and display names only | opaque `dws_` refs, never paths; NASH republishes it when the user changes it |
| Status and progress events | stored | NASH's English status text; no executor output |
| Permission prompt summaries | stored until closed | tool, command and file names, secrets masked, at most 500 characters, never file contents (D-017) |
| Validation (acceptance) results | stored | verdict, which checks ran, reviewer model id, English reason line |
| Deliverable summaries | stored | English summary, artifact list: relative path, size, sha256 |
| **Deliverable contents** | **not sent** | **[amendment]** file contents leave the PC only if the user opts in per workspace (section 10, decision 2) |

- **[amendment]** Everything on Sites expires: inbox items after their TTL (section 5), outbox data after the retention the user picks (default 7 days). Encrypted at rest.
- Hosted logs: request id, tool or endpoint name, outcome code, latency, size. No bodies.

## 5. Mailbox protocol (Sites <-> NASH sync agent)

All calls start on the PC, over HTTPS, with the hop B session token.

| Call | Purpose |
|---|---|
| `POST /nash/v1/session` | pairing secret -> session token (also returns the server's protocol version) |
| `GET /nash/v1/inbox?wait=25` | long-poll for items; returns up to 20 items, each leased to this agent for 60 s |
| `POST /nash/v1/inbox/{itemId}/ack` | outcome per item: `accepted` (with NASH ids), `refused` (with the `dot_*` code), `duplicate`, `expired` |
| `POST /nash/v1/events` | batch of events, each with a unique `eventId` (Sites ignores repeats) |
| `PUT /nash/v1/workspaces` | the current enabled workspace list (refs and display names) |
| `POST /nash/v1/heartbeat` | "NASH online", app version, contract version |

Inbox item: `{ itemId, kind: submit | cancel | permission_answer | message, payload, createdAt, expiresAt }`. The payload is exactly the dot contract's params for that method; Sites validates it against the contract schema before storing.

Event: `{ eventId, kind, dotRequestId, runRef?, at, data }`. Kinds: `request_accepted`, `request_refused`, `run_status`, `task_progress`, `permission_prompt_opened`, `permission_prompt_closed`, `message_outcome`, `validation_result`, `deliverable_summary`.

Rules:
- **Exactly once.** NASH derives the contract `idempotencyKey` from `itemId`, so a re-delivered item never starts a second run. An unacked lease returns the item to the inbox after 60 s.
- **[amendment] No late surprises.** A `submit` not taken within its TTL (default 30 min, section 10, decision 4) is marked expired on Sites and never delivered; dot is told. NASH also refuses an item whose `expiresAt` has passed.
- **Poll cadence.** Long-poll if H1 item 3 allows; otherwise poll every 5 s while a run is active or a permission prompt is open, and every 30 s when idle. A permission answer must reach NASH within the 240 s prompt window, after which the prompt waits in the terminal (D-017).
- **Order.** Items are taken oldest first. A cancel or message for a request NASH has not accepted yet waits behind its submit.
- **Offline.** While NASH is offline, submissions wait on Sites until their TTL; dot sees "NASH last seen at <time>".

## 6. MCP tools (dot-facing, on Sites)

Writes go to the inbox; reads come from what NASH last reported. Schemas for payloads and views come from the frozen contract file `desktop/src/shared/dot-ingress/dot-ingress-contract-v1.schema.json` (`params.*`, `view.request`, `view.decision`). Codex must not hand-write them; NASH will add a generated `dot-mcp-tool-manifest.json` once package D4 lands.

| MCP tool | Writes or reads | Maps to |
|---|---|---|
| `nash_status` | read | heartbeat: online or last seen, app and contract version |
| `nash_list_workspaces` | read | last workspace list from NASH |
| `nash_submit_task` | write (inbox) | `dotIngress.requests.submit`; returns `{ itemId, state: 'queued' }` |
| `nash_get_request` | read | latest events for one request: status, progress, validation, deliverable summary |
| `nash_list_requests` | read | requests dot submitted, newest first |
| `nash_cancel_request` | write (inbox) | `dotIngress.requests.cancel` |
| `nash_list_permission_prompts` | read | open prompts NASH reported |
| `nash_answer_permission_prompt` | write (inbox) | `dotIngress.decisions.answer`; allow or deny; first answer wins on NASH |
| `nash_send_message_to_run` | write (inbox) | `dotIngress.requests.message` (D-019; added by package D4) |

Errors: Sites-level codes (`nash_never_paired`, `item_expired`, `payload_invalid`, `rate_limited`, `unauthorized`); NASH refusals arrive later as `request_refused` events carrying the `dot_*` code and its fixed English message.

## 7. Safety rails

On NASH, unchanged and applied to every inbox item:
- dot is off by default and enabled per workspace.
- Submission caps: 6 per minute and 100 per UTC day.
- Access defaults to `read_only`; a per-workspace maximum is set at enable time (package D4).
- English check and secret scan on every objective and message; desktop-only permission prompts are never offered to dot; a message only reaches a run dot started.

Added by this plan:
- A **remote access switch** in NASH Settings, off by default, separate from the local dot switch. Off means no polling and no events.
- **[amendment, decided 2026-10-06]** Remote submissions may ask for `workspace_write`, limited by each workspace's maximum (section 10, decision 3; D-034).
- Sites rate-limits per client (for example 30 tool calls per minute) and caps the inbox (for example 50 waiting items).
- Pairing can be revoked from the NASH desktop or the Sites admin; revoking also deletes the waiting inbox.

## 8. Work split and order

Hosted side (Codex):
1. **H1** verify section 2 and report.
2. **H2** build the MCP tools, mailbox endpoints, storage with expiry, pairing, against the v1 contract file.
3. **H3** test against a fake NASH agent and against conformance vectors from NASH (one item and expected ack or event per tool and per error).
4. **H4** deploy to staging only. No production pairing until the joint gate passes.

NASH side (packages in this repository):
1. **D4** dot services: all contract methods, including `requests.message` (D-019), permission answers through the D2 port, and the run projection the events are built from.
2. **E1** wiring: switches the dot endpoint, permission relay, launcher and executors on inside the app.
3. **R1** sync agent: pairing, session renewal, inbox poll and ack, event outbox with retry, heartbeat; forwards items to the local dot endpoint with the dot token; no listening port; electron-free runtime module; tests with a fake Sites.
4. **R2** tool manifest generator and conformance vectors, shared with Codex.
5. **UI-7** Settings: remote access switch, pair and revoke, last sync time, per-workspace deliverable sharing (if the user allows it).
6. **E2** docs: this plan becomes a reference doc with the final values from Codex's report.

Joint gate **G-remote** (needs the user's authorization): one live pass per tool from dot through staging to a real NASH with a test workspace, plus offline, expiry and revocation checks.

## 9. What Codex should send back

- Answers to section 2, each with its source.
- Staging URL, MCP transport and protocol version, hop A auth method, poll mode (long-poll or short), endpoint paths.
- Any deviation from sections 3 to 6, and why.
- H3 test results (counts, failures), hosting limits and cost.
- No secrets in the report: no tokens, pairing secrets or keys.

## 10. Decisions for the user

1. **Hop A auth**: OAuth 2.1 if dot's client supports it (recommended), otherwise a per-client bearer secret.
2. **Deliverable contents**: summaries and artifact lists only (recommended), or file contents for workspaces you opt in, with a size cap and secret scan.
3. **Remote write access**: decided 2026-10-06 (D-034): allowed up to each workspace's maximum. (Options were: stay `read_only`, or allow up to each workspace's maximum.)
4. **Submission TTL**: 30 minutes (recommended), or longer if you want tasks to wait for the PC to come online.
5. **Retention on Sites**: 7 days (recommended) or another value.
6. **Remote permission answers**: allowed (as D-017 says for dot), or answered on the PC only while remote is new.
