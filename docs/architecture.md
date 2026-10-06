# NASH architecture

- Date: 2026-10-05. Status: describes the D-016 alignment as built in `desktop/orca`, the NASH app (an Orca fork).
- Authority: the user's [architecture direction](architecture-direction.md) and decisions D-013 to D-022 in the [decision log](decision-log.md). Where this document and a decision differ, the decision wins.
- Replaces the 2026-10-02 M0 draft. That draft is archived byte-exact at `C:/Programs/autopilot-archive/2026-10-04/removed-code/d016-alignment/docs/architecture.md` (sha256 `35a77252dcae42a074a410d59086c86277e67bd842be0e7af2760a9bcfd7a6d1`).
- Companion documents: [Clef classifier spec](clef-classifier-spec-2026-10-04.md), [Routing Table evidence](routing-table-evidence.md), [NASH operations](nash-operations.md), [remote MCP plan](dot-mcp-remote-plan.md).

Evidence words used below:

- **tested**: built and covered by automated tests that use injected fakes. No real CLI, network call, model call or credential was involved.
- **not verified live**: the behaviour depends on a real CLI, account, model or service and has not been exercised yet. The gate that verifies it is named (section 19).
- **planned**: designed, not built.

Nothing in this document has run against a real Claude Code, Codex, agy, Clef or dot session. Every path that needs one is not verified live.

## 1. Rule and minimum path

The rule, in the user's words: "Claude owns planning. Clef owns task classification. The Routing Table owns model/profile selection. The Orca-derived runtime owns execution state. Executors perform work. Validators determine completion." No two components own the same decision.

The minimum path, built first:

```text
dot -> NASH -> Claude Code primary session -> TaskSpec -> Clef -> Routing Table
    -> Claude (primary, subagent, workflow) | Codex CLI | agy CLI -> validation -> result
```

The core path depends on no improvement system (section 18).

## 2. Components and ownership

Paths are under `desktop/orca/src/`.

| Component | Owns | Code | State |
|---|---|---|---|
| dot interface (local) | Submitting structured English requests, follow-up messages, permission answers, coarse status reads | `main/runtime/dot-ingress/`, `shared/dot-ingress/`, `main/runtime/rpc/methods/dot-ingress.ts`, CLI `dot` | tested; no dot client has called it |
| Remote mailbox for dot | dot to NASH over GPT Sites (D-021) | contract files in `shared/dot-remote/` only | planned (section 14) |
| Intake door | Idempotency, principal, workspace binding, requested access, deliverable language, link to the run. Holds no execution state. | `main/runtime/workbench-intake-submit.ts`, `main/runtime/orchestration/db/workbench-request-*` | tested |
| Workflow-run service and primary-session launcher | One Orca Run and one visible Claude Code primary session per request | `main/runtime/workflow-run/` | tested; launch not verified live (G5) |
| Claude Code primary session | Planning, TaskSpecs, integration, declaring the run complete | a terminal tab bound to the Orca Run | not verified live |
| Clef classifier | `{needs_delegation, task_type}` for each TaskSpec, nothing else | `main/clef/`, `main/runtime/task-classification/` | tested; no live call yet (G4) |
| Routing Table | task_type to target, model and reasoning level; the coordinator's model and effort; validation reviewers; versions, proposals, availability | `shared/routing-table/`, `main/routing-table/` | tested; the app has not yet run its availability probes (G3) |
| Orca runtime | Runs, tasks, dependencies, attempts (dispatches), workers, mailbox, receipts, terminals | Orca's `orchestration.db` tables, unchanged | Orca code |
| Executors | Codex CLI, agy CLI, and in-session Claude (subagent, workflow, the primary itself) | `main/runtime/task-execution/`, `main/codex-exec/`, `main/agy-exec/`, `main/agent-exec-shared/` | tested with fake CLIs; not verified live (G5, G7, G8) |
| Validators | pass, fail or inconclusive per attempt. The only path that completes a task in an app run. | `main/runtime/task-validation/` | tested; reviewer runs not verified live |
| Permission relay | Permission decisions answered by dot, the desktop or the terminal. First answer wins. | `main/runtime/permission-relay/` | tested; not verified live (G6) |
| Single-authority guards | Refuse Orca commands that would bypass the app inside an app run | `main/runtime/workflow-run/app-run-policy.ts` | tested |
| Desktop UI | Workbench runs and permission prompts; Settings for the Routing Table and Clef verification; dot settings | `renderer/src/components/right-sidebar/`, `renderer/src/components/settings/` | tested in the design harness with fixture data; dot settings screen in progress (UI-C) |
| Startup wiring | Install order, fail-closed installs, will-quit | `main/startup/autopilot-runtime-install.ts` and its siblings | tested over a memory database; a real app start with this wiring has not been observed |

## 3. Data model

### 3.1 Where it lives

NASH has its own application identity (D-017): user data in `%APPDATA%\nash` for packaged builds and `%APPDATA%\nash-dev` for dev runs, never Orca's folders. Orca's `orchestration.db` lives in that folder and holds Orca's tables plus the three NASH families below. [NASH operations](nash-operations.md) lists every folder.

Rules for the new tables:

- New tables only. No Orca table, CHECK list, trigger, index or `PRAGMA user_version` is changed (Orca's schema stays at version 43). Tests compare Orca's `sqlite_master` entries and `user_version` before and after.
- Each family has its own version row and an exact-SQL layout check. Any drift fails closed (`autopilot_recovery_required`, `workbench_recovery_required`, `dot_recovery_required`).
- Rows refer to Orca ids without foreign keys into Orca tables, because Orca's reset deletes Orca rows. Side rows whose Orca row is gone read as `orphaned`.

### 3.2 Orca tables reused unchanged

- `runs` and `run_coordinator_handles`: the primary session is the Run's coordinator.
- `tasks`: `spec` holds the English objective, plus `deps`, `parent_id` and `result`.
- `dispatch_contexts` (one per attempt) and `worker_dispatches` (`start_options` holds the executor and route).
- `attempt_observation_facts`: existing facets only, for example `worker_report`.
- `messages` and `deliveries`: the run mailbox. Results reach it through `insertMessage` and `notifyMessageArrived`.
- `mutation_receipts`: idempotency for the new agent-facing mutations.
- `decision_gates`: the primary's own clarifications.
- `coordinator_runs`: kept for its readers; no new rows.

### 3.3 Family `autopilot_runtime_schema` (version 1)

| Table | Purpose |
|---|---|
| `workflow_runs` | One row per run: request id (unique), workspace and binding, status (`launching, active, completing, completed, failed, canceled, unverifiable`), access, deliverable language, routing-table version and sha256 at launch, coordinator model and effort, end reason |
| `primary_sessions` | The owner record of the run's primary session: generation, launch operation, ledger (`orca` or `app_only`), handle, pane key, process incarnation, launch-token sha256, permission mode, requested model and effort, state (`starting, running, stopping, stopped, exited, unverifiable`). One live owner per run and per pane. |
| `permission_decisions` | One row per permission prompt: tool name, agent id, redacted one-line summary (at most 500 characters), request sha256, status (`pending, allowed, denied, expired, answered_in_terminal`), decider (`dot, desktop, terminal`), deadline. No column holds tool input. |
| `task_specs` | The TaskSpec of an Orca task (section 5), with `data_class = 'agent_task_spec'` and the optional review request (`review = 'model'`, D-027) |
| `task_classifications` | One row per classification attempt: outcome, blocker, `needs_delegation`, `task_type`, recorded answers, classifier version (bundle, profile and model hashes), raw-response id, spend reservation id |
| `task_routes` | The route a classification or start resolved: table version and sha256, target, model, policy level, resolved CLI setting, status (`available, unavailable, unverified, not_delegated`), reasons, availability snapshot |
| `executor_processes` | One row per Codex or agy attempt: state (`starting, running, completed, failed, blocked, stopped, stop_unknown, start_unknown`), executable evidence, run directory, process-tree verdict and method, exit code, last-message sha256 and bytes, a secret-shape flag, usage |
| `attempt_artifacts` | Artifacts of an attempt: path relative to the worktree or run directory, sha256, size |
| `task_validations` | One row per validation: policy (`machine_checks` or `model_review`; the D-027 default validation is stored as `machine_checks` with the validator `process_check` or `session_report`), checks, verdict (`pending, pass, fail, inconclusive`), worker and reviewer models (a model review requires them to differ), evidence references, waiver (`desktop_user` or `dot`, inconclusive results only) |
| `clef_classification_spend` | Links a Clef spend reservation to its run, task and attempt; carries the per-TaskSpec retry bound |
| `run_messages` | Follow-up messages to a running session (D-019): source (`dot` or `desktop`), source request id, text (at most 65,536 characters, D-027), text sha256, state (`received, held, delivered, refused`), outcome and reason |

Permission modes allowed in `primary_sessions` are `manual`, `acceptEdits` and `plan`. The store and a CHECK refuse `bypassPermissions`, `auto`, `dontAsk` and `default`.

### 3.4 Workbench family (version 3)

- `workbench_requests` is the intake receipt. Statuses: `RECEIVED, LAUNCHING, LAUNCHED, LAUNCH_BLOCKED, CANCELED`. `workflow_run_id` links one run per request. The only blocker reason is `launch_blocked`.
- `workbench_request_settings` holds requested access and deliverable language. `workbench_request_events` keeps the old event kinds and adds launch events.
- Kept byte-identical: `workbench_clef_spend` (the Clef ledger) and `workbench_clef_raw_responses`.
- Dropped by the v2 to v3 migration: the outbox, route decisions, dispatch intents and route overrides. A v2 database that still holds decision, intent or override rows fails closed and is not changed (U2).
- The shared view keeps its four statuses for the renderer: RECEIVED and LAUNCHING show as `ROUTING`, LAUNCHED as `ROUTED`, LAUNCH_BLOCKED as `ROUTING_BLOCKED`, CANCELED as `CANCELED`. The UI words them as Starting, Run started, Launch blocked and Canceled.

### 3.5 dot ingress family

- `dot_ingress_schema`, `dot_ingress_settings` (the on/off switch and the rate caps), `dot_ingress_workspaces` (workspaces the user enabled for dot), `dot_ingress_requests`, `dot_ingress_events`.
- `dot_ingress_workspace_access`: the per-workspace maximum access, created only when a workspace is raised above `read_only`.
- Request states: `received`, `submitted`, `canceled`, `failed`. A `submitted` row links its Workbench request. Events hold only a kind, ids, a revision and a time.
- The ingress-facing store never reads a path or the workspace id. Dot views never carry an objective.
- `dot_validation_ledger_schema` and `dot_validation_decisions` (G7, their own family, fail closed with `dot_recovery_required`): the first answer per `decisionId` of `dotIngress.validations.decide` (decision id, validation id, request, decision, outcome, decision time), at most 10,000 rows, oldest pruned first. A replay returns the stored answer; the same id with another validation or decision is `dot_idempotency_conflict`.

### 3.6 Files under user data

| Path | Content |
|---|---|
| `routing-table/` | `index.json`, immutable `versions/`, `proposals/`, and `availability.json` (route latches, rebuildable, not hashed) |
| `primary-sessions/<run>-g<n>.json` | The generated `--settings` file of a primary session, owner-only; kept after the run |
| `autopilot-runs/<run>/` | One run directory per Codex or agy attempt (raw output, owner-only) |
| `autopilot-reviews/` | Run directories of reviewer runs |
| `clef-verified-profile.json` | The pinned Clef response profile, written only by Pin |
| `dot-ingress-runtime.json` | The dot endpoint discovery file with the per-start token, owner-only, present only while dot is on |

### 3.7 dot remote family

- Nine objects at version 2 for the remote mailbox (R1, section 14): `dot_remote_schema`, `dot_remote_settings`, `dot_remote_pairing`, `dot_remote_requests`, `dot_remote_facets`, `dot_remote_outbox`, `dot_remote_outbox_state`, `dot_remote_items`, `dot_remote_artifact_refs`. Startup creates them when none exist and otherwise verifies them.
- Version 2 (G7) adds the two validation decision event kinds to `dot_remote_outbox` and the `validation_decision` item kind to `dot_remote_items`. A family at the exact version 1 layout (pinned by hash) is migrated in place: both tables are rebuilt under their own names with every row, and the outbox keeps its sequence high-water mark. Any other layout fails closed unchanged.
- Development databases: the pairing table gained `lifetime_ends_at` inside version 1 before it shipped (R1 follow-up). A database created by an earlier development build fails closed with `dot_remote_recovery_required`. Drop its nine `dot_remote_*` tables; the next start recreates them empty, and the computer must be paired again.

## 4. End-to-end flow

1. **Entry.**
   - Desktop: the Workbench panel calls `workbench.requests.submit`.
   - dot: `dotIngress.requests.submit` on the dot endpoint (section 13). NASH checks that dot is on, the workspace is enabled for dot, the requested access is within that workspace's maximum, the rate caps, English prose, the secret scan and quoted spans. It stores the request as `received`, calls the same intake door under principal `dot-ingress`, then marks it `submitted`. There is no desktop confirmation (D-018).
2. **Intake.** The door records `RECEIVED` with its settings and returns at once. On the next macrotask it moves the request to `LAUNCHING`, calls `startWorkflowRun`, then records `LAUNCHED` with the run id, or `LAUNCH_BLOCKED` with one detail: `coordinator_route_unavailable`, `launch_refused` or `launch_unverifiable`. A duplicate submit starts nothing.
3. **Run and primary session.** `startWorkflowRun` resolves the table's coordinator route, which must be `available`. It calls Orca's `db.createRun`, writes `workflow_runs` and `primary_sessions`, writes the settings file, and launches a visible terminal through Orca's `executeAgentLaunch` (no focus, `surfaceOwner: false`).
   - Arguments: `--model` and `--effort` from the coordinator row; `--permission-mode manual` for read_only or `acceptEdits` for workspace_write; `--settings <file>`; `--agents` with one `autopilot-<task_type>` definition (model and effort) per `claude_subagent` row.
   - The settings file disables bypass and auto modes, denies `Edit`, `Write` and `NotebookEdit` for read_only runs, allows only the five task commands, and installs the PermissionRequest hook (timeout 270 s).
   - The prompt is English framework text, the objective byte-exact inside a fence, the posture, the deliverable-language directive and the five task commands. It rides the launch command on macOS and Linux up to 8,000 UTF-16 units; a longer prompt, and every prompt on Windows, is pasted into Claude after start (D-033).
4. **TaskSpec.** The primary writes a TaskSpec (section 5) as English JSON and runs `orca orchestration task-propose --spec-file - --json`. Inside NASH terminals `orca` is an alias of the NASH CLI. The app checks the spec, writes Orca's task and the `task_specs` row in one transaction, and starts classification asynchronously. The CLI waits up to 90 s for the result.
5. **Classify and route.** Clef returns `{needs_delegation, task_type}` or a blocker (section 6). When delegation is needed, the active Routing Table is looked up and availability is re-checked (section 7). An unavailable route is recorded with its reasons and nothing is substituted. A status notice goes to the run mailbox.
6. **Start.** The primary runs `task-start --task <id>`. The route is re-checked and must be `available`. Codex and agy attempts run as app-owned child processes. Claude subagent, workflow and primary-self attempts get an English instruction and are carried out in the session (section 8).
7. **Validate.** An executor's claim moves the task to `blocked` (validation pending), never to `completed`. Validators decide (section 9). Pass completes the task through Orca's `updateTaskStatus`, which promotes dependents. Fail fails it. Inconclusive becomes a decision for the user or dot. A mailbox notice follows; the primary reads the bounded, redacted, untrusted result through `task-show`. Results are never pasted into the terminal.
8. **Complete.** The primary runs `run-complete --summary-file -`. The app requires every task to be settled (failed, or completed with a pass or a waiver), then moves the run to `completed` and stores the summary as a run-mailbox message.

Permission prompts (section 10) and follow-up messages (section 11) run alongside steps 4 to 8.

## 5. TaskSpec v1

The primary session writes the TaskSpec as JSON; names, paths and quotations go in backticks or quotes as verbatim spans (D-013). Since D-027 no check requires English prose. It reaches the app only through `--spec-file <path>` or stdin, never argv. Contract: `shared/rpc-contract/orchestration-autopilot-params.ts`.

| Field | Required | Limits | Meaning |
|---|---|---|---|
| `objective` | yes | not empty | What the task must achieve |
| `title` | no | not empty | Short label |
| `expectedOutputs` | no | items not empty | What the task produces |
| `acceptanceCriteria` | no | items not empty | How success is judged |
| `machineChecks` | no | known kinds only | Automatic checks: `executor_completed`, `artifact_exists` (`path`, `root` = `worktree` or `run_directory`), `output_schema` (Codex), `no_workspace_writes`, `secret_scan_clean` |
| `constraints` | no | items not empty | Explicit constraints |
| `accessNeed` | no | `read_only` or `workspace_write` | Access the task needs |
| `isolationNeed` | no | `none` or `worktree` | Recorded only: a writing Codex or agy task in a git workspace gets its own worktree whatever this says (D-025, section 8.6) |
| `workflowName` | no | identifier | The project workflow for `configured_project_workflow` |
| `deps` | no | task ids | Orca task dependencies |
| `parentId` | no | task id | Parent task |
| `review` | no | `model` | Asks for a second-model review after any machine checks (D-027) |

- Size (D-027): the only bound is a technical ceiling of 256 KiB for the serialized TaskSpec (`AUTOPILOT_TASK_SPEC_MAX_BYTES`, also the CLI's spec-file and stdin bound). A larger TaskSpec is refused as `autopilot_task_spec_too_large`. The product limits (objective 8,000 characters, lists of 32 items of 2,000 characters, 16 machine checks, 64 deps, title 200 characters) and the required acceptance criterion are gone.
- Refused keys anywhere in the document: target, model, effort, reasoning, thinking, profile, surface, data class and language (in their spellings). Clef classifies, the Routing Table selects and the run fixes the deliverable language.
- At proposal the app refuses, with no write, an empty text field, a title of more than one line, an unknown machine-check kind or bad parameters, and a proposal while the classifier is not installed. CRLF and a lone CR are turned into LF first, so Windows line endings are accepted. The wire contract and the store share one definition of the text and machine-check fields (`shared/rpc-contract/autopilot-task-spec-fields.ts`: at most 7 lower-case fields per check), so the store never refuses a text or a check shape that the params accepted. Since D-027 (restrictions 6 and 8) a TaskSpec text may be in any language and hold any character, credential shapes and control characters included; Clef still masks names and paths and runs its content scan before anything leaves the app (restriction 10, kept). A NUL character cannot ride a command line, so the agy runner refuses a prompt that holds one (`invalid_request`, detail `invalid_prompt`) and the attempt fails without starting agy.
- Validation follows the TaskSpec (section 9): listed machine checks run; `review: "model"` adds a model review; with neither, the default process check or session report decides (D-027). A TaskSpec without machine checks no longer gets a model review by default.
- The app assigns the data class `agent_task_spec`. Only this class reaches Clef (D-020).

## 6. Clef classification

Clef answers two questions per TaskSpec, `task_type` (10 types plus `needs_clarification`) and `needs_delegation`, and nothing else. It never sees targets, models or efforts. The outcome rules, gates, retry bound, records and the verification sequence are in the [Clef classifier spec](clef-classifier-spec-2026-10-04.md).

- With `needs_delegation=false` the primary session does the task itself; the type is recorded and no table lookup happens.
- With `true` the app looks up the Routing Table.
- Every blocker goes back to the primary as an English code. There is no fallback classifier, stale decision or rule router.
- Language (D-027): the state builder no longer checks the language of the TaskSpec, so text in any language is classified. Only a blank objective, or one with no letters, returns `needs_clarification` without a call.
- Long fields (D-027, closes F1 item 1): a field over Clef's state caps (after span masking: objective 2,000 characters, 16 list items of 500 characters) is sent as a bounded excerpt ending in ` [truncated]`, never cut inside a placeholder or a surrogate pair; a longer list keeps its first items plus `[truncated: N more items]`. If the request still exceeds the preflight budget (64 KiB body, 12,000 estimated tokens), the caps are halved, down to an eighth. Before D-027 such a TaskSpec was refused.
- Kept (restriction 10): names and paths are masked as placeholders, however many spans there are, and the content scan runs over the whole masked TaskSpec before any excerpt is taken.
- State: tested. No live Clef call has been made; the first billed Verify is gate G4.

## 7. Routing Table

### 7.1 Format, versions and proposals

- JSON parsed whole with zod. A file that fails any check is refused, never partly applied. Its identity is the canonical-JSON sha256.
- The bundled default is `main/routing-table/default-routing-table.json`. It is active from first start until the user accepts another version (U4).
- Rows are total and in taxonomy order (taxonomy version 2). A table of another taxonomy cannot activate.
- Models must be pinned ids: aliases, selectors, `latest`/`auto` and every Gemini 4 id or label are refused. Only `claude_primary` and `claude_workflow` rows may use `inherit`.
- Accepting a proposal writes `versions/v<N>.json`, then the index. A stale base marks the proposal superseded. Identical content is de-duplicated. Revert creates a new version.
- Agents and app updates may propose; only the desktop user may accept, reject or revert (Settings > Integrations > Task routing). A new bundled default arrives as a proposal, never as an overlay.
- On every read each version's hash is re-checked. A mismatch blocks routing with `routing_table_integrity_failed`; the bundled table is never used as a fallback. This detects same-user edits; it does not prevent them.
- Benchmark evidence stays out of code: rows carry source names only. URLs and the snapshot date are in [Routing Table evidence](routing-table-evidence.md).

### 7.2 Bundled default (version 1)

Coordinator: `claude-opus-5-5`, `max`.

| task_type | Target | Model | Level |
|---|---|---|---|
| `coordinator_reasoning` | `claude_primary` | inherit | inherit |
| `complex_planning_reasoning` | `claude_subagent` | `claude-opus-5-5` | max |
| `software_engineering` | `claude_subagent` | `claude-sonnet-5-5` | max |
| `scientific_experiment_validation` | `codex_cli` | `gpt-6-astra` | max |
| `complex_pdf_evidence_analysis` | `codex_cli` | `gpt-6.1-sol` | max |
| `general_research_analysis` | `codex_cli` | `gpt-6.1-sol` | max |
| `routine_analysis_batch` | `codex_cli` | `gpt-6.1-sol` | high |
| `high_quality_writing` | `claude_subagent` | `claude-opus-5-5` | high |
| `fast_writing_or_alternative_draft` | `agy_cli` | `gemini-3.8-flash-high` | high, `if_supported` |
| `configured_project_workflow` | `claude_workflow` | inherit | inherit |

Validation reviewers, in order: `codex_cli` `gpt-6.1-sol` high, then `claude_headless` `claude-opus-5-5` high.

The pins, the levels, the 10th row `coordinator_reasoning` and the reviewer order await user confirmation (D-016 open item, U3, D-017).

### 7.3 Availability

Each route gets five checks in order: CLI, model, reasoning, authentication, quota. Codex also gets a workspace check.

NASH reads usage only through each routed CLI (user instruction of 2026-10-06, refining the D-023 correction). `USAGE_METER_SOURCE = 'cli-native'` in `src/main/rate-limits/usage-meters-policy.ts` decides it; it is not a user setting. Orca's own meter code stays in the source under `'orca-inherited'` only so its tests keep running. The rate-limit service's top two layers (`service/service-cli-usage-cycles.ts`, `service/service-cli-usage-gate.ts`) keep Orca's fetch queue, debounce, failure backoff and triggers, but a cycle asks only the CLI sources in 7.3.1, and nothing that needs a stored credential runs (inactive-account previews, Codex reset credits). The published state carries only the Claude, Codex and agy readings and says `usageMetersDisabled: true` and `cliUsageReadings: true`. The status bar shows those three meters, each with the CLI feed and the time of its last reading; Settings > Accounts shows them under "Usage from the CLIs" with a Refresh usage button and keeps "Usage is not shown in NASH" for every other provider. Claude account switching is removed (user decision of 2026-10-06), so Claude usage is that of the user's own login: the status bar has no Claude switcher, Settings hides the Claude account section, and no managed Claude account is read for usage. Codex keeps its status-bar switcher, without inactive-account previews or reset credits. Account switches still notify `onAccountChange`, which invalidates cached route observations.

- `available`: every check passed. Only `available` dispatches.
- `unavailable(reasons)`: a check failed. Reasons include `cli_missing`, `cli_disabled`, `model_not_listed`, `model_excluded`, `reasoning_unsupported`, `auth_failed`, `not_entitled`, `quota_exhausted` and `workspace_not_git`.
- `unverified(reasons)`: a check could not be observed (`model_list_unavailable`, `reasoning_unverified`, `auth_unobserved`). It does not dispatch (U7). On CLI readings, `auth_unobserved` and `not_entitled` no longer occur.
- Models must match exactly the account's listing: Claude `list_models` (`id` or `resolvedModel`), Codex `model/list`, `agy models`. An empty or failed listing is unobserved, never "all allowed".
- Authentication on CLI readings: no login is read, so the check passes with the evidence `{ metered: false }` for every target, including the headless reviewer. Only a CLI-reported auth failure during a task or a review blocks it (the latch below). A usage probe's own sign-in error does not block: Codex can run on an API key that has no ChatGPT rate limits.
- Quota on CLI readings: route checks read the usage state as the CLIs left it and never refresh it (Orca's cadence stays). A fresh reading (at most 30 minutes old) from the provider's own CLI feed at or above 100% of an account window whose reset time has not passed blocks the route with `quota_exhausted` and the evidence `{ source, readingAtMs, resetsAtMs }`; the sources are `claude_status_line`, `codex_app_server` and `agy_usage`, and `resetsAtMs` is the latest reset of the used-up windows (null when one has none). A fresh reading with headroom passes as `{ observed: true, source, readingAtMs }`. A missing or stale reading, or one that did not come from the CLI, never blocks: it passes with `{ metered: false }`.
- Authentication and quota on Orca's inherited meters (not used in NASH): they rest on the usage service's readings. Claude subagent and workflow routes take their login from the run's live primary when the usage service defers its reading (D-020), and the headless reviewer needs its own reading.
- Dispatch re-checks with a catalog at most 10 minutes old. An executor-reported auth or quota failure latches that route in `availability.json`. A quota latch clears on any check once a CLI reading taken more than 60 seconds after the failure (the longest probe, so the reading began after it) shows headroom, that is, the window reset. Otherwise only a passing re-check clears a latch. On CLI readings the user's Check routes clears it once the route's own CLI answers its model listing after the failure; a fresh reading that still shows the limit used up keeps the route blocked. With Orca's meters the re-check must see a passing usage reading newer than the failure. If the CLI still fails, the next task latches the route again. A damaged latch file is quarantined and every route counts as latched until re-checked.
- Nothing is ever substituted: no other model, target or effort. A fallback exists only if the user configures one, and schema v1 has none (U8).
- The probes start `claude -p` (a turn-free `list_models` request), the Codex app-server `model/list` and `agy models`. They run on demand, never at startup. Not verified live inside the app (G3).

#### 7.3.1 Usage sources

- **Claude:** the `rate_limits` (5-hour and 7-day `used_percentage` and `resets_at`) that Claude Code passes to the status line of a NASH primary session, and only those sessions (user decision of 2026-10-06, "Primary only"). Trigger: each status-line render; it is passive and starts nothing. Only posts from the user's own login (NASH's `CLAUDE_CONFIG_DIR`, unset by default) count. NASH's other Claude terminals and the user's global `settings.json` are untouched, so they give no reading.
  - **Settings change.** The primary session's generated `--settings` file gains one `statusLine` entry and nothing else: permission mode, allow rules and the PermissionRequest hook stay as they are. Its command runs `out/cli/statusline-relay/claude-statusline-relay.js` (`src/cli/statusline-relay/`) with the node runtime NASH's other hooks use: `$ORCA_AGENT_HOOK_NODE` (set in every Windows pane), else the app binary, both run as Node with `ELECTRON_RUN_AS_NODE=1`. No `.cmd`, `.bat`, `.ps1` or PowerShell is involved.
  - **Relay.** On each render it reads the status JSON from stdin (at most 1 MB), then side by side (1) posts only `rate_limits` to the hook listener's `/statusline/claude` with Orca's gating: a pane key, no `CLAUDE_JOB_DIR`, the endpoint file read as text (never run), the hook token and the 15-second per-pane throttle; with the listener down the post is dropped within 1.5 s; and (2) runs the user's own status line with the same stdin and prints its output unchanged. A failing user command, or one slower than 5 s, prints nothing; the relay always exits 0 within 8 s.
  - **The user's status line.** Resolved at each launch, reading only the `statusLine` key, in Claude Code's documented precedence: the workspace's `.claude/settings.local.json`, its `.claude/settings.json`, then `$CLAUDE_CONFIG_DIR/settings.json` or `~/.claude/settings.json`; its `padding`, `refreshInterval` and `hideVimModeIndicator` carry over. A NASH or Orca managed status line is not chained. The command reaches the relay as one base64url argument, never as shell text, and no user file is edited. A managed `statusLine` still wins over `--settings`, and then the relay does not run. Workspace trust is unchanged: launch only reads the files, and Claude Code turns the whole status line off in a folder that is not trusted (settings reference, "Status line and file suggestion gates"), so a project's command runs only where Claude Code would have run it. Not verified: whether the trust dialog names a project status-line command once `--settings` overrides it.
  - **How it runs.** Claude Code runs a status-line command as a shell command: Git Bash on Windows, PowerShell only when Git Bash is not installed, `sh -c` elsewhere (local 2.1.289 docs: the hooks reference's shell form, `CLAUDE_CODE_SHELL_PREFIX` and `CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY` naming status-line commands, and the changelog's move of hooks from cmd.exe to Git Bash; `statusLine` has no `args` or `shell` field). The relay runs the user's command as `<bash> -c <command>` through Orca's child-process runner (`runProcess`, no `shell: true`), with the bash Claude Code would pick: `CLAUDE_CODE_GIT_BASH_PATH` when it names `bash.exe` or `sh.exe`, else Git for Windows' bash; it refuses any other program. On Windows without Git Bash no relay is added, the session keeps the user's own status line and NASH gets no Claude reading; there is no PowerShell or cmd.exe fallback.
- **Claude, other sources:** `/status` shows no usage. The hidden `claude` PTY `/usage` reader stays off: it starts an interactive `claude` that runs the user's SessionStart hooks, plugins and MCP servers, answers the folder-trust prompt itself and on Windows goes through `cmd.exe`, and quieting it needs settings not verified on Claude Code 2.1.289.
- **Codex:** `codex -c approval_policy=never -c features.plugins=false -s read-only -a never app-server`, JSON-RPC `initialize`, then `account/rateLimits/read`; an `account/rateLimits/updated` pushed meanwhile stands in when the read fails. It runs in the Codex home NASH's own Codex launches pin (`resolveStructuredAgentAccountHome('codex')`, read-only, no home sync). Triggers: the deferred start (1 s after the window attaches), window focus, show or restore once the last reading is 5 minutes old (a failure retries with backoff), the 15-minute poll while the window is focused, a manual refresh (status bar, Settings, mobile) and a Codex account switch.
- **agy:** `agy --version` (1.1.11 or newer, Orca's gate), then `agy -p /usage --output-format json --print-timeout 20s`. Same triggers as Codex, and only while the agy meter is on in the status bar; hiding the meter drops the last reading.
- **Off:** every credential read (Claude keychain and `.credentials.json`, Codex `auth.json` including its presence check, the Grok, Cursor and ZCode readers); every vendor HTTP usage call (`api.anthropic.com/api/oauth/usage`, `chatgpt.com/backend-api/wham/usage`, the reset-credit endpoints and consume); inactive-account previews and managed Claude account usage; and the providers NASH does not route to (Gemini CLI, Cursor, Grok, Kimi, OpenCode, ZCode/GLM, MiniMax).

### 7.4 Reasoning-level mapping

Policy levels are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`, and `inherit`. D-027 allows `ultra`, `none` and `minimal` (excluded by D-003 until then) wherever the CLI lists them: the Routing Table schema, the database CHECKs, the run view and the Settings effort picker accept them, and the availability checks below still decide, so a level the exact model does not list, or its launcher cannot apply, is `reasoning_unsupported`. No default uses `xhigh`, `ultra`, `none` or `minimal`. A route may mark its level `if_supported`, which is resolved once at the availability check and recorded.

| Target | How the level reaches the CLI | Check | When unsupported or unknown |
|---|---|---|---|
| `claude_primary` (coordinator) | `--effort <level>` on the session | Level in the exact model's listed efforts (Claude Code 2.1.289 lists low to max) and in the levels the session flag can carry, low to max: the flag goes through Orca's Claude launch catalog, which knows no others, so a listed `ultra`, `none` or `minimal` is still unsupported here, and the launch refuses it as `autopilot_session_model_invalid` | `reasoning_unsupported`; no effort data at all is `reasoning_unverified` |
| `claude_subagent` | `effort` field of its `autopilot-<task_type>` entry in `--agents` | Level in the exact model's listed efforts; the listing alone decides, all eight levels included (D-027) | Same. Whether Claude Code applies a subagent's effort is not verified live. |
| `claude_workflow` | Nothing is sent. `inherit` takes the coordinator's model and effort; a workflow may define its own. | Coordinator's check | Resolved values are recorded |
| `claude_headless` (reviewer) | `--effort <level>` on `claude -p` | Same as primary: the reviewer's argv check also accepts only low to max (restriction 30 is a later package) | Same as primary |
| `codex_cli` | `-c model_reasoning_effort="<level>"`, always sent explicitly, because account defaults differ | Level in the model's listed efforts and in the runner's allowed set (all eight levels since D-027) | `reasoning_unsupported`. `if_supported` does not relax Codex. |
| `agy_cli` | No `--effort` flag. The level is encoded in the model id variant (`-low`, `-medium`, `-high`, and since D-027 any of the eight level suffixes). | Variant id listed by `agy models`; recorded as `encoded_in_model_id` | A required level the id does not encode (including `max`) is `reasoning_unsupported`. With `if_supported` the run proceeds at the id's own level, recorded as `omitted_unsupported`. A bare listed id is `reasoning_unverified`. The sibling variant is never substituted. |

Haiku 4.5 has no effort control, so any Claude route on it is `reasoning_unsupported`.

### 7.5 Validation reviewers

The reviewer for a model review is the first entry whose model differs from the work model, after normalising ids (variant suffixes, dates, dots, aliases). If that reviewer is unavailable or unverified, the validation is inconclusive and the next reviewer is not tried (D-020).

## 8. Executors

### 8.1 Codex CLI

- Runs `codex exec` through `runCodexExec` on Orca's child-process pipeline. The sandbox follows the run's access level (D-025, `executor-sandbox-policy.ts`): `--sandbox read-only` for a read-only run, `--sandbox workspace-write` for a write run; full access is never mapped. A claim is refused as `sandbox_mismatch` unless the runner's applied record shows the sandbox the access level asks for.
- A write attempt in a git workspace runs with `--cd` in its own new worktree; a read-only attempt and a folder workspace run in the run's workspace (section 8.6).
- The prompt goes on stdin only. The effort is always explicit.
- The argv is built from typed, checked input (model slug, effort, sandbox, absolute paths). There is no refused-flag list and no re-check of the finished argv at the spawn site (D-027 restrictions 23 and 26).
- A folder (non-git) workspace runs Codex with `--skip-git-repo-check`, the installed CLI's own flag for running outside a git repository; the Codex reviewer does the same (D-027). The floating terminal has no directory, so it makes the route `unavailable(workspace_not_git)`.
- No fixed timeout (D-027; it was 30 minutes): a run ends when codex ends or is stopped (user stop, will-quit). A timeout configured explicitly on the executor still applies, and the reviewers keep their own 15 minutes. Output is bounded and redacted; the last message carries a secret-shape flag, and `task-show` serves it only while the file still matches its recorded hash.

### 8.2 agy CLI

- Runs through `runAgyExec`. The argv is `--print=<prompt> [--sandbox] --model <id> [--effort <level>]`, built from typed input; the builder takes `--sandbox` as an explicit true or false input (D-025). The prompt is bound to `--print=`, so a prompt that starts with a dash stays a value. There is no refused-flag list and no re-check of the finished argv (D-027 restrictions 23 and 26). Gemini 4 ids and labels, aliases and agy's own default model are still refused (model rules, kept).
- No prompt cap of its own (D-027; it was 12,000 UTF-16 units). The prompt rides argv, so the bound is the command line the OS can start, measured with the spawn pipeline's own resolution and quoting: 32,766 UTF-16 units on Windows (8,191 when an unresolved `.cmd` or `.bat` launcher goes through cmd.exe) and 128 KiB per argument on POSIX (`agy-exec-command-line.ts`). A longer prompt is refused before anything starts: the runner fails with `invalid_request` and a `prompt_too_large` detail giving the length and the ceiling; the task executor answers `prompt_too_long`.
- The answer is written owner-only to the run directory and kept up to 64 MiB (D-027; the default was 4 MiB under a 16 MiB ceiling). A run past it is stopped and fails, and validation reads the answer up to the same bound.
- No fixed timeout (D-027; it was 10 minutes, set for the unverified G8 trust-prompt behaviour). A run ends when agy ends or is stopped; an explicitly configured timeout still applies.
- The sandbox follows the run's access level (D-025). agy 1.2.16 has no read-only flag: `--sandbox` runs it "with terminal restrictions enabled". A read-only run keeps `--sandbox`; a write run drops it and adds nothing else (no `--mode accept-edits`, no `--dangerously-skip-permissions`), so agy's own print-mode permission defaults apply. A claim is refused as `sandbox_mismatch` unless the argv the runner used carried `--sandbox` exactly when the access level asks for it. A write attempt in a git workspace runs in its own new worktree (section 8.6).
- The prompt's access rule follows the run as well: a read-only attempt is told it is read-only, a write attempt that it may change files inside its working directory. Read-only stays by request only for agy: write behaviour under `--print`, with or without `--sandbox`, is not verified live (G8), and the `no_workspace_writes` check is the read-only control.
- The route no longer waits for P-01, P-03 and G8 (D-027): it is available when its ordinary availability checks pass. G8 stays a live verification gate (section 19).

### 8.3 Executables

Codex, agy and the Claude reviewer start the way a shell would start them (D-023 and its amendment). The installed launcher is found on PATH: `.exe` first, then `.cmd`, `.bat` and `.ps1`.
- A recognised npm shim runs its node entry directly.
- Any other `.cmd` or `.bat` launcher goes through Orca's process pipeline.
- A `.ps1` launcher runs under `pwsh.exe` from PATH, else Windows PowerShell, with `-NoProfile -File` and no execution-policy override.

No fingerprint or pin is checked. Just before a start, the launch target is still re-checked: an absolute local program and entry file, outside the worktree and the run directory.

### 8.4 In-session Claude targets

- `claude_subagent`, `claude_workflow`, and tasks the primary keeps (`not_delegated`, run as `claude_primary`) get an English instruction instead of a process.
- A subagent instruction names `autopilot-<task_type>` and puts `Attempt: <id>` on the first line of the Agent prompt. No model or effort is named.
- The app declares a ready worker. The primary reports with `task-report --task <id> --attempt <id> --summary-file - [--outcome succeeded|failed]`.
- The app cannot enforce a subagent's model or effort or attribute its work. These targets are evidence-level only. The user's global agent instructions may lead the primary to start other subagents outside routing; those starts are only observable.

### 8.5 Stops and restarts

- A stop whose process tree is proven `exited` settles as `stopped`. `live` or `unverifiable` records `stop_unknown`. On Windows only the root's exit is proven, so most stops there read `stop_unknown`, which is fail-closed.
- After a restart `starting` becomes `start_unknown` and `running` becomes `stop_unknown`. Nothing is retried.
- Will-quit aborts every child and refuses new starts.

### 8.6 Write runs: task worktrees, the merge rule and folder workspaces (D-025)

Where a Codex or agy attempt runs (`attempt-workspace.ts`):

| Run | Workspace | Where the attempt runs | Sandbox |
|---|---|---|---|
| `read_only` | git or folder | The run's workspace, as before | Codex `read-only`; agy `--sandbox` |
| `workspace_write` | git worktree | Its own new Orca worktree | Codex `workspace-write`; agy without `--sandbox` |
| `workspace_write` | folder | The folder itself (Codex keeps `--skip-git-repo-check`) | Codex `workspace-write`; agy without `--sandbox` |

- **Creation.** In the executor's `prepare()`, after every other launch check and before the attempt is marked running, the worktree port (`attempt-worktree-runtime.ts`) calls Orca's own `runtime.createManagedWorktree`, as an orchestration worker's `--worktree new-child` does (`worker-worktree-creation.ts`): `activate: false`, `setupDecision: 'skip'`, `runHooks: false`, no startup agent, prompt or terminal (`createdWithAgent` is `codex` or `antigravity`, which also spares the blank shell Orca opens otherwise), and `lineage.parentWorktree` = the run's worktree, so Orca lists the task worktree as its child. `lineage.orchestrationContext` is not used: Orca reads it only when no explicit parent is given.
- **Base.** The run worktree's HEAD commit, read with `git rev-parse --verify HEAD^{commit}` through Orca's git runner (no hook runs), is passed as the base; `resolveWorktreeCreateBase` takes a requested base as given, and a commit id needs no fetch. The new worktree's HEAD must equal that commit.
- **Name.** `nash-<task id>-<attempt id>`, with any character outside letters, digits, `_` and `-` folded to `-`, which git ref rules and paths accept. Orca applies the user's branch-prefix setting and, on a collision, its own suffix; the branch, path and base commit recorded are the ones Orca returns.
- **Admission.** The created worktree must pass the same catalog check as the run's workspace (`requireWorkbenchWorkspace`: a native local workspace), and its path becomes the CLI's working directory.
- **Refusal.** Any failure refuses the start, and nothing runs: `task_worktree_base_unavailable`, `task_worktree_create_failed`, `task_worktree_not_local`, `task_worktree_base_mismatch`, or `task_worktree_failed` for anything else. No error text is recorded. A worktree created before a stop or a later failure stays where it is. When prepare created the worktree but the start is then abandoned (a stop arrived, or marking the attempt running failed), the app logs the fixed code `worktree_left_behind` with the attempt id and, when the branch and path can be quoted, records them as `worktreeLeftBehind` in the never-ran settlement's verdict (the executor row's JSON `verdict` column, so no migration).
- **Records.** The executor row's launch evidence carries `attemptWorkspace` (`run_workspace`, `folder`, or `own_worktree` with the worktree id, branch, path and base commit). The transcript's `start` record names the worktree (branch, path, base commit), and the task window shows "Writes in its own worktree", or "Writes in the workspace folder" for a folder write.
- **Commit first.** Each writing task starts from the run worktree's last commit, so work the primary has not committed is not in it. The primary is told before it starts any task (the `task-start` line of its launch prompt and the `orchestration` skill guide) and again in each `task-start` reply, which names the worktree, the branch and the base commit.
- **Validation** looks where the task wrote (section 9).
- **Merge rule.** The validation notice the primary receives in the run mailbox (`attemptWorkspaceNotice` in `task-result-notice.ts`, filed by `validation-settlement.ts`) adds one bounded English line. Before a pass (or a waive, below) is filed for a task in its own worktree, git is read there through Orca's runner with optional locks off (`attempt-worktree-changes.ts`): `rev-list --count <base>..HEAD`, and `status --porcelain` with the fsmonitor hook off, in the worktree as the catalog admits it now. The line is worded from what git showed: commits and nothing uncommitted, merge that branch into your worktree in your terminal and resolve any conflict there; uncommitted changes (Codex in its workspace-write sandbox may be unable to commit, because the worktree's git directory is outside its writable roots), commit them there in your terminal first, then merge the branch; nothing at all, the worktree has no changes and there is nothing to merge; git unreadable, check in the terminal before merging, never a stated fact. Fail or inconclusive: the branch is left for inspection and nothing should be merged. A branch or path that cannot be quoted safely (a backtick, a control, bidi or line-separator character, a secret shape, over 300 characters) is replaced by a pointer to the attempt id and `git worktree list`. A folder workspace's notice says the changes are already in the folder.
- **Cleanup.** NASH never merges, removes or cleans up a task worktree. The primary merges in its visible terminal; the user or the primary removes the worktree when it is no longer needed (Orca lists it under the run's worktree, and Orca's own delete or `git worktree remove` removes it).
- **Folder workspaces.** A folder has no git, so no worktree is possible and a write attempt writes in the folder itself. Parallel writing tasks in a folder workspace are not kept apart from each other or from the primary's own edits; NASH adds no lock and no refusal for this.
- **SSH and other hosts.** Intake admits only native local workspaces (`unsupported_host` otherwise), and a created task worktree must pass the same admission, so the CLI's working directory and every validation read stay local. If Orca's create ever routed a run's repository to an SSH host, the start would be refused as `task_worktree_not_local` rather than run against a path the CLI cannot reach.
- **Not verified live:** Orca's worktree creation from an app run, Codex `workspace-write` on Windows, agy's write behaviour in print mode on Windows (G7, G8).

## 9. Validation

- **Policy (D-027, the user's choice "Process check; Claude's report").**
  - A TaskSpec with machine checks gets `machine_checks`.
  - `review: "model"` gets `model_review`: the listed machine checks run first, a failing one fails the task and bills no review, and otherwise the reviewer decides with both results recorded.
  - Neither (the default; D-017's default review is superseded): a Codex or agy attempt passes on `executor_completed` plus `secret_scan_clean` (validator `process_check`). A Claude subagent or workflow attempt passes on the primary's `succeeded` `task-report`, recorded as claim-based evidence (`session_report_claim`, validator `session_report`); a `failed` report fails the task, and a missing or mismatched one is inconclusive. A task the primary did itself (not delegated, or `claude_primary`) ends inconclusive, because D-027 relaxes restriction 27 only for subagent and workflow tasks.
  - A Codex or agy executor's own report is never enough. The store re-checks every pass (`validation-pass-sufficiency.ts`): a default pass must carry exactly those checks and, for an in-session attempt, a subagent or workflow route and the claim reference.
  - Kept: inconclusive handling (restriction 29) and the rule that a reviewer's model differs from the worker's.
- **Where validation looks (D-025).** A write attempt that ran in its own worktree is validated there: `artifact_exists` with root `worktree`, `no_workspace_writes` and the model reviewer's working directory use that worktree, resolved again through the catalog from the attempt's launch evidence. If it is gone or no longer admitted, those checks are inconclusive; validation never falls back to the run's worktree. Every other attempt uses the run's workspace. `secret_scan_clean` and every other kept check are unchanged (D-027 kept 27 and 29).
- **Machine checks (v1).**
  - `executor_completed`: inconclusive for in-session attempts.
  - `artifact_exists`: the path stays inside the root; symlinks, hard links and changing files are refused; the sha256 is recorded.
  - `output_schema`: Codex only.
  - `no_workspace_writes`: git status read with repo hooks and fsmonitor disabled; inconclusive for folder workspaces. Known limit: `git status` can still run a filter driver (for example a `clean` filter) configured in that repository's `.git/config`; an agent needs an earlier write to `.git/config` to set one, and Claude Code already prompts for that protected path. Changed files are dated at most 16 at a time.
  - `secret_scan_clean`: runs last over the result and every artifact. It is a heuristic over known credential shapes, not a guarantee that no secret is present.
- **Model review.**
  - The reviewer (section 7.5) gets the TaskSpec, then the artifact list and the redacted, bounded result, each inside its own fence with the same per-run random nonce (artifact names are worker data too), and must answer in a strict JSON schema.
  - Since D-027 (restriction 30) both reviewers run with their CLI's own default settings; the plan mode, no-tools, no-MCP, safe-mode and forced read-only settings are gone. Each starts as section 8.3 describes.
  - Codex reviewer: ephemeral, with an output schema and no `--sandbox` flag, so `codex exec` applies its documented default, read-only.
  - Claude reviewer: `claude -p --output-format json --model <id> [--effort <level>] --no-session-persistence`, in a fresh, empty run directory. The user's own Claude Code settings, hooks, plugins and MCP servers load as in any `claude -p` run; print mode cannot ask, so a tool call that would need a permission prompt is not run unless the user's settings allow it.
  - For an in-session attempt the reviewer sees the primary's `task-report` text, labelled as a claim, not proof. A missing or mismatched report is inconclusive, and no review is billed.
- **Outcomes.** Pass completes the task. Fail fails it. Inconclusive is resolved by the user or dot (waive or reject), never by the primary. Records are one bounded English line with secrets masked. For a write task the notice carries the merge rule (section 8.6).
  - **How the desktop decides.** The Workbench section "Waiting for your decision" lists each inconclusive result through `workbench.validation.listDecisions`, polled every 5 s like the run list. Each item shows the task title (or an objective excerpt), the run, the executor and model, the reason (the first undecided check's note, one masked English line), when it became inconclusive and, for a task in its own worktree, the branch, worktree path and base commit. Each item also carries `processMayRun` (the attempt's tree verdict is `live` or `unverifiable`); the desktop view only, never the dot view. Waive or Reject asks for a short confirmation, then calls `workbench.validation.decide { validationId, decision }`; with `processMayRun` the waive confirmation says a process of the attempt may still be running and the primary is told to wait until it has ended. The endpoint fixes the decider to `desktop_user`; the params cannot name one.
  - **Who may call.** Both methods require the trusted desktop caller, the same check the permission answer uses (`requireWorkbenchCaller`), before the database is opened. The primary's own `nash` CLI, an attested pane's call, a paired device or a forged caller gets `workbench_forbidden`, and no `orchestration.*` method reaches the decision service (both are tested).
  - **Effect.** Waive completes the task and records the waiver (the verdict stays inconclusive); Reject fails the validation and the task. `run-complete` counts a waived task as settled. A repeated or late decision returns the store's `autopilot_validation_conflict`; a validation still pending gets the same code, because it waits for a validator, not a decision.
  - **Notices to the primary** (`validation-decision-notice.ts`, built on `attemptWorkspaceNotice`), filed in the run mailbox and announced. The opening names the decision and who made it ("waived by the user", "waived from dot"); nothing else depends on the decider. Waive of a task in its own worktree: git is read there first and the merge line is worded from it, as for a pass (section 8.6). Waive while the attempt's tree verdict is `live` or `unverifiable`: the waive still records, but instead of any merge or keep step the notice says a process of this attempt may still be running; wait until it has ended before merging or keeping its changes (that warning survives the notice's fallback). Reject of one: the branch is left for inspection; do not merge. Folder workspace: a waive says the changes are already in the folder; a reject says they are still in the folder although the task was rejected, and to ask the user whether to keep or undo them. Read-only and in-session tasks get the opening line only. Branch and path follow the verdict notice's quoting rule.
  - **How dot decides (G7).** Contract version 3 adds `dotIngress.validations.list` and `dotIngress.validations.decide` (section 13.2), which call the same decision service with `by: 'dot'`, the origin filter `dot` and the desktop's worktree reader, so a dot waive files the same notice. dot sees only its own narrow view (title, reason code, masked summary), never the desktop view. Remotely, the tools `nash_list_validation_decisions` and `nash_decide_validation` reach these methods through the mailbox (section 14).
- **When.** After each claim and when a process attempt settles. A backlog of pending validations is swept after the first claim of a session, not at startup.
- **Not verified live:** one Codex review run and one Claude review run (G7, G9), including how a default-settings `claude -p` review behaves when the user's hooks or plugins act on it.

## 10. Permission relay

1. Claude Code runs the PermissionRequest command hook, `<cli> orchestration permission-request`, with the hook JSON on stdin. The CLI attaches the pane's attestation evidence. The caller must be the attested live primary of an open app run.
2. The CLI copies only `command`, `file_path`, `notebook_path`, `path` and `pattern` from the tool input. The summary is masked, folded to one line and cut to at most 500 code points. File contents, edit strings, URLs and permission suggestions never leave the hook process (D-017).
3. The app records a `permission_decisions` row. dot sees it through `dotIngress.decisions.list`; the desktop through `workbench.permission.list` (the Workbench polls every 3 s).
4. The CLI waits in slices of 20 s or less, up to 240 s, and exits 15 s before the 270 s hook timeout.
5. The first answer wins by compare-and-set. It prints only the documented decision JSON with `behavior` `allow` or `deny` (deny carries an English message). `updatedPermissions`, `updatedInput` and `interrupt` are never emitted. An answer counts only before the deadline and while the hook still waits; otherwise the result is `closed` and nothing is written.
6. With no answer, or on any error, the hook prints nothing and exits 0. Claude Code then shows its own dialog in the visible terminal, where the user answers. When the pane leaves the permission state without our answer, the row closes as `answered_in_terminal`.

Who may answer:

- dot sees only prompts whose summary shows exactly what will run: Bash, PowerShell, Monitor, Read, Edit, Write, NotebookEdit and Glob.
- Desktop-only by tool: Agent, Artifact, CronCreate, EnterPlanMode, EnterWorktree, Grep (its search reaches every file below the path), PushNotification, RemoteTrigger, ScheduleWakeup, SendFeedback, SendMessage, SendUserFile, ShareOnboardingGuide, Skill, WebFetch, WebSearch, Workflow, every `mcp__*` tool and any unknown tool.
- Desktop-only by content: protected paths, credential files (`.env*`, `.ssh`, `.aws`, `*.pem` and similar), NASH's own token files (`orca-runtime.json`, `dot-ingress-runtime.json`, sealed `*.enc` stores, `~/.nash`) and anything under the app's data folder, commands that run the app CLI, `orca` or `claude`, and any summary that had to be cut. Paths are checked as written and again after `..` is resolved against the working directory and trailing dots and spaces are dropped; a Windows alias form (a colon after the drive, an 8.3 short name, a device prefix) is desktop-only, and a Glob pattern is checked as a path. A Bash, PowerShell or Monitor command with quotes, `$`, backticks, globs, `\`, braces, brackets, `~`, `^`, `%` or `!` is desktop-only, because those can build or hide a name.
- Terminal only, never recorded: AskUserQuestion and ExitPlanMode.
- Access ceiling (RG7): dot may deny any prompt it sees. It may allow Bash, PowerShell, Monitor and file-edit prompts only on a `workspace_write` run; Read and Glob always. A read-only run denies Edit, Write and NotebookEdit in its settings but does not sandbox shell commands, which is why command allows stay with the desktop there.

Accepted risk (security review finding M4, kept by D-027 restriction 3): the primary session loads the user's normal Claude Code settings, including the workspace's own `.claude/settings.json` and `.claude/settings.local.json`. Allow rules there approve a tool call without a dialog, and a workspace hook can answer one itself, so that call never reaches the relay, the Workbench or dot, and RG7 does not apply to it. NASH does not launch with `--setting-sources user` or refuse such workspaces, because either would narrow the user's own Claude Code behaviour. A workspace's Claude settings are trusted as much as its code.

Not verified live (G6): that the hook runs on Windows and inherits the pane variables, that attestation exists at the first prompt, that the native dialog stays answerable while the hook waits, that Claude Code ignores a late hook decision, the real stdin shape and `agent_id` format, and that the pane status leaves `permission` after a terminal answer.

## 11. Follow-up messages (D-019)

- **Sources.** dot calls `dotIngress.requests.message` (contract v2, only for runs dot started). The desktop calls `workbench.runs.message` from the Runs section.
- **Checks.**
  - Since D-027: any language (the English check is gone) and only a technical length ceiling of 65,536 code points (`text_too_long`; the 4,000 limit is gone). The desktop field allows 131,072 UTF-16 units. dot's messages stay bounded by the dot v2 contract (4,000 characters), because changing that wire bound re-pins the remote manifest and needs a Site redeploy.
  - Since D-027 (restriction 35) nothing is refused for its characters or for holding a credential shape. Terminal controls are neutralised instead, because one paste frame carries the message and `ESC [201~` or a C1 CSI would end it early: every C0 control except newline and tab becomes its visible Control Pictures symbol (ESC shows as ␛), DEL becomes ␡, C1 controls and lone surrogates become U+FFFD, and CRLF or a lone CR becomes LF (`run-message-text-checks.ts`). Bidi controls and line or paragraph separators are kept. The stored and typed text is the neutralised one; the idempotency hash is taken over the text as sent.
  - dot's wire enums still list `control_characters` and `secret_shaped`, so older records and older clients keep working; the app no longer produces them.
  - The run must be active, belong to the source, and have a live primary.
  - A repeated request id returns the first outcome; the same id with different text is refused.
- **Storage.** The message is stored in `run_messages` with the run. The run mailbox stays for task results.
- **Delivery.** Through Orca's `sendTerminalAgentPrompt`: one paste frame, Enter only when the agent can accept input.
  - Idle agent: `delivered`.
  - Busy or unknown: `queued` (`agent_busy`).
  - A permission or question dialog is open: held, then flushed in order by a 2 s timer once the dialog closes. Since D-027 there is no cap on held messages and no 30-minute hold: a held message waits until the dialog closes, and is refused only when the run ends or the primary is gone.
- **Unconfirmed delivery.** A paste that may sit in the composer without Enter is refused as `delivery_incomplete` and never retyped. A message in flight during a crash is refused at startup as `delivery_unconfirmed`.
- **Not verified live (G5).** Whether Claude Code applies a queued message at its next step or after the current turn, and whether its question dialog shows as the permission state.

## 12. Single-authority guards

Inside an app run (a run with a `workflow_runs` row):

- `task-update --status completed` is refused without a passing validation. `dispatched` is refused with a hint to use `task-start`.
- `worker-start` and `dispatch` are refused with the same hint.
- The primary's pane cannot `run-create` or `run-use` another run, and no other pane can `run-use` an app run.
- Reset is refused while any app run is launching, active, completing or unverifiable.
- `worker-stop` on a Codex or agy attempt goes to the executor stop port.
- Orca's legacy worker-report settlement is refused for app attempts.
- Task worktrees (D-025): only an executor's `prepare()` creates one, for a write attempt in a git workspace. NASH never merges, removes or cleans one up; the primary merges a passed task's branch in its terminal, and the user or the primary removes the worktree.

Runs without a `workflow_runs` row behave exactly as in Orca. Orca's coordinator loop is retired: `orchestration.run` and `orchestration.runStop` stay registered and return `orchestration_migration_required` with no effect.

## 13. dot interface

### 13.1 Local endpoint

- An opt-in second endpoint, `<main endpoint>-dot` (a named pipe on Windows). It exists only while the dot switch is on, which is off by default.
- Its own token, new on every start, compared in constant time. The discovery file `dot-ingress-runtime.json` is owner-only and removed on stop.
- Its own dispatcher serves only the `dotIngress.*` methods. Every other RPC name answers `method_not_found`, and each token is refused on the other endpoint.
- Responses pass a sanitizer: only contract `dot_*` codes and fixed transport codes go out, and any other failure becomes `internal_error` with a fixed English message.
- Local client: the hidden `dot` CLI commands `hello`, `workspaces`, `submit`, `status`, `list`, `cancel`, `message`, `decisions`, `decide`, `validations` and `validation-decide` (contract version 3). Text comes from a file or stdin, never the command line; `validation-decide` takes only ids and `--answer waive|reject`, and prints the decision id to reuse for a retry.
- Desktop control: `workbench.dotIngress.settings.get`, `.settings.setEnabled`, `.settings.setRateLimits`, `.workspaces.enable` (with a maximum access, default `read_only`), `.workspaces.disable` and `.requests.list`. Desktop caller only.

### 13.2 Contract versions

| | v1 | v2 | v3 (G7) |
|---|---|---|---|
| Methods | `hello`, `workspaces.list`, `requests.submit`, `requests.status`, `requests.list`, `requests.cancel`, `decisions.list`, `decisions.answer` | v1 plus `requests.message` | v2 plus `validations.list`, `validations.decide` |
| Golden schema | `shared/dot-ingress/dot-ingress-contract-v1.schema.json` (byte-frozen) | `shared/dot-ingress/dot-ingress-contract-v2.schema.json` (byte-frozen, includes the error list) | `shared/dot-ingress/dot-ingress-contract-v3.schema.json` (byte-frozen, sha256 `531a90a8…510132`) |
| Decision outcomes | decided, already decided, not found | adds `closed` | same; a validation decision is `decided`, `already_decided` or `closed` |
| Error codes | 18 codes | adds `dot_access_above_maximum`, `dot_decision_deny_only`, `dot_request_busy`; a v1 caller gets the nearest v1 code | adds `dot_validation_not_found`; a v1 or v2 caller gets `dot_request_not_found` |
| Run view | coarse: `not_started, launching, active, completing, completed, failed, canceled, blocked, unverifiable` | same, plus access views | same |

- `hello` lists exactly the registered methods of the version asked for and the current caps, and states that tasks start without confirmation. A client finds v2 or v3 by calling `hello` with that `contractVersion`. Only v3 lists the validation methods, `maxValidationTitleChars` (200), `maxValidationSummaryChars` (500) and the capability `validationDecisions: true`; a v1 or v2 call of a validation method gets `dot_unsupported_contract_version`.
- No version carries progress, validation results, deliverables or artifact paths. dot gets the coarse run state only (U32), with one narrow exception in v3 that the user chose ("Title, reason, summary").
- **Validation decisions (v3).** `validations.list { dotRequestId?, limit }` returns the waiting decisions of runs dot started, oldest first, with `hasMore`. Each view has exactly `validationId`, `dotRequestId`, `title` (task title or the objective's first line, at most 200 code points), `reason` (`claim_only`, `primary_did_task`, `report_missing`, `review_unavailable`, `review_inconclusive`, `checks_inconclusive`, `other`), `summary` (at most 500 code points, or null), `summaryWithheld` and `createdAt`. Masking runs on the desktop before anything leaves main: the shared display rule (`display-control-characters.ts`) turns controls, bidi embeddings and isolates and line separators into spaces; Clef span masking hides quoted names and paths; every other token with a slash or backslash becomes `[path]`; e-mail addresses and long hex ids are replaced; NASH's credential masking and one-line folding follow; a line Clef's scan or the credential check still flags is withheld (`summaryWithheld: true`), and a title that is withheld becomes `Untitled task`. The worktree, branch, path, base commit, model and process state of the desktop view never reach dot.
- `validations.decide { decisionId, validationId, decision: waive|reject }` answers `{ decisionId, validationId, dotRequestId, outcome, decidedAt, duplicate }`. `decisionId` is dot's idempotency key, kept in the ledger (section 3.5): a replay returns the first answer with `duplicate: true`. `already_decided` means the desktop or another dot decision won first; `closed` means nothing waits any more (no decision time). An unknown validation, one still pending a validator, or one of a run dot did not start is `dot_validation_not_found`.

### 13.3 Rails

These are defaults the user can change:

- dot may target only workspaces the user enabled for dot.
- 6 submissions per sliding minute and 100 per UTC day.
- Requested access defaults to `read_only` and cannot exceed the workspace's maximum, which defaults to `read_only`.
- dot may cancel, message and answer only for runs it started, and list, waive or reject only their validation decisions.
- Validation decisions count against the same per-minute and per-UTC-day caps, counted over the decisions dot recorded (`dot_rate_limited` with `window`).
- After a restart, a request NASH had not yet accepted is admitted again against the current switch, workspace and maximum. If refused, it ends `failed` and never starts later. Recovered requests are then recorded as `LAUNCH_BLOCKED` (`launch_refused`) instead of launched, because no CLI starts during startup. Whether that matches D-018 is open.

Not verified live: no dot client has called the endpoint, and dot itself cannot reach a local pipe. dot reaches NASH through the remote mailbox (section 14).

## 14. Remote mailbox for dot (planned)

**Status: planned. Nothing is deployed, paired or polling.** Design: [remote MCP plan](dot-mcp-remote-plan.md), revision 3, with the [review](dot-mcp-remote-review-2026-10-05.md), the [H1 hosting check](dot-mcp-hosting-h1-2026-10-05.md) and the [local scaffold](dot-mcp-local-scaffold-2026-10-05.md).

- **Shape (D-021).**
  - dot calls MCP tools on a GPT Site; Sites manages the MCP connection and OAuth.
  - Writes become inbox items. A NASH sync agent polls over HTTPS: short polling every 5 s while work is active and every 30 s when idle, until a 25 s hold is proven.
  - The agent hands each item to the local dot endpoint and posts allowlisted events back.
  - The PC opens no inbound port.
  - NASH stays the single authority, and every item passes NASH's own checks again.
- **Built so far.**
  - R2: generated contract files in `shared/dot-remote/`: a manifest of MCP tools, envelope schemas, endpoint table and conformance vectors. Tested as schemas. Since G7 the remote contract is version 3, generated against the v3 golden: 12 tools, 13 routes (unchanged), 37 vectors, manifest sha256 `94bbd6fc2964a3a8ef79fb4000dfafd3d14a8d5567f5d6f20269fc223bad4c19` (v2 was 10 tools, 29 vectors, `fbfc682d…516db`).
- **Validation decisions (G7, contract v3; Site part not deployed yet).**
  - Tools: `nash_list_validation_decisions` (read, from events) and `nash_decide_validation` (write, inbox kind `validation_decision`, deduplicated on `decisionId`, mapped to `dotIngress.validations.decide`). `nash_status` also shows `manifestSha256`, the manifest the Site serves; it names no owner or device and creates nothing.
  - Events: `validation_decision_pending` carries exactly the v3 view (section 13.2) on its own request; `validation_decision_settled` carries `validationId`, `outcome` (`waived`, `rejected` or `closed`) and `decidedAt`. Facet `validation_decision:<id>` per decision; a request is followed until no decision of its run waits.
  - NASH reports at most 50 open decisions per binding at a time (`validationDecisionsOpenMax`), oldest first, among the requests it follows; a reported one that stops waiting is reported as settled.
  - Acks: `decided`, `already_decided` and `closed` are acknowledged as accepted (a replay NASH answered before as duplicate); `dot_validation_not_found` refuses the item with the request of its submit. The settled event says which decision won.
  - The hosted behaviour (open set, pagination, capacity, expiry, idempotency order, unknown requests) is the manifest rule `validationDecisions`. A decide item expires `submitTtlMinutes` after the call; a pending decision has no deadline and stops being listed `retentionDays` after its event.
  - The remote family migrates from version 1 to 2 in place (section 3.7).
  - Codex's local scaffold `sites/nash-dot-mcp/`, which serves only `nash_status`.
- **Not built (at the time of writing).**
  - R1, the sync agent with `workbench.dotRemote.*` and `dot_remote_*` tables (in progress).
  - UI-7, the remote switch, pairing and revoke.
  - Owner-approved pairing and durable platform service access.
  - Any Site.
- **Defaults awaiting the user** (`shared/dot-remote/dot-remote-defaults.ts`): no deliverable contents sent, remote submissions capped at `read_only`, submission TTL 30 minutes, retention 7 days, remote permission answers allowed under RG7.
- **Gates.** Review gates RG1 to RG9 in the plan, then the joint live gate G-remote.

## 15. Clef spend: no budget cap (D-022)

- The app sets no Clef spend limit and shows no cost warning: no US$5 verification budget, no daily neuron cap, no daily classification cap, no refusal when a cap is unset, and no cost confirmation before Verify.
- The spend ledger (`workbench_clef_spend`) still records every billed call: reserved before the call, settled after it. Startup recovery closes reservations a crash left open, as spent.
- The only refusal kept is a retry bound: at most 2 billed attempts per TaskSpec (`request_attempts_exhausted`).
- Testing rule, for development and not the product: live Clef calls made while building and testing NASH stay within the Cloudflare free tier plus US$5 in total. People running tests keep this rule; the app does not enforce it.
- Package K1 removes the remaining caps and the cost confirmation from the backend and Settings; it was in progress while this document was written. In the current source the ledger already sets no limit and the configuration gate no longer checks caps.

## 16. Language boundary (D-013)

- The app's own text is English: Clef questions, routing records, handoffs, status and validation records. TaskSpecs and follow-up messages may be in any language (D-027); Clef classifies a TaskSpec from its masked text, sending an over-long field as a marked excerpt.
- Names, paths and quotations travel as verbatim spans. They are masked for Clef and passed unchanged to executors.
- The deliverable language (a BCP 47 tag) travels with the run and the handoffs. It never reaches Clef, and no check rejects a deliverable for its language.

## 17. Startup and shutdown

- **Install order.** `autopilot-runtime-install.ts` installs 15 steps in this order: workbench schema, autopilot schema, dot schema, Clef administration, routing table, classifier, primary sessions, execution, validation, permission relay, task API, run launches, launch reconcile, dot intake recovery, dot ingress.
- **Fail closed.** Each step fails closed after 10 s and leaves its dependents uninstalled; they then refuse with their documented `unavailable` codes. Run launches stay behind a gate that opens only when the primary sessions, the relay and the task API are installed.
- **Recovery.** Every recovery runs before its runtime is published, and none relaunches anything. Startup makes no CLI spawn, network call or credential read (tested with the production builders).
- **Managed status hooks: Claude Code only** (user decision of 2026-10-06). Orca's startup reconciliation (`src/main/startup/startup-managed-hooks.ts`) installs NASH's managed status hooks only into Claude Code's global settings, which the agent-status store needs for the busy, idle and permission-prompt states. One constant holds the scope, `NASH_MANAGED_HOOK_AGENTS = ['claude']` in `src/main/agent-hooks/nash-managed-hook-scope.ts`; it is not a user setting, and the Agent status hooks switch can still turn Claude's off. Codex, agy, Gemini, Cursor, OpenClaude and every other CLI get no hooks: not at startup, not from the Settings switch or the `agent-hooks` CLI command, and not when a Codex terminal launches (its real-home and runtime-home installs take the hooks-off path); no other CLI is even probed. Orca's removal still runs for every agent, so a config an earlier build wrote can be cleaned, and existing NASH hook scripts are still refreshed in place. The Claude install runs `claude --version` once to choose the events that version accepts. It writes no `statusLine` into the global settings and only removes one an earlier NASH build wrote (7.3.1). Windows note: each Claude hook event runs NASH's `~/.nash/agent-hooks/claude-hook.cmd`, so Claude Code's Git Bash starts it through `cmd.exe`; when the profile path cannot be passed bare, an encoded PowerShell launcher starts it instead. Either is a script start per event that antivirus may flag on first launch. SSH hosts and WSL distros follow the same scope: their guest detection probes only Claude Code and installs only its hooks (`managed-hook-detection-commands.ts`), and the WSL Codex pane preparation (`agentHooks.prepareCodexForWslPane`) installs nothing. Not changed: OpenCode's status plugin, which lives in a NASH-owned per-pane config overlay rather than in OpenCode's global config.
- **Will-quit.** Inside Orca's 20 s teardown barrier:
  1. Close the launch gate, unregister the task API, and abort classification, validation, executors and Clef calls.
  2. Settle pending launches, switch the dot reader off, and wait up to 15 s.
  3. Dispose the primary sessions and uninstall the rest.
  The database stays open throughout.
- **Not wired.** Account-change invalidation of cached listings (no such event exists) and the optional `afterRunCompleted` and primary-status hooks.

### 17.1 Orca cloud services are off

User decision of 2026-10-05: a NASH build sends nothing to Orca's services. One switch holds this: `ORCA_CLOUD_SERVICES_ENABLED = false` in `src/shared/orca-cloud-services.ts`, next to the app identity. It is not a user setting. Five paths that a packaged build could still reach are off (tested, no request made):

1. **Send Feedback and the crash dialog's Send.** `submitFeedback` (`src/main/ipc/feedback.ts`) refuses both lanes with code `orca_cloud_services_off` before any request to `www.onorca.dev/v1/feedback`. The Help menu has no Send Feedback item. The crash dialog has no Send or attach-logs control and offers Copy Details only. Crashpad stays local (`uploadToServer: false`).
2. **Orca Cloud sign-in.** `getOrcaCloudAuthConfig` (`src/main/orca-profiles/profile-cloud-auth-config.ts`) has no packaged `login.onorca.dev` default, so sign-in, artifact publishing and skill publishing report "not available in NASH builds". The desktop relay to `relay.onorca.dev` is not created (`getDesktopRelayAuthConfig` returns null). Settings > Orca Cloud Account says that sign-in is not available.
3. **Shared skills from links.** `resolveArtifactCloudApiUrl` (`src/main/artifacts/artifact-cloud-config.ts`) has no `share.onorca.dev` default. Opening a `nash://skills/share/<id>` or `app.orca.dev` link answers `unconfigured` with a clear message, before any request to `share.onorca.dev` or `storage.googleapis.com` (`src/main/skills/skill-cloud-service.ts`).
4. **Plugin safety list and official marketplace.** Startup and the plugins toggle (`src/main/startup/main-process-plugins.ts`) neither fetch `onorca.dev/plugins/kill-list.json` nor clone `github.com/stablyai/orca-plugins`. Local plugin discovery, the cached safety list, bundled plugins and marketplaces the user adds still work.
5. **Orca Mobile push gateway.** `resolvePushGatewayOrigin` (`src/main/runtime/push/push-gateway-origin.ts`) returns null, so neither `startDesktopPushService` nor orcad starts push, and no notification text reaches `push.onorca.dev`. The pairing screens say Orca Relay and mobile push are not available. LAN pairing is unchanged.

An explicit endpoint override still reaches that one service: `ORCA_CLOUD_API_URL` with `ORCA_CLOUD_CLIENT_ID` (plus `ORCA_RELAY_URL` for the relay), `ORCA_ARTIFACTS_API_URL`, or `ORCA_PUSH_GATEWAY_URL`. Turning a path back on means setting the switch to `true`, which restores Orca's defaults.

### 17.2 Claude runs on the user's own login

User decision of 2026-10-06: "Allow account switching for other CLIs, such as Codex and agy, but remove the account switching feature for the Claude Code CLI". Every Claude Code launch runs on the user's own login. This covers terminal panes, structured sessions (including primary sessions and executors), model-catalog probes and usage fetches. The login is `~/.claude` or an inherited `CLAUDE_CONFIG_DIR`; inside a WSL distro it is that distro's `~/.claude`. `ClaudeRuntimeAuthService` (`src/main/claude-accounts/runtime-auth-service.ts`) only resolves that directory. On the host it sets `stripAuthEnv: false`, so the user's own `ANTHROPIC_*` variables pass through. The WSL branch is unchanged.

- **No credential writes.** NASH never writes Claude credentials, `oauthAccount` or Keychain items. It never renews a Claude token, and no code calls `platform.claude.com/v1/oauth/token`. `keychain.ts` keeps only its read functions.
- **Removed.** Managed Claude accounts and their login capture, OAuth refresh and credential sync. Also removed: the live-PTY switch gate, the switch guards on terminal and structured launches, the inactive-account usage previews, the Settings Claude accounts section, the Claude part of the status-bar switcher, the feature-wall Claude card and `orca account add --agent claude`.
- **Saved settings.** `claudeManagedAccounts`, `activeClaudeManagedAccountId` and `activeClaudeManagedAccountIdsByRuntime` are dropped on load with a count-only warning. No file under `~/.claude` or the old managed-account folders is changed or deleted.
- **Wire.** The account snapshot keeps an empty `claude` roster, and `rateLimits.inactiveClaudeAccounts` stays `[]`. `accounts.selectClaude(null)` is a no-op. The other Claude account calls fail with `claude_accounts_removed`. `orca account add` defaults to Codex and refuses `--agent claude` with a pointer to `claude /login`.
- **Unchanged.** Codex, agy (Antigravity), OpenCode and Devin account switching, and the Claude status-line usage feed.

## 18. Improvement systems (deferred)

The core path works without any of these, and none is a dependency. Any future self-improvement mechanism changes local workflow assets or routing policy, never vendor model weights.

- **GEPA:** a research candidate, not a dependency. Adopt it only if its candidate search measurably improves skills, task handoff templates, routing-table proposals, workflow configuration or evaluation-driven prompts, and only if the existing architecture cannot do the same more simply.
- **Recuris:** a research candidate, not a dependency. Ideas worth evaluating are verified working state, reusable experience cards, context-dependent experience retrieval and checking claimed progress against evidence. It must not add a second task database or orchestration engine.
- **Dream-RSI:** a documented extension point only; no code exists (U35).

```text
DreamRSIIntegration
status: deferred
reason: upstream code unavailable
possible future role: exploration branches, parallel attempts, continue/stop decisions, search budgets
```

Revisit it when the official code and reproduction scripts are released.

Existing seams such systems could use later, without new authority: Routing Table proposals (agents may propose, only the user accepts), validation records, and the run mailbox.

## 19. Verification status and live gates

What is tested:

- Every package's tests pass with injected fakes, apart from known baseline failures recorded per package.
- The 64 test files that fail outside the d016 baseline (Orca's agent-session, structured-session, Codex and WSL suites on this Windows host) are listed with their cause class in `f1-preexisting-failures.md`, in the session scratchpad with a copy in `autopilot-archive/2026-10-05/f1-cleanup/a/`.
- tsc passes on the node, web and CLI configs.
- Startup makes no spawn, network call or credential read.
- The UI renders every state in the design harness from fixtures.

What is not verified live is listed per component above. Gates, in order:

| Gate | Content | State |
|---|---|---|
| G0 | Package exit checks and hygiene tests | Done per package report |
| G1 | Security and TypeScript review, adversarial pass on the guards (F1) | Not done |
| G2 | Read-only CLI probes (versions, help, model listings) | Done 2026-10-04 at listing level |
| G3 | Run availability on real listings; confirm pins and effort mapping | Not done |
| G4 | First billed Clef Verify on bundle v2, then Pin | Not done |
| G5 | Primary launch on a scratch workspace: settings locks, `--agents`, posture, D-019 delivery | Not done |
| G6 | Permission relay live: hook, dot answer, desktop answer, terminal answer | Not done |
| G7 | Codex read-only smoke, a Codex `workspace-write` task in its own worktree, and a Codex review run | Not done |
| G8 | agy smoke, after P-01 and P-03 | Not done |
| G9 | End-to-end synthetic run from the dot local client to `run-complete` | Not done |
| G-remote | One live pass per remote tool through a private test Site | Not done; R1 and UI-7 not built |

What each gate needs from the user is in [NASH operations](nash-operations.md).

## 20. Open decisions

- **Clef bundle.** Classifier thresholds and the 13 answer texts, before the first billed Verify (D-020). Whether Verify should be blocked until they are confirmed: today the UI only warns.
- **Routing Table.** Model pins and effort levels (D-016 open item, U3), the `coordinator_reasoning` row, the reviewer order, and the source names on rows.
- **Codex and agy write access.** Decided as D-025 (a worktree per writing task) and approved by the user on 2026-10-06 together with the other boundary parts of D-027; applied in sections 8.1, 8.2 and 8.6 (package G3-D). Open: whether a waived inconclusive write task should also get a merge notice (no production waiver path files one yet), and what agy does with writes in print mode without `--sandbox` (G8).
- **Primary session permission modes (D-027 items 1-3).** Not applied: making `bypassPermissions` reachable needs `--allow-dangerously-skip-permissions`, which the auto-mode check refused. Claude Code 2.1.289 has no `default` mode.
- **Coordinator and reviewer efforts.** `ultra`, `none` and `minimal` stay unavailable for the coordinator (Orca's shared Claude launch catalog knows low to max, and widening it changes Orca's own effort picker) and for the Claude reviewer (part of restriction 30).
- **dot message bound.** dot's own message bound stays at 4,000 characters; raising it needs a contract change, a re-pinned remote manifest and a Site redeploy.
- **dot intake.**
  - Recovered dot requests at startup are blocked, not launched; this needs a decision under D-018.
  - Whether switching dot off should also cancel dot's active runs.
- **Runs.**
  - A force-end path for a run whose primary cannot be verified.
  - The primary has no command to give up a task.
  - A task the primary keeps (`not_delegated`) with no checks and no review request ends inconclusive, because D-027 relaxes restriction 27 only for subagent and workflow tasks.
- **agy.** With `if_supported`, a `max` level proceeds at the variant's own level; the alternative is to block it.
- **Remote.** The decisions in section 10 of the remote plan, and the R2 defaults (section 14).
- **Windows PowerShell 5.1.** It drops embedded quotes in the `--agents` JSON, so such a launch fails visibly. This needs a live check (G5).

## 21. Key source locations

All under `desktop/orca/src/`:

- `shared/routing-table/routing-table-schema.ts`, `main/routing-table/default-routing-table.json`, `main/routing-table/route-resolver.ts`, `main/routing-table/availability/route-effort-mapping.ts`
- `main/clef/clef-question-set.ts`, `main/clef/clef-classification-rules.ts`, `main/clef/clef-spend-ledger.ts`, `main/runtime/task-classification/task-classifier.ts`
- `main/runtime/orchestration/db/autopilot-run-schema-definition.ts`, `autopilot-task-schema-definition.ts`, `autopilot-message-schema-definition.ts`
- `main/runtime/workflow-run/workflow-run-service.ts`, `primary-session-launcher.ts`, `primary-session-settings-file.ts`, `app-run-policy.ts`, `run-message-delivery.ts`
- `main/runtime/task-execution/task-start-service.ts`, `main/runtime/task-validation/validation-runner.ts`, `main/runtime/permission-relay/permission-request-service.ts`
- `main/runtime/task-execution/executor-sandbox-policy.ts`, `attempt-workspace.ts`, `attempt-worktree.ts`, `attempt-worktree-runtime.ts`, `task-result-notice.ts` (D-025)
- `shared/rpc-contract/orchestration-autopilot-params.ts`, `shared/dot-ingress/`, `shared/dot-remote/`
- `main/startup/autopilot-runtime-install.ts`, `main/startup/autopilot-runtime-shutdown.ts`
