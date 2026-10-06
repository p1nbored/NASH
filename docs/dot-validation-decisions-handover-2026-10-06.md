# dot validation decisions: handover (2026-10-06)

Status: **part A (desktop) is implemented and tested; parts B to D (Site, redeploy, live gate) are not done.** Nothing is deployed and nothing was tried in the running app. The desktop decision service it builds on is package G6 (see section 7). The names in section 3 are final: they come from the regenerated remote contract, and the generated manifest is authoritative.

## 1. What and why

- Until part A nobody could waive or reject an inconclusive task validation except on the desktop (package G6). Tasks the primary does itself always end inconclusive (D-027), so those runs can never count as completed without a decision.
- The user asked for the same in dot: "Add this capability to dot and prepare the handover documentation; I will have Codex handle the redeployment".
- **What dot may see (the user's choice: "Title, reason, summary").** This is a narrow exception to rule U32, under which dot otherwise sees the coarse run state only. Per pending decision, dot gets exactly these seven fields (`DotValidationViewSchema`, strict):

| Field | Content |
|---|---|
| `validationId` | Opaque id (`^[A-Za-z0-9_.:-]{1,128}$`; NASH's are `validation_<uuid>`) |
| `dotRequestId` | The dot request that started the run |
| `title` | TaskSpec title, or the objective's first line, masked as below. At most 200 code points. When nothing safe remains it is the fixed text `Untitled task` |
| `reason` | Fixed code: `claim_only`, `primary_did_task`, `report_missing`, `review_unavailable`, `review_inconclusive`, `checks_inconclusive`, `other` (final set; `review_inconclusive` was added: the reviewer ran but could not decide) |
| `summary` | At most 500 code points, masked as below: the reviewer's line for a model review, the primary's task report for an in-session task, otherwise the undecided check's reason line. `null` when withheld or when there is nothing to show |
| `summaryWithheld` | `true` when the masked summary still flagged and was not sent (then `summary` is `null`) |
| `createdAt` | When the result became inconclusive (the validation's update time), UTC |

**Masking (desktop only, before anything leaves the main process).** In order: the shared display rule `src/shared/display-control-characters.ts` turns C0/C1 controls, U+2028/U+2029, U+202A to U+202E and U+2066 to U+2069 into spaces; Clef's span masking replaces every quoted span with `[quoted text]`; every other token holding a slash or backslash becomes `[path]` (Windows, UNC, POSIX, relative, `file://`); e-mail addresses become `[email]` and hex runs of 32 or more become `[id]`; NASH's credential masking and one-line folding follow (any remaining format character is replaced); then Clef's content scan and the credential check decide, and a line that still flags is withheld whole, never partly sent. The contract pattern forbids `\p{Cc}`, `\p{Cf}`, `\p{Zl}` and `\p{Zp}` in `title` and `summary`, so the Site's compiled validators reject anything else. **The Site adds no second sanitizer** and never rewrites these fields.

dot never gets paths, worktrees, branches, base commits, models, routes, efforts, process state (`processMayRun`), artifacts, deliverable contents or progress. The dot view is built field by field from the validation record; the desktop view is never copied into it.

**Rails:**
- dot may list and decide only validations of runs dot started (G6 decision service, origin `dot`, `by: 'dot'`).
- Decisions count against dot's per-minute and per-UTC-day caps (`dot_rate_limited` with `window`).
- `decisionId` (a uuid chosen by dot) is the idempotency key: a replay returns the first outcome, and the same id with another validation or decision is refused.
- Outcomes mirror the permission answers: `decided`, `already_decided`, `closed`, and `dot_validation_not_found` as the refusal.
- A decision from dot files the same notice to the primary as a desktop decision, with the desktop's worktree reader ("waived from dot"):
  - a waived write task in its own worktree tells the primary to merge its branch (or to wait while a process of the attempt may still run);
  - a reject leaves the branch for inspection;
  - a folder-workspace task says the changes are already in the folder.

## 2. Who does what

Recommended split. The generated remote contract is the interface between the two parts.

| Part | Owner | Depends on |
|---|---|---|
| A. NASH desktop: local dot contract v3, exposure and masking, sync relay and events, regenerated `shared/dot-remote/*`, new desktop pin | NASH main session (package G7-A) | G6 (done) |
| B. Site `sites/nash-dot-mcp`: pin the new artifacts, new tools, storage, tests, build | Codex | Part A landed (done) |
| C. Redeploy the Site and record the new deployment | Codex | Part B passing |
| D. Rebuild NASH, pair, then live gate G-remote | The user with the NASH main session | Part C |

## 3. Contract changes made in part A (final)

### 3.1 Local dot ingress (desktop endpoint)

- Contract version 3, golden `desktop/orca/src/shared/dot-ingress/dot-ingress-contract-v3.schema.json` (byte-frozen), sha256 `531a90a8fcaefff5cf6ee09fca71dc55bc9dc5f45e8d26bc53d75ac173510132`. The v1 and v2 goldens are byte-identical to before (`15c0baaa…62ff4`, `76e69b29…f157a0`).
- `hello` with `contractVersion: 3` lists all eleven methods, the limits `maxValidationTitleChars: 200` and `maxValidationSummaryChars: 500`, and the capability `validationDecisions: true`. `hello` at v1 or v2 never lists the validation methods; calling one at v1 or v2 answers `dot_unsupported_contract_version`. Every v2 method also answers at v3 with `contractVersion: 3` in its result.
- `dotIngress.validations.list`: params `{ contractVersion: 3, dotRequestId?, limit? }` (limit 1 to 100, default 50, strict); result `{ contractVersion: 3, validations: View[] (at most 100), hasMore }`, oldest first (dispatch order). No cursor: the Site pages what NASH reported.
- `dotIngress.validations.decide`: params `{ contractVersion: 3, decisionId: uuid, validationId, decision: 'waive' | 'reject' }` (strict; no reason text, no decider); result `{ contractVersion: 3, decisionId, validationId, dotRequestId, outcome: 'decided' | 'already_decided' | 'closed', decidedAt: timestamp | null, duplicate }`. `decidedAt` is `null` exactly when the outcome is `closed`. `already_decided` means the desktop or another dot decision won first; `closed` means nothing waits any more (for example a validator decided since); `duplicate: true` is a replay of this `decisionId` answered from the ledger.
- Error codes: v3 adds only `dot_validation_not_found` ("The validation decision was not found.", retryable `no`) for an unknown validation, one still pending a validator, or one of a run dot did not start; a v1 or v2 caller would get `dot_request_not_found`. The decide method can also answer `dot_ingress_disabled`, `dot_rate_limited` (`window: 'minute' | 'utc_day'`) and `dot_idempotency_conflict` (same `decisionId` with another validation or decision).
- Ledger: tables `dot_validation_ledger_schema` and `dot_validation_decisions` keep the first answer per `decisionId` (at most 10,000 rows).
- Hidden CLI: `orca dot validations [--request <id>] [--limit <n>]` and `orca dot validation-decide --validation <id> --answer waive|reject [--decision-id <uuid>]`.

### 3.2 Remote MCP tools (Site)

| Tool | Input (never `contractVersion`) | Output | `nash` block |
|---|---|---|---|
| `nash_list_validation_decisions` (read) | `{ dotRequestId?, limit? (1 to 50, default 20), cursor? }`, strict | `{ validations: View[] (at most 50), nextCursor: string \| null }` | `source: 'events'`, `mapsTo: null`, `inboxKind: null`, `dedupKey: null` |
| `nash_decide_validation` (write, `destructiveHint: true`, `idempotentHint: true`) | `{ decisionId, validationId, decision: 'waive' \| 'reject' }`, strict | `{ receipt }` (validation decision receipt) | `source: 'inbox'`, `mapsTo: 'dotIngress.validations.decide'`, `inboxKind: 'validation_decision'`, `dedupKey: 'decisionId'` |

- New Site tool error `validation_decision_not_open`: "NASH has not reported a validation decision with this id that is still waiting. Decide it in the app.", retryable `no`. The other tool errors are unchanged (`nash_never_paired`, `unauthorized`, `payload_invalid`, `rate_limited`, `inbox_full`, `idempotency_conflict`, and so on).
- `nash_status` output: `status` gained the required field `manifestSha256` (see section 3.6).

### 3.3 Inbox item, receipt and ack

- **Item** `kind: 'validation_decision'`: `payload` is exactly the v3 decide params with `contractVersion: 3` injected by the MCP layer; `dependsOnItemId` is the accepted submit item of the request named by the pending event (never `null`); `payload.decisionId` must not equal the item id. `expiresAt` is `createdAt` plus `submitTtlMinutes` (30); there is no deadline field, because a waiting validation has none.
- **Receipt** (`DotRemoteValidationDecisionReceiptSchema`, part of the receipt union): states `queued`, `claimed`, `accepted` (with `duplicate`), `refused` (with a NASH refusal), `expired`. `dotRequestId` and `payloadSha256` are always set.
- **Ack mapping** (NASH journals the outcome before it acks):

| NASH local answer | Ack outcome | Receipt |
|---|---|---|
| `decided`, `duplicate: false` | `accepted` with `dotRequestId` | `accepted`, `duplicate: false` |
| `decided`, `duplicate: true` (replay NASH answered before) | `duplicate` | `accepted`, `duplicate: true` |
| `already_decided` | `accepted` | `accepted`; the settled event names the winner |
| `closed` | `accepted` | `accepted`; the settled event says `closed` |
| refusal `dot_validation_not_found` (or another `dot_*` code) | `refused`, `dotRequestId` of the submit, refusal `{ by: 'nash', code, message }` | `refused` |
| `expiresAt` passed before NASH acted | `expired` | `expired` |

- NASH refusals now cover every v3 code (`DotRemoteNashRefusalSchema` over `DOT_INGRESS_ERROR_CODES_V3`).

### 3.4 Events (allowlist now eight kinds)

- `validation_decision_pending`: `data` is exactly the section 1 view (strict); `data.dotRequestId` must equal the event's `dotRequestId`.
- `validation_decision_settled`: `data` is `{ validationId, outcome: 'waived' | 'rejected' | 'closed', decidedAt: timestamp | null }`, `decidedAt` `null` exactly for `closed`. Outcomes `waived` and `rejected` name whichever decision won, from dot or the app.
- Request projection (`view.request`, `nash_get_request`): new list `validationDecisions`, the newest event per `validationId`, at most 50 per request. A request stored before v3 reads as an empty list.
- NASH side: one facet `validation_decision:<validationId>` per decision; NASH reports at most 50 open decisions per binding at a time (`policy.limits.validationDecisionsOpenMax`), the oldest first among the requests it follows, and reports a reported one as settled once it stops waiting. A request is followed until no validation of its run waits, even after the run ended.

### 3.5 Hosted behaviour (manifest rule `rules.validationDecisions`; the Codex readiness points)

1. **Open set.** A decision is open while its newest event is `validation_decision_pending`, its request is an accepted submit of this binding, and that event is less than `retentionDays` (7) old. A settled event closes it for good; stale, duplicate or late pending events never reopen it (the usual eventId-then-sourceRevision order).
2. **Expiry and TTL anchor.** A pending decision has no deadline. It stops being open `retentionDays` after its pending event's `at` (logical expiry, before bounded cleanup). A decide item expires `submitTtlMinutes` after the decide call; after that dot decides again with a new `decisionId`.
3. **Listing and capacity.** `nash_list_validation_decisions` returns open decisions only, oldest first by `createdAt` then `validationId`, at most `limit` per page with `nextCursor`. At most `validationDecisionsOpenMax` (50) open decisions per binding: beyond that only the oldest 50 count as open and the rest wait until older ones close (nothing is dropped; NASH itself never reports more than 50). After settlement a decision leaves the list but stays in `nash_get_request` until retention purges it.
4. **Idempotency order.** Deduplication on `decisionId` (scoped to owner, device and tool) runs first: the same payload returns the original receipt in its current state, even after the decision closed; another payload is `idempotency_conflict`. Then: a new `decisionId` for a decision that is not open is `validation_decision_not_open` and stores nothing; otherwise one item is queued. A second `decisionId` while the decision is still open is queued too; NASH answers it `already_decided` (ack `accepted`) and the settled event names the winner.
5. **Privacy.** See section 1: the desktop masks; the Site stores and returns the fields unchanged.
6. **Compatibility.** Local v1 and v2 are unchanged. The heartbeat now states `contractVersion: 3`, and the Site's v3 schema refuses any other value with `payload_invalid` (so an old NASH never shows online on the new Site, and the new NASH never on the old one; deploy part C and rebuild part D together). Existing receipts and events stay valid under v3. A pending event for a request the binding never accepted, or whose records aged out, is `unknown_request`; NASH stops sending it and the decision can be made only in the app. A new pairing closes NASH's tracking of requests of other generations and fences their events, so decisions of an old device's requests are app-only.

### 3.6 Served manifest hash

- `nash_status` returns `status.manifestSha256`: the `manifestSha256` of the manifest copy the Site serves from. It is read-only, names no owner or device, needs no pairing and creates nothing. No new endpoint: the endpoint table is unchanged at 13 routes. Do not add a Site-only route for this.

### 3.7 Generated artifacts in `desktop/orca/src/shared/dot-remote/`

- Regenerated from code only (targeted file snapshot updates of `dot-remote-manifest.test.ts`, `dot-remote-envelopes-freeze.test.ts` and `dot-remote-vectors.test.ts`). Never hand-edit a generated file.
- **Counts:** tools 10 to **12**; endpoints **13** (unchanged); conformance vectors 29 to **37** (new: `accepted.nash_list_validation_decisions`, `accepted.nash_decide_validation`, `race.validation_decided_on_desktop`, `race.validation_second_decision_id`, `race.validation_decision_replay`, `error.validation_decision_not_found`, `error.validation_decision_wrong_owner`, `error.validation_decision_input`; the six race and error ones are required cases). One payload hash example was added (`validation decision`).
- `contractVersion` and `injected.contractVersion` are 3; `contractGolden` is the v3 golden above; `policy.limits.validationDecisionsOpenMax` is 50; new rule `validationDecisions`; the `contractVersion` and `expiry` rules were extended.
- Manifest hash before: `fbfc682df32ad091fdb6834b8f98a9327ef4281cfaf7b80a49b16507650516db`. **After: `94bbd6fc2964a3a8ef79fb4000dfafd3d14a8d5567f5d6f20269fc223bad4c19`.**
- File sha256 after regeneration (what the pin script records): `dot-mcp-tool-manifest.json` `55a6c4743e8f01ae7bdda3d06d4052d6a8a230d81c1d8703df7bfd8cdfffaaf2`, `dot-remote-endpoints.json` `5595fc7913f71326d246e2c38f866c6155d0441e415621182a549eb0b9d2bfec` (unchanged), `dot-remote-conformance-vectors.json` `71fa84a5eee515e34a39d455412809fc00731fc43a11e7d615e7dcecd6755afc`, `dot-remote-inbox.schema.json` `2b3735e27e313e84116f518d200c2a7488afba1f559569b1f34fbd01b9d843bb`, `dot-remote-ack.schema.json` `50bbad9808c2ccc9a94f80f552149fdaae1c4705565786a998b6e24e9bdf5f63`, `dot-remote-receipt.schema.json` `dfe2d055b1a95d5e7e56b31f97b19b1822b2881bdc8e5d42f56ce0899c02926a`, `dot-remote-events.schema.json` `65dd8a9dde8a8272dc724609fd520efb07d29b832d822486cb5ffab62b0ae0b9`, `dot-remote-presence.schema.json` `69da6af585bfc3989e57dce01e2249bb1cf4f7bf1a9a23c94440b5a4c4830a9c`, `dot-remote-pairing.schema.json` `0fee187fc6feda95566194ebd295809d48e7af8af5e9693609b84ba7af462f80` (unchanged).
- New desktop pin: `DOT_INGRESS_CONTRACT_V3_GOLDEN_FILE` and `DOT_INGRESS_CONTRACT_V3_GOLDEN_SHA256` in `dot-remote-contract-pins.ts` (the v1 and v2 pins stay).
- Desktop `dot_remote_*` tables moved to schema version 2 (new event and item kinds); a version 1 family is migrated in place on start.

## 4. Part B: Site work (Codex)

Read `sites/nash-dot-mcp/README.md` and `docs/dot-mcp-sites-deployment-2026-10-05.md` first.

1. **Update `scripts/pin-remote-artifacts.mjs`.** Exactly these constants change (line numbers as of 2026-10-06):
   - line 19, golden path: `'dot-ingress/dot-ingress-contract-v2.schema.json'` becomes `'dot-ingress/dot-ingress-contract-v3.schema.json'`;
   - line 21, golden pin key: `pins['dot-ingress-contract-v2.schema.json']` becomes `pins['dot-ingress-contract-v3.schema.json']` (its value is computed from the bytes and must equal `531a90a8fcaefff5cf6ee09fca71dc55bc9dc5f45e8d26bc53d75ac173510132`, which the line 26 check compares with `manifest.contractGolden.sha256`); the error text `'v2 golden pin mismatch'` on line 26 becomes `'v3 golden pin mismatch'`;
   - line 27, the three counts: `manifest.tools.length !== 10` becomes `!== 12`, `vectors.vectors.length !== 29` becomes `!== 37`, `endpoints.length !== 13` stays `!== 13`;
   - line 37, the message `10 tools, 13 routes and 29 vectors` becomes `12 tools, 13 routes and 37 vectors`.

   Other Site files that still say version 2 (check them; not edited by part A): `scripts/verify-remote-bundle.mjs` lines 13 and 19 (the `dot-ingress-contract-v2.schema.json` pin key), `lib/remote-mailbox.ts` lines 39 and 375 (the stored heartbeat type and value `contractVersion: 2`), `scripts/remote-http-smoke.mjs` line 42 (heartbeat body), and the scaffold files `scripts/extract-scaffold-schema.mjs` (lines 4 and 24), `lib/mcp-scaffold.ts` line 136 and `tests/mcp-scaffold.test.ts`.
2. **Pin and compile.** Run `node scripts/pin-remote-artifacts.mjs`, then `node scripts/compile-remote-schemas.mjs`. Do not edit anything under `generated/` by hand.
3. **Implement the two tools**, next to the permission-prompt tools in `lib/remote-workflow.ts`, `lib/remote-mailbox.ts` and `lib/remote-state-store.ts` (wherever those tools live), following section 3.5 and the manifest rule `validationDecisions`; fold the two new event kinds into the request projection; add `manifestSha256` to `nash_status`. No new HTTP route is needed: items, acks and events use the existing routes. Same identity rules as the other data-bearing tools: a verified ChatGPT owner for MCP calls, and `Nash-Session` or `Nash-Device-Credential` for device routes.
4. **Storage.** Keep the 1 MiB snapshot cap, the 64 KiB revocation reserve and the pairing reserve. At most 50 open decisions per binding (section 3.5). Add a new migration only if needed, as a new file; never edit applied migrations.
5. **Checks.** All of these must pass:
   - `node --experimental-strip-types --test tests/*.test.ts`
   - `node node_modules/typescript/bin/tsc --noEmit`
   - `node scripts/verify-remote-bundle.mjs`
   - `node scripts/compile-remote-schemas.mjs --check`
   - the build as the README describes.
   - All 37 regenerated vectors, plus tests for both tools: listing (order, cursor, empty and unpaired), a replay, a conflict, a decision already made on the desktop, another owner's item, the withheld summary, the capacity bound, logical expiry, and an old v2 snapshot.

**This machine's rules.** The user's antivirus flags script launchers, so start tools as `node <entry>.js` (the README shows the direct `npm-cli.js` path for npm). Do not start `.cmd`, `.bat`, `.ps1` or PowerShell, and keep Windows line endings in files that have them.

## 5. Part C: redeploy (Codex)

1. **Record the currently live saved version first.** The last recorded one is `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e~appgver_f89ec05a1e088191812aa4af65beb886`, deployment `appgdep_6ac48c154f908191aa07318202bdd5ba`.
2. **Save and deploy natively to the same Site and project:**
   - URL: https://nash-dot-mcp.taojuguo.chatgpt.site
   - project `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e`

   **Keep access owner-private**, with no audience change. Sites applies pending migrations once.
3. **Verify after deployment:**
   - the native status is `succeeded` with `has_mcp: true`;
   - the MCP tool list shows 12 tools, including the two new ones;
   - `nash_status` returns `status.manifestSha256` equal to `94bbd6fc2964a3a8ef79fb4000dfafd3d14a8d5567f5d6f20269fc223bad4c19` (section 3.6);
   - access is still owner-only;
   - one read-only `nash_list_validation_decisions` call returns an empty list or "no App paired", without creating a pairing or a task.
4. **Rollback.** If any check fails, republish the version recorded in step 1 and report it.
5. **Write the deployment record**, `docs/dot-mcp-sites-deployment-<date>.md`: version, deployment id, source commit, archive SHA-256, manifest hash, the checks run, and anything not verified.

**Secrets.** Put no token or credential in source, docs, logs or commits. Pass the platform service credential through hidden input only, as in the 2026-10-05 deployment. The user rotates the Cloudflare token before any live check.

## 6. Part D: after deployment

1. NASH is rebuilt with contract v3. Its heartbeat and every relayed item state `contractVersion: 3`, which only the v3 Site accepts (the desktop does not check the served manifest hash at run time; that check is part C's).
2. The user pairs in Settings → Remote access.
3. Live gate G-remote, plus one dot waive and one dot reject on a test run, checking that the primary receives the right notice.

## 7. Background: the G6 decision service

Part A was done by the NASH main session (package G7-A). For reference:

**G6's decision service** is `desktop/orca/src/main/runtime/task-validation/validation-decision-service.ts`. `createValidationDecisionService({ owner, now?, announce?, readOrigin?, readWorktreeChanges? })` returns:
- `listPending({ limit, origin? })`: `origin` filters by who started the run, through `readWorkflowRunOrigin`. Items are the desktop view (with `processMayRun`), which never reaches dot.
- `decide({ validationId, decision: 'waive' | 'reject', by: 'desktop_user' | 'dot' })`, a Promise because a waive reads the attempt worktree's git state first. With `by: 'dot'` it refuses any run dot did not start (`autopilot_validation_decision_not_owned`). Store errors pass through unchanged: `autopilot_validation_conflict` for a repeated, late or still-pending decision, and `autopilot_validation_not_found`. It files the notice to the primary (`validation-decision-notice.ts`) and announces it to the run.

The desktop methods `workbench.validation.listDecisions` and `workbench.validation.decide` call it with `by: 'desktop_user'` behind `requireWorkbenchCaller`. The dot methods call it with `by: 'dot'`, the same announce and the same worktree reader, map `not_owned` and `not_found` to `dot_validation_not_found`, and map a conflict to `already_decided` or `closed` from the stored result.

## 8. Checklist

- [x] G6: desktop decision service and Workbench list (2026-10-06; tests pass, not yet tried in the running app)
- [x] A: local dot v3, exposure, sync relay and events, regenerated contract, new pin, and the new manifest hash recorded in section 3 (2026-10-06; tests pass, not tried in the running app or against a Site)
- [x] B: Site tools, storage and checks (2026-10-06; 144 tests, types, build and local HTTP passed)
- [ ] C: redeploy, verification and deployment record (v3 published; served hash and owner-private access verified; awaiting refreshed client catalog and validation-list call; see `dot-mcp-sites-deployment-2026-10-06.md`)
- [ ] D: rebuild, pair, G-remote, dot waive and reject on a test run
