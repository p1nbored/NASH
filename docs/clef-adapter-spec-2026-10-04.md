# Clef adapter specification (phase 1)

> **Superseded in part on 2026-10-05 by D-016, D-020 and D-022.** Read this spec together with the [Clef classifier spec](clef-classifier-spec-2026-10-04.md), which replaces its classification parts. The text below is kept unchanged as the record of phase 1.
>
> - **Still in force:**
>   - section 2 (process boundaries);
>   - section 4 (sealed credentials; the files now live under `~/.nash`, D-017);
>   - in section 5: the endpoint, headers, content scan, preflight limits and request-body hashing;
>   - section 6 (response validation);
>   - section 7 (transport, error mapping, latches, circuit, redaction);
>   - the ledger mechanism of section 8 (reserve, settle, price basis);
>   - the verified-profile mechanism of section 14 (Verify, report, Pin);
>   - the offline-test and hygiene rules of section 15.
> - **Superseded by D-016:**
>   - section 9 (legal tuples and guards), section 10 (decision policy and record), section 12 (lifecycle) and section 16 (phasing);
>   - every tuple, profile, surface and codex-plugin-cc clause, including the tuple and plugin enums of section 3;
>   - the five-question set and route options of section 5 (now two questions on each TaskSpec);
>   - the v2 persistence of section 11 (now Workbench v3, with the route-decision, dispatch-intent, override and outbox tables dropped);
>   - `workbench.route.retry` and `workbench.route.decision.get` in section 13 (removed).
>
>   There is no Clef classification at intake. Clef classifies each TaskSpec into `needs_delegation` and `task_type`, and the Routing Table selects target, model and effort.
> - **Superseded by D-022:** every paid-call cap.
>   - The US$5.00 test and verification cap and the daily neuron cap (sections 1 and 8) are gone.
>   - The rule that an unset cap fails closed, in the G0 gate (section 9) and in the tier-0 check (section 14), is gone.
>   - "Caps remaining" in the status view (section 13) is gone.
>
>   The app has no budget cap and no cost warning. Kept: the ledger as a record of spend, and 2 billed attempts per TaskSpec as a retry bound. The "per-request attempt budget" of section 7 now counts per TaskSpec. Live calls during development stay within the free tier plus US$5 as a testing rule, not an app limit.
> - **Superseded by D-020:** the state data class is `agent_task_spec`; `user_task_summary` (section 5) no longer reaches Clef.

Date: 2026-10-04. Status: the build specification for the Clef-direct routing adapter in `desktop/orca`. It consolidates the adapter design and three independent critiques (scratch research, not committed) with decision D-012. Requirement IDs (R01-R60) and conflict IDs (C1-C14) refer to the requirements checklist that the research run extracted from the project brief, workbench brief, decision log, acceptance criteria, threat model and upstream-compatibility notes; the brief governs where they conflict.

## 1. Decisions in force

- D-012: sealed credentials in Orca's encrypted store (no environment variables); phase 1 routes each Workbench intake request once over the full legal tuple set; the Clef `state` carries scanned, length-capped structured English fields only; live test calls capped at a cumulative US$5.00; production defaults of 2 billed attempts per request and 2,000 neurons per UTC day.
- D-011 (hosted Clef authorized; credentials never in the repository) except where D-012 supersedes it.
- D-006/D-008: reuse Orca's existing owners (intake store, runtime RPC, agent launch); no parallel scheduler.
- Fail closed everywhere: any missing configuration, pin, cap, verification or validation ends in `ROUTING_BLOCKED` with exactly one reason and detail. There is no rule classifier, shadow mode, Claude fallback, `clef-flash`, stale cache or next-best tuple (R31, R32).

## 2. Process boundaries

- All Clef HTTP, credential reads, budget accounting and routing run in the Electron main process. Nothing secret crosses IPC, RPC, the renderer, the database or logs.
- Runtime and RPC modules may not import `electron` (`config/runtime-electron-baseline.txt` is empty). Electron-backed capabilities reach them through ports installed at startup, following `src/main/network/http-client.ts`:
  - HTTP: `getMainHttpClient()` (existing).
  - Credentials: `src/main/clef/clef-credential-port.ts` (`setClefCredentialSource` / `getClefCredentialSource`), installed in main startup with the sealed-store implementation from `src/main/clef/clef-sealed-credential-store.ts` (the only Clef module allowed to import `electron`, and only reachable from the main-process startup and IPC layer, not from runtime entry points).
- Every source file stays under the 300-line lint limit (no `max-lines` disables). Clock, randomness, credentials, HTTP and `AbortSignal` are injected for tests.
- Naming: avoid "routing" under `rpc/methods/orchestration` (mail routing already lives there). Clef client code lives in `src/main/clef/`; routing domain code in `src/main/runtime/workbench-routing/`.

## 3. Shared contract (`src/shared/clef/`)

`execution-tuple.ts`
- `MODEL_PROFILE_IDS = ['claude_planner', 'claude_engineer', 'codex_researcher', 'codex_assistant', 'agy_writer']`
- `EXECUTION_SURFACES = ['claude_native', 'codex_exec', 'codex_plugin', 'agy_command']`
- `PLUGIN_OPERATION_IDS = ['branch_review', 'current_change_review', 'adversarial_review', 'continue_plugin_job', 'context_transfer']`
- `TupleId`: internal form `profile:surface` or `profile:surface:operation`; `encodeWireOptionId` / `decodeWireOptionId` use the dot form (`codex_assistant.codex_exec`) so option IDs share the documented question-ID charset `^[A-Za-z0-9_.-]{1,100}$`. The dot form is a convention, not a claim about server tolerance; the verification call records whether the server echoes it unchanged.

`clef-route-contract.ts` (Zod, strict)
- `RoutingStatus`: `not_configured | sealing_unavailable | contract_unverified | identity_unpinned | budget_unset | ready | unreachable | circuit_open | quota_latched | auth_failed`.
- `RouteBlockerReason`: `classifier_unavailable | invalid_output | missing_inputs | ambiguous | no_eligible_profile` (R33).
- `RouteBlockerDetail`: the R33 list (`not_configured, clef_identity_unpinned, transient_exhausted, quota_exhausted, budget_exhausted, auth_or_account, model_unavailable, request_rejected, data_boundary_forbids, possible_truncation, model_identity_mismatch, low_margin, needs_clarification`) plus phase-1 additions, each documented as an extension pending user review: `contract_unverified, interrupted, choice_outside_legal_set, inconsistent_type_profile, required_profile_unavailable, non_english_objective, estimate_exceeded, plugin_binding_unverified, routing_in_progress`.
- `RouteBlocker = { reason, detail }`.
- `RouteDecision` (section 10) and `RouteDecisionView` (renderer-safe projection: no raw bytes, no URL, no credential presence details beyond status).

`workbench-request.ts` changes (main and renderer change in lockstep; the renderer parses with these strict schemas)
- Status union: `ROUTING_BLOCKED | ROUTING | ROUTED | CANCELED`.
- `routingBlocker`: `RouteBlocker | null` (replaces the `'CLEF_NOT_CONFIGURED'` literal; null unless `ROUTING_BLOCKED`).
- `modelProfileId`, `executionSurface`, `pluginOperationId`, `clefDecisionId`: nullable, set only when `ROUTED`.
- List result: `capabilities.dispatch` becomes a boolean computed from configuration; top-level `blocker` becomes the current `RoutingStatus` summary.

## 4. Credentials (D-012)

- Two sealed values: the API token and the account identifier, each in its own `createEncryptedApiKeyFileStore` file (`~/.orca/clef-api-token.enc`, `~/.orca/clef-account-id.enc`). The upstream store is not modified. The Clef wrapper:
  - refuses `save` when `safeStorage.isEncryptionAvailable()` is false (status `sealing_unavailable`);
  - refuses `read` unless `protection() === 'sealed'`, so a plaintext envelope is never used;
  - validates shape before saving (account id: 32 lowercase hex; token: 20-200 visible ASCII characters), returning only a validation code on failure.
- `ClefCredentialHandle` keeps the values in `#private` fields, implements `toString`, `toJSON` and `[Symbol.for('nodejs.util.inspect.custom')]` as `[redacted clef credential]`, and exposes only `authorizationHeader()` and `accountPath()` to `clef-transport.ts`.
- IPC (`src/main/ipc/clef-credentials.ts`, modelled on `ipc/minimax-credentials.ts`): `clef:credentials:status` (presence and protection only), `clef:credentials:save` (token and account id together), `clef:credentials:clear`. Renderer callers are the trusted desktop renderer only. Values never return to the renderer.
- No account fingerprint is computed or logged.
- Startup: `AUTOPILOT_CLEF_API_TOKEN` / `AUTOPILOT_CLEF_ACCOUNT_ID` (any letter case) are deleted from `process.env` before the daemon, renderer or any child is created, and are never read.

## 5. Request (R01-R07)

- Origin pinned in code: `https://api.cloudflare.com`; path `/client/v4/accounts/{account_id}/ai/run/@cf/cloudflare/clef`. The concrete URL exists only inside the transport call; everything else sees the template.
- Body: `{ "model": "clef", "state": {...}, "questions": {...} }`. Never `images`, never `options`.
- Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`. `redirect: 'error'`, `credentials: 'omit'`, `cache: 'no-store'`.
- Questions, in pinned order (bundle `question_set_version` 1), each with non-empty English `instructions`:
  1. `task_type` (choice): `planning, implementation, research, review, writing, asset_generation, needs_clarification`.
  2. `difficulty` (score): five English levels, lowest first (trivial, small, moderate, substantial, extensive).
  3. `context_scope` (choice): `single_file, module, repository, external_sources, needs_clarification`.
  4. `inputs_complete` (noul): criteria `true` = the request states what to produce and how success is judged; `false` = essential information is missing.
  5. `route` (choice): the eligible wire tuple IDs plus `needs_clarification`. Each option's criteria is the bundle-controlled capability description, including the exec-default rule for Codex options (R09). Descriptions carry a protected rule segment hashed into the bundle hash so optimizers cannot weaken exec-default (R19).
- State (built by `clef-state-builder.ts`, deterministic, English only):
  - `objective` (required; at most 2,000 characters), `expected_outputs`, `acceptance_criteria`, `explicit_constraints` (optional; phase-1 intake supplies only the objective), `data_class` (phase 1: the constant `user_task_summary`).
  - User text sits only in these labeled fields; capability descriptions never appear in state.
  - A request whose objective is not English (any character outside Latin, digits, common punctuation and whitespace) blocks as `missing_inputs` / `non_english_objective` with no call.
- Content scan (`clef-content-scan.ts`) before any call, over every state string: the existing `observability/redactor.ts` rules plus Cloudflare-token-shaped strings, 32-hex identifiers, bearer and JWT shapes, private keys, email addresses, Windows and POSIX absolute paths, and URLs with credentials. Any hit blocks as `classifier_unavailable` / `data_boundary_forbids` and records only which rule matched.
- Preflight (`clef-request-builder.ts`): 1-64 questions, IDs match the charset, 2-255 choice options, 2-10 score levels, total serialized body at most 64 KiB, estimated total input (state plus questions plus option text, at 4 characters per token, rounded up) at most 12,000 tokens. A failure blocks as `classifier_unavailable` / `request_rejected` or `estimate_exceeded` with no call.
- The request body bytes and their SHA-256 are kept locally; hashes are never sent.

## 6. Response validation (R08)

- Raw response bytes and SHA-256 are stored before parsing.
- The envelope mode comes from the verified profile: `cf_result_wrapper` requires `success === true` and an empty or absent `errors`, stores `messages` without gating, and reads the Clef body from `result`; `bare` reads the body at the top level. No verified profile means no call.
- Unknown extra fields are tolerated and preserved in the raw bytes; required fields are strict.
- Checks: `model` equals the pinned `expected_response_model` (else `invalid_output` / `model_identity_mismatch`); answer keys equal the question IDs; each answer's type matches its question; noul value in [0,1]; choice and score probabilities have keys equal to the sent options or level indices (as the profile pins), values in [0,1], sum within the profile-pinned tolerance (default 1e-3); `choice` equals the strict argmax and a tie is `ambiguous` / `low_margin`; score value within [0, levels-1] (inferred from the schema description; recorded as inferred); confidence in [0,1], stored and never used (R39); `usage.input_tokens` and `usage.output_tokens` are non-negative integers.
- Truncation: `usage.input_tokens` at or above 60,000 gives `invalid_output` / `possible_truncation`; above twice the local estimate gives `invalid_output` / `estimate_exceeded`.
- Any failure is `invalid_output`, never retried.

## 7. Transport, errors, circuit

- `clef-transport.ts` uses `getMainHttpClient()`, sets up the proxy with `ensureElectronProxyFromEnvironment` using the origin only as `probeUrl`, always reads or cancels the body, and redacts inside its tracing span before any attribute or error leaves it.
- Retries: only transport errors, 5xx and 408; at most the per-request attempt budget (default 2 billed attempts, counted across retries, `workbench.route.retry` and re-routes), full jitter (base 500 ms, cap 4 s), 30 s overall deadline combined with the caller's `AbortSignal`.
- Status-first error mapping (S7 internal codes are refinements only when the verified profile pins their location):
  - 400: `request_rejected`; 401 or 403: `auth_or_account` (sets the `auth_failed` latch until credentials change); 404: `model_unavailable`; 413: `request_rejected`; 429: `quota_exhausted` (sets the `quota_latched` latch until 00:00 UTC; retry-on-3040 stays off until the code location is pinned); other 4xx: `request_rejected`; 3xx (redirect refused): `request_rejected`; 5xx or transport after retries: `transient_exhausted`.
- Circuit (`clef-call-circuit.ts`): opens after 3 consecutive `transient_exhausted` outcomes, half-opens after 5 minutes on the next on-demand trigger with no probe call, closes on success.
- Redaction (`clef-redaction.ts`): scrubs the live token and account id values, any `/accounts/<id>/` segment and bearer headers from strings, `Error` messages, stacks and nested `cause` chains. `observability/redactor.ts` gains a Cloudflare account-path rule and a Cloudflare-token rule so diagnostic bundles are covered too.

## 8. Spend ledger and budgets (D-012)

- Price basis (S5, versioned in the ledger): input tokens at US$0.24 per million (21,818 neurons per million). Output price is not published, so output tokens are recorded as `cost_unknown` and never summed with input cost.
- Before each billed attempt the ledger reserves a conservative upper bound: estimated input tokens times 1.5, priced at the input rate, plus US$0.001. The reservation settles from `usage.input_tokens` when present; a failed or usage-less attempt keeps its reservation as spent (billing of failed calls is unverified).
- Caps, all fail closed when unset:
  - Test and verification cap: cumulative US$5.00 across the install's lifetime for calls marked `purpose: verification | test`. A reservation that would cross the cap is refused.
  - Production: 2 billed attempts per request; 2,000 neurons per UTC day; the latches from section 7.
- The ledger is a `workbench_clef_spend` table (section 11), written in the same transaction as the attempt claim.

## 9. Legal tuples and guards (R11-R24)

- Catalog (bundle-versioned): `claude_planner:claude_native`, `claude_engineer:claude_native`, `codex_researcher:codex_exec`, `codex_assistant:codex_exec`, `codex_researcher|codex_assistant:codex_plugin:<operation>`, `agy_writer:agy_command`. Cross-pairs outside the catalog cannot be expressed (R14).
- Request-level gates (run once, before tuple filtering, each blocking with no call):
  - G0 configuration: sealed credentials present; verified profile present; response model pinned; caps set. Details: `not_configured`, `contract_unverified`, `clef_identity_unpinned`, `budget_exhausted` (cap unset is reported as `budget_exhausted` with status `budget_unset`).
  - G1 data boundary: content scan, English objective, allowed data class.
  - G8a Clef budget reservation (section 8).
- Tuple filters (deterministic, order-pinned, reject-only, each rejection recorded with guard, reason and actionable detail):
  - G2 permissions and workspace admission (re-admitted at route time; read-only requests drop write-capable tuples).
  - G3 approved models (Gemini 4 never; `agy_writer` rejected as `agy_model_unapproved` until an approved non-Gemini-4 model is recorded).
  - G4 tool availability via Orca's agent detection (`claude` for `claude_native`, `codex` for `codex_exec`).
  - G5 plugin scope: manifest of the pinned plugin version intersected with project scope; phase 1 rejects every plugin tuple as `plugin_binding_unverified` because no operation-to-command binding is verified; `continue_plugin_job` is never a Clef choice (continuation follows the owner, R28).
  - G6 explicit user constraints (narrow only).
  - G7 worktree ownership and concurrency.
  - G8b per-candidate provider headroom (Codex exec and plugin share one pool).
  - G9 required profile: if a pinned required profile is ineligible, `no_eligible_profile` / `required_profile_unavailable` with no call.
- An empty eligible set gives `no_eligible_profile` with no call (R12). One eligible tuple plus `needs_clarification` still makes a valid two-option question.
- `legal_set_hash`: SHA-256 over canonical JSON of the bundle version, sorted eligible tuple IDs and manifest versions.

## 10. Decision policy and record (R10, R17, R30, R38, R39)

- Policy (reject-only, in order): validation failure gives `invalid_output`; `route` or `task_type` equal to `needs_clarification` gives `missing_inputs` / `needs_clarification`; `inputs_complete` below 0.5 gives `missing_inputs` / `needs_clarification`; route top-1 minus top-2 below 0.10 or a tie gives `ambiguous` / `low_margin`; a choice outside the sent set gives `invalid_output` / `choice_outside_legal_set`; the consistency table (for example, `claude_planner` requires `planning`; plugin review operations require `review`) gives `ambiguous` / `inconsistent_type_profile`; otherwise `routed`. The 0.5 and 0.10 thresholds and the difficulty buckets (levels 0-1 low, 2 medium, 3-4 high) are provisional bundle values pending user review.
- Binding (`route-binding.ts`): maps (tuple, difficulty bucket) to a fixed `AgentLaunchIntent` agent (`claude` for `claude_native`, `codex` for `codex_exec`), approved model and effort from the pinned table, structured-or-terminal mode, sandbox and write scope from the request's permissions. It reads nothing from Clef beyond the tuple and the bucket. `ultra` effort stays excluded (C14).
- Record (`workbench_route_decisions`, one row per attempt or local block): decision id; request id and revision at claim; `decision_source` (`clef` only when Clef answered; `local_gate` for pre-call blocks); outcome (`routed | blocked | invalid_output | discarded_after_cancel`); blocker; task type, difficulty score and bucket, context scope, inputs-complete value; selected tuple, profile, surface, operation; effort and binding; composite classifier version (URL template, path and body model, observed and expected response model, verified-profile hash, schema pins, docs revision); question, taxonomy, policy and bundle versions and question order hash; legal set hash, eligible tuples, rejected candidates; state hash, request body hash; raw response reference and hash; verbatim probabilities; provider confidence labeled `not_used`; usage, computed neurons (input only), spend reservation id; attempts; transport error class; cache hit; evidence references; created time. No free-text rationale.

## 11. Persistence (`ensureWorkbenchRequestSchema`, v2 layout; v1 refused)

- `ensureWorkbenchRequestSchema` creates the v2 layout in one transaction, separate from the main orchestration chain (its own version table; `user_version` stays Orca's), and verifies an existing layout by exact-SQL comparison. A pre-release v1 layout is refused with `workbench_recovery_required` and nothing is written, as Orca refuses its own unreleased dev layouts; there is no v1 migration, and a developer resets by dropping the `workbench_*` tables. The v2 layout is:
  - request status check adds `ROUTING` and `ROUTED`; blocker stored as reason and detail columns; nullable binding columns.
  - event kinds add `routing_started`, `routed`, `routing_blocked` (existing), `route_discarded`.
  - outbox states add `claimed` and `consumed`.
  - new tables: `workbench_route_decisions`, `workbench_clef_raw_responses` (sensitive at rest; excluded from exports and diagnostic bundles), `workbench_clef_spend`, `workbench_dispatch_intents`, `workbench_route_overrides`.
- `workbench-route-store.ts` owns claim, outcome and dispatch-intent writes, all revision-guarded inside lifecycle write transactions. `workbench-request-store.ts` keeps submit, list and cancel (cancel extends to `ROUTING` and pre-handoff `ROUTED`).

## 12. Lifecycle

- Submit commits as today. If G0 fails, the request is `ROUTING_BLOCKED(classifier_unavailable, <detail>)`. If G0 passes, the claim runs in the same transaction (status `ROUTING`, outbox `claimed`, event `routing_started`), and the router is started without awaiting, with a rejection handler that records `classifier_unavailable` / `transient_exhausted` on unexpected failure.
- Router (`workbench-request-router.ts`): on-demand only (submit, `workbench.route.retry`); request gates, tuple filters, build, reserve, call, validate, decide, record. An in-memory `AbortController` per request supports cancel. A revision that moved during the call stores the decision as `discarded_after_cancel` and leaves the request untouched.
- Cancel never calls or awaits Clef; it aborts, withdraws the outbox and sets `CANCELED` in one transaction. List, status, decision inspection and cancel read only local SQLite (R34).
- Startup recovery: rows left in `ROUTING` become `ROUTING_BLOCKED(classifier_unavailable, interrupted)` with reservations released; no network, no automatic paid re-route.
- Cache: a decision is reused only on an exact fingerprint (URL template, path and body model, pinned response model, verified-profile hash, question set and order, taxonomy, policy and bundle versions, option text, canonical state hash, legal set hash) and only for `routed` outcomes, with eligibility revalidated (R36).
- Dispatch handoff (`workbench-route-handoff.ts`): re-runs G1 and G2-G8b against current state; on failure before launch, one automatic re-route back to `ROUTING` within the per-request attempt budget (R18, C7), never a next-best tuple; writes a one-use `DispatchIntent` (route id, input and scope hashes, operation, generation, provider reservation) atomically, then calls `executeAgentLaunch`. After launch, status, follow-ups and cancel follow the recorded owner (R28).

## 13. Surfaces

- RPC (`rpc/methods/workbench.ts`, trusted-renderer caller check, `workbench_` errors): `workbench.route.retry {requestId, expectedRevision}`, `workbench.routing.status` (null params; status, caps remaining, latch and circuit times; no secrets), `workbench.route.decision.get {requestId}` (`RouteDecisionView`), `workbench.clef.verify` (opt-in verification call, section 14), `workbench.clef.profile.pin` (records the verified profile after the user confirms the report). Params live in `src/shared/rpc-contract/workbench-params.ts`; the catalog is regenerated.
- The Orca CLI and agents cannot reach paid calls: the new methods are `workbench.*` and require the trusted desktop renderer caller. `teamctl route` (R60) and the metadata doctor tier (R50) are deferred until a trusted CLI caller model exists; the offline doctor tier is exposed through `workbench.routing.status`.
- Renderer: Clef settings section (token and account id entry, presence and protection display, clear, verification button with cost estimate and spend so far, report view and pin confirmation); Workbench routing status; per-request localized blocker with "Retry routing"; route inspector (R57 fields; confidence shown only as "not used"; no invented reasoning). Model and surface are separate badges; exec and plugin are labeled surfaces of Codex (R58).

## 14. Live verification (R50, R54)

- Tier 0 (offline, always): sealed credentials present, sealing available, caps set, bundle and schema pins present, no environment variables in use.
- Tier 2 (opt-in, user clicks Verify; counts against the US$5.00 cap): one synthetic English request with the production question set and the full phase-1 tuple option set. The report (redacted: no token, no account id, no concrete URL) records the HTTP status, envelope shape, `model` value, whether the dotted option IDs and level-index keys were echoed, probability key coverage and precision, usage fields versus the local estimate, and raw-body SHA-256.
- The user confirms the report in the settings section; only then is the verified profile written (envelope mode, expected response model, option-ID form, score key form, sum tolerance, verified time, report hash). The profile lives in a main-process-owned file written only through `workbench.clef.profile.pin`; its hash is stored in every decision.

## 15. Tests (R51-R53, R56)

- Offline and credential-free. Fakes live only in test paths, labeled `FIXTURE_ONLY`; a static test fails if production code imports them. A 32-hex fake account id and a fake token are used so redaction tests exercise the real shapes.
- Unit: endpoint and pins; credential wrapper (plaintext refused, inspect/JSON/string redaction, nested causes); content scan; state builder (English check, field caps); request builder and preflight limits; response validator (one case per check, both envelope modes, unknown fields); transport on an injected fake HTTP client (every error row, retries, jitter bounds, deadline, abort, body consumption, redirect refusal); circuit; spend ledger (reservation, settlement, US$5 cap refusal, UTC day boundary); guards (exec default, plugin rejected in phase 1, agy rejected, Gemini 4 excluded, constraints narrow only, empty set no call, required profile); policy (changed fake decision changes the bound tuple; confidence never changes the outcome); fingerprint (any component change misses).
- Integration (in-memory `OrchestrationDb`): a v1 layout is refused with no write; claim races; cancel during an in-flight call; startup recovery; an outage blocks routing while list, status, cancel and decision inspection work; dispatch-time eligibility change re-routes once without a next-best launch.
- Hygiene: no production module other than the transport issues Clef HTTP; scans for `clef-flash`, alternate model clients and real-looking account ids; startup environment scrub; the runtime Electron ratchet.
- Coverage at least 80% on all new modules.

## 16. Phasing

- Phase 1a (this build): sections 3-13 with live verification and the settings and Workbench surfaces.
- Phase 1b: dispatch handoff end to end once a verified profile exists; the US$5 cap covers its live smoke tests.
- Phase 2: subtask routing at worker start with an agent-input trust model (data class inherited and not lowerable, agent constraints are not user constraints, mandatory content scan, per-run budget); plugin operation bindings; `teamctl route` and the metadata doctor tier behind a trusted CLI caller.
