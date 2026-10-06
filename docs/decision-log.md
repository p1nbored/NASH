# Decision Log

## D-033 On Windows the primary session's prompt is pasted after Claude starts

- Date: 2026-10-06.
- Status: ACCEPTED. A "hi" sent from dot never reached Claude: PowerShell reported a ParserError at `<task_id>` and no Claude session started. Asked whether to fix it and rebuild, the user answered "ok".
- Cause: NASH typed `claude <args> '<prompt>'` into the pane's PowerShell. The prompt always spans several lines, and Orca wraps a multi-line startup command in bracketed paste only for bash, zsh and fish. PSReadLine read each line break as Ctrl+Enter (insert line above), so the lines arrived in reverse order, the quotes no longer paired and parsing failed. Because PowerShell parses all input before running any, nothing ran. Reproduced against pwsh 7.6 in a 120x40 ConPTY with the same first error (line 6, column 45).
- Decision: on Windows the prompt never rides the launch command. Claude starts with its arguments only, a single line, and the prompt goes through the existing after-start path (a bracketed paste into Claude's own input once it is ready, within 60 s). macOS and Linux keep the launch argument up to 8,000 UTF-16 units. A prompt that cannot be delivered still stops the pane and fails the run; a run is never active without its prompt.
- Known limit: a Windows launch now waits for Claude's input to be ready, so a first-run trust prompt in a folder Claude has not seen fails the launch as `launch_prompt_undelivered`.
- Open: the Windows PowerShell startup path normally passes commands up to 6,000 characters in `-EncodedCommand`, which this 4,212-character launch should have used. Why it was typed instead is not yet known.
- Implementation: done (2026-10-06; `primary-session-prompt.ts`, architecture section 3 step 3). Typed into real pwsh, the new launch line parses cleanly and an .exe receives all ten arguments unchanged. Not yet verified in a live run from dot.

---

## D-032 NASH installs status hooks for Claude Code only; primary sessions relay the Claude status line

- Date: 2026-10-06.
- Status: ACCEPTED. Asked which CLIs NASH should install its managed status hooks for, the user chose "Claude Code only"; asked which Claude sessions should report usage to NASH, the user chose "Primary only".
- Hooks: NASH installs Orca's managed agent-status hooks only for Claude Code (`NASH_MANAGED_HOOK_AGENTS`, not a user setting). No other CLI is probed or configured, on this machine, on SSH hosts or in WSL distros, so Codex panes get no status hooks. Hooks an earlier build wrote for other CLIs stay until removed, and removal still works for every CLI. OpenCode's status plugin, which lives in NASH's own per-pane config folder, is unchanged. On Windows the Claude hooks run Orca's `claude-hook.cmd` through cmd.exe from Git Bash, or Orca's PowerShell launcher when the profile path is not cmd-safe.
- Status line: the primary session's generated `--settings` file gets one more key, a `statusLine` command that runs NASH's relay as Node. The relay gives the user's own status-line command (read at launch from the workspace or user Claude settings, never written) the same input and prints its output unchanged, and posts only `rate_limits` to NASH's local hook server. Without Git Bash on Windows no relay is added and the session keeps the user's own status line. NASH writes no global `statusLine`; where an earlier build wrote Orca's managed one into an empty slot, NASH removes it, and a status line the user set is never touched.
- Implementation: done (package G8, 2026-10-06; architecture sections 7.3.1 and 17). Not verified in a live session.

---

## D-031 Inconclusive validations can be waived or rejected from the Workbench and from dot

- Date: 2026-10-06.
- Status: ACCEPTED. After D-025 was built, no production path could settle an inconclusive validation, so the Workbench got one. The user then: "Add this capability to dot and prepare the handover documentation; I will have Codex handle the redeployment". Asked what dot may see of each pending decision, the user chose "Title, reason, summary".
- Desktop: `workbench.validation.listDecisions` and `workbench.validation.decide` (waive or reject) sit behind the same Workbench caller check as permission answers; the primary's `nash` CLI cannot reach them. Waiving a write task (D-025) files the merge notice to the primary after NASH reads the task worktree's git state; waiving while the task's process may still be running tells the primary to wait instead of merging.
- dot: listing and deciding through the remote MCP server (D-021) in dot contract v3. What dot sees per pending decision is a narrow exception to U32 (architecture section 13.2) and applies to pending validation decisions only.
- Who deploys: NASH builds the desktop side; the user's Codex builds the Site side and redeploys it (docs/dot-validation-decisions-handover-2026-10-06.md). NASH never deploys.
- Implementation: desktop done (packages G6 and G9, 2026-10-06). dot desktop side done (package G7-A, 2026-10-06): local methods `dotIngress.validations.list` and `dotIngress.validations.decide`; remote tools `nash_list_validation_decisions` and `nash_decide_validation`; events `validation_decision_pending` and `validation_decision_settled`; `nash_status` reports the served manifest hash. Both use the Workbench's decision service with `by: 'dot'`. Site side and redeploy: next, by the user's Codex. A heartbeat from the other contract version is refused, so dot shows NASH offline until the Site and NASH both run v3. Not verified live.

---

## D-030 Claude Code account switching is removed; Codex and agy keep theirs

- Date: 2026-10-06.
- Status: ACCEPTED. The user: "Allow account switching for other CLIs, such as Codex and agy, but remove the account switching feature for the Claude Code CLI", and on whether any managed Claude account existed: "I haven't added any".
- Every Claude launch uses the user's own login: `~/.claude`, an inherited `CLAUDE_CONFIG_DIR`, or the distro's `~/.claude` inside WSL. NASH writes no Claude credentials, account record or Keychain item, and renews no token.
- Wire compatibility: the RPC methods stay. The Claude roster is empty; selecting, adding or removing a Claude account fails with `claude_accounts_removed`. `orca account add --agent claude` tells the user to sign in with `claude /login` in their own terminal. Saved managed-account settings are ignored with one count-only log line; no file is changed or deleted.
- Unchanged: Codex, agy, OpenCode and Devin account switching.
- Implementation: done (package G5, 2026-10-06; architecture section 17.2); removed code archived under autopilot-archive/2026-10-06/g5-claude-account-switching/. Not verified live.

---

## D-029 Usage readings come only from the CLIs themselves

- Date: 2026-10-06.
- Status: ACCEPTED. Resolves the D-023 correction. The user approved turning Orca's usage meters off ("Except for 2, all can be executed"), then: "Use the `/status` command to retrieve quota information, including Claude, Codex, and agy, so that usage information can be obtained."
- Sources: Claude Code's `/status` shows no usage, so NASH reads Claude from the `rate_limits` Claude Code passes to its status line (D-032). Codex: `codex app-server`, JSON-RPC `account/rateLimits/read`. agy: `agy -p /usage --output-format json`. The hidden Claude `/usage` terminal stays off.
- Off: every credential read and every direct vendor usage call of Orca's meters (for example `api.anthropic.com/api/oauth/usage`, `chatgpt.com/backend-api/wham/usage` and the Codex reset-credit endpoints), inactive-account previews, and the meters of providers NASH does not route to.
- Routes: a fresh CLI reading (at most 30 minutes old) that shows a used-up window blocks the route with `quota_exhausted`; otherwise a route blocks only on a sign-in or usage-limit failure its CLI reports. Route checks never start a usage probe.
- Implementation: done (packages G1 and G4, 2026-10-06; `USAGE_METER_SOURCE = 'cli-native'`; architecture section 7.3). Not verified live.

---

## D-028 Orca's cloud services are off in NASH builds

- Date: 2026-10-06.
- Status: ACCEPTED. The user approved the recommendations "Except for 2, all can be executed"; turning off Orca's five cloud services was one of them.
- Off behind `ORCA_CLOUD_SERVICES_ENABLED = false` (not a user setting): sending feedback and crash reports to Orca; Orca Cloud sign-in, the mobile relay, and artifact and skill publishing; installing shared skills from Orca links; the official plugin marketplace seed and kill-list refresh; the push gateway. An explicit `ORCA_*` endpoint override still reaches that one service. Update checks stay off under D-026.
- Implementation: done (package G2, 2026-10-06; architecture section 17.1).

---

## D-027 Remove the limits on what Claude, Codex and agy may do (restriction review group 1)

- Date: 2026-10-05.
- Status: ACCEPTED. After reviewing the list of 48 restrictions, the user: "i accept to remove them all". Asked which groups, the user chose "CLI and Claude limits": group 1, restrictions 1-3, 6, 8, 16, 19-26, 28, 30 and 35. Group 2 (protection against outsiders and leaks: 10, 31-34, 36-46, 48) and group 3 (the user's architecture rules: 4, 5, 7, 11-15, 17, 18, 27, 29, 39) stay.
- Removed:
  - 1: the primary session may use any Claude Code permission mode, including `bypassPermissions`, `auto`, `dontAsk` and `default`; the generated settings file no longer disables bypass or auto mode.
  - 2: read-only runs no longer deny Edit, Write and NotebookEdit to the primary session; the run access level still sets the Codex and agy mode (D-025) and what dot may approve (RG7, kept).
  - 3: the generated settings file adds only NASH's own allow rules and the hook, and never narrows the user's own Claude Code permission rules.
  - 6 and 8: TaskSpecs no longer need English prose, no longer refuse control characters or secret shapes at proposal, no longer need an acceptance criterion, and have no product size limits beyond a technical ceiling against runaway input. Clef still masks names and paths and runs its content scan (10, kept).
  - 16: the effort levels `ultra`, `none` and `minimal` are allowed where the CLI lists them.
  - 19 to 22 and 25: Codex and agy write as D-025 describes; no executable pins or trust (D-023); any installed launcher starts (D-023 amendment); folder workspaces may use Codex, with `--skip-git-repo-check` added there.
  - 23 and 26: no refused-flag lists or fixed argv shape checks, and no fixed timeouts; prompt and output bounds become technical ceilings only.
  - 24: the agy route no longer waits for P-01, P-03 and gate G8; it is available when its ordinary checks pass.
  - 28: a TaskSpec without automatic checks no longer gets a second-model review by default. The user chose: "Process check; Claude's report". Codex and agy tasks pass when NASH observes the process finish successfully with a result; Claude subagent and workflow tasks pass on the primary session's `succeeded` report, which relaxes 27 for those tasks only; a model review runs only when a TaskSpec asks for one.
  - 30: the validation reviewers run with their CLI's default settings instead of plan mode, no tools, no MCP, safe mode and read-only.
  - 35: follow-up messages have no length, English or secret-shape checks and no hold caps. Terminal control sequences that would end the paste frame are still neutralised, because delivery depends on it.
- Implementation: the parts that relax permission or sandbox boundaries (1, 2, 19-23, 25, 26 flags, 30, and the control-character and secret parts of 6 and 35) were refused by the Claude Code auto-mode permission check in earlier attempts (D-023); they are applied when the user approves the edits outside auto mode. The other parts are applied directly.
- Implementation status (2026-10-05, main session): applied: 20 and 21 (D-023 and its amendment) and 22 (a folder workspace runs Codex, and the Codex reviewer, with `--skip-git-repo-check`; the floating terminal stays unavailable). Not applied: 1-3. Adding `--allow-dangerously-skip-permissions` to the primary session (so the user could switch into `bypassPermissions` without starting in it) was refused by the Claude Code auto-mode check ("Create Unsafe Agents") after auto mode was on again; nothing was changed. Claude Code 2.1.289 lists the modes `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk` and `plan`: there is no `default` mode. Also waiting for approval outside auto mode: 19 and 25 (D-025 write mode), the flag parts of 23 and 26, 30, and the control-character and secret parts of 6 and 35. Package L1 applied the parts that relax no boundary: 6 and 8 (no English, acceptance-criterion or size rules at proposal, one 256 KiB ceiling, and an optional `review: "model"` field), with Clef sending over-cap fields as marked excerpts; 16 (the coordinator and the Claude reviewer still take only low to max, because the shared Claude launch catalog and the reviewer argv know no other level); the timeouts and caps of 23 and 26 (no fixed Codex or agy timeout, the agy prompt bounded by the real command line, agy output up to 64 MiB); 24; 28; and 35 (no length, English or hold limits; the control-character and secret checks stay).
- Implementation status (2026-10-06): the user approved the remaining removals except restrictions 1-3 ("Except for 2, all can be executed"; item 2 of that list was restrictions 1-3), which stay not applied, including `--allow-dangerously-skip-permissions`. Applied in the main session and package G3-D: 19 and 25 (D-025 write mode); the flag parts of 23 and 26 (no refused-flag lists and no argv re-checks before a spawn); 30 (the reviewers run with their CLI's defaults, and the Codex reviewer passes no `--sandbox`); the control-character and secret parts of 6 (TaskSpec text accepts any character; a title stays one line) and 35 (follow-up messages show terminal controls as visible symbols instead of being refused, and are not checked for secret shapes). Removed code is archived under autopilot-archive/2026-10-06/g3-boundary-removals/. Security review finding M4 (the workspace's own Claude settings can approve a tool call without the relay) is recorded as an accepted risk in architecture section 10.

---

## D-026 Update checks stay in the code, switched off

- Date: 2026-10-05.
- Status: ACCEPTED. The user: "Keep update checks disabled for now, but do not remove them; they may be enabled later".
- Orca's updater stays in the source. It is switched off by `APP_IDENTITY.updateFeed = null` (`src/shared/app-update-feed.ts`): no check, download, release listing or what's-new fetch dials a host, and Settings says "Updates are not available in this build." Enabling it later means giving the app identity a release feed (owner and repository); no updater code may be deleted.

---

## D-025 Codex and agy are no longer always read-only; parallel writers are kept apart with Orca worktrees

- Date: 2026-10-05.
- Status: ACCEPTED (removing always-read-only); design PROPOSED, then ACCEPTED on 2026-10-06 with the other boundary removals ("Except for 2, all can be executed"). The user: "Codex read-only mode and agy read-only mode aren't necessary either. Didn't Orca originally have a way to prevent conflicts between agents from two different CLIs anyway", then "continue to remove, I agree that".
- Supersedes the D-016 rule "direct `codex exec` (read-only until the user decides)" and the matching agy read-only mode.
- Orca's mechanism (verified in source): its orchestration dispatch can create a separate git worktree for a worker (`--worktree new-child` / `new-top-level`, `worker-worktree-creation.ts`), so parallel agents never edit the same checkout; their work is combined later with a git merge. Orca has no file locking. NASH's TaskSpec already records `isolationNeed: none | worktree` but creates no worktree yet (U20).
- Proposed design: Codex and agy follow the run's access level. In a run that may change files, a writing Codex or agy task runs in its own new worktree branched from the run's worktree (reusing Orca's worktree creation), in the CLI's own normal write mode (Codex `--sandbox workspace-write`; agy without its read-only flag, after its 1.2.16 flags are re-checked). After validation passes, the primary Claude session merges the task's branch in its visible terminal and resolves any conflict there. Read-only runs stay read-only.
- Implementation (2026-10-06): done (package G3-D; architecture section 8.6). The Codex sandbox and agy's `--sandbox` follow the run's access level, and nothing maps to full access. In a run that may change files, each Codex or agy write attempt gets its own Orca worktree branched from the run worktree's HEAD. When validation passes, or the user waives it (D-031), the primary is told to merge the branch; NASH reads the worktree's git state first, so the notice says to merge, to commit first, that there is nothing to merge, or to check by hand (package G9).

---

## D-024 Every Codex and agy task has a window the user can open to watch it

- Date: 2026-10-05.
- Status: ACCEPTED. The user: "Even though Codex and agy invocations are most likely headless, I should still be able to open that task's window myself to check on it, making it easier for me to monitor progress".
- Codex (`codex exec`) and agy (`--print`) keep running headless, so NASH reads their output reliably. NASH keeps each attempt's live output and lets the user open a read-only window for any running or finished Codex or agy task from the run view, showing what the CLI is doing as it happens, from the start of the attempt. Claude subagents and workflows already show in the primary session's visible terminal.

---

## D-023 No executable pinning or CLI verification; NASH runs the installed CLIs the normal way

- Date: 2026-10-05.
- Status: ACCEPTED. The user: "there's no need to go this far with proofing and verifying the CLI like that—my only concern was whether you might be invoking the CLI through illegitimate workarounds that could trigger rate limits or risk-control flags. As long as it simply invokes the local CLI on the machine, only mirrors/displays it in the interface, and communicates with the CLI strictly in compliance with each vendor's rules, there shouldn't be any issue. You can go ahead and strip out that defensive programming".
- Removed: executor trust (the trust store, `workbench.executors.*` and the Executors settings card) and executable pinning for Codex and agy (`requireExecutablePin`, `expectedExecutableSha256`, `executable_pin_missing`, the pre-spawn re-hash and `executable_identity_mismatch`), including in the validation reviewers and route checks. Codex starts through its own installed launcher, as typing `codex` in a shell does.
- Kept: NASH starts the CLIs installed on this machine through their documented modes (Claude Code interactive in a visible terminal plus its hooks, `codex exec`, agy `--print`) under each vendor's own login. NASH never reads, copies or reuses vendor credentials and calls no vendor API directly. The read-only Codex sandbox (D-016), the refused-flag lists that hold permission boundaries and log redaction stay.
- Correction (2026-10-05): the Kept line is not true of the code as it stands. Orca's inherited usage meters (`src/main/rate-limits/`, started with the main window in `main-window-core-services.ts`) read the CLIs' stored credentials and call vendor usage endpoints directly, for example `api.anthropic.com/api/oauth/usage` (`claude-oauth-usage-request.ts`) and `chatgpt.com/backend-api/wham/usage` (`codex-backend-usage-client.ts`), on window show and focus and every 15 minutes while focused. NASH's route availability reads those meters for its auth and quota checks. Found by the packaging readiness review; keeping, limiting or removing the meters waits for the user's decision.
- Resolved (2026-10-06): the user approved turning the meters off; package G1 removed their credential reads and vendor usage calls, and D-029 replaced them with readings from the CLIs themselves.
- Implementation (2026-10-05): the first attempt was refused by the Claude Code permission check when a subagent ran it, and every file was restored. The user then confirmed in the conversation ("i agree to remove") and extended the removal (amendment below); implementation restarted.
- Implementation status (2026-10-05): applied in the main session, outside auto mode, after the user said "go". Removed: the executor-trust package and its settings card, executable pins and the pre-spawn re-hash, binary hashing in the executable evidence, and the script-launcher refusals. A `.cmd` or `.bat` launcher starts through Orca's process pipeline; a `.ps1` launcher runs under `pwsh.exe` from PATH, else Windows PowerShell, with `-NoProfile -File` and no execution-policy override. 33 files were archived first under autopilot-archive/2026-10-05/x1-executable-pin-removal/x2-applied/ with SHA256SUMS.txt. Verified: tsc (node) exit 0; the affected suites pass (102 files, 1,781 tests) with no blocked spawn.
- Amendment (2026-10-05): on the rule that NASH never starts `.cmd` or `.ps1` launchers, the user: "This isn't necessary—don't let it interfere with the CLI's normal functionality". NASH starts a CLI through whatever launcher its installation provides, as a shell would; that rule is removed from the Kept list. The development rule that test runs never spawn real script launchers (the user's antivirus) is unchanged.
- Supersedes: the P1 executor-trust package (2026-10-05), the executable-pin parts of the C4 executor design, docs/architecture.md section 8.3 and the "Executables" live-gate item.

---

## D-022 No Clef budget cap or cost warning in the app; US$5 is a testing limit

- Date: 2026-10-05.
- Status: ACCEPTED. The user: "There is no need to set a budget cap or warning for Clef. What I meant was just to keep testing within $5 beyond the free tier".
- Supersedes the "Paid calls" paragraph of D-012: the app has no US$5 verification budget, no daily neuron cap, no daily classification cap, no "no call when a cap is unset" rule, and no cost warning or cost confirmation for Clef calls.
- Kept: the spend ledger as a record of what was spent (and for crash recovery of reserved calls), without limits; the limit of 2 billed attempts per TaskSpec as a retry bound, not a budget.
- Testing rule (development, not product): live Clef calls made while building and testing NASH stay within the Cloudflare free tier plus US$5 in total.

---

## D-021 dot reaches NASH through a remote MCP server hosted on GPT Sites

- Date: 2026-10-05.
- Status: ACCEPTED (hosting and deployment owner); design PROPOSED in docs/dot-mcp-remote-plan.md.
- The user: "Since I'll be deploying the MCP on GPT Sites, go ahead and lay out the plan first. I'll then have Codex handle the deployment and share the results with you". This supersedes "MCP later" for scheduling.
- Proposed design, revision 2 (adopts the mailbox model GPT suggested, relayed by the user): dot calls MCP tools on Sites; Sites stores tasks in an inbox; the NASH app polls over HTTPS, hands each task to the local dot endpoint (a new task starts its own run and primary session; a follow-up message goes to its run), and posts progress, permission prompts, acceptance results and deliverable summaries back to Sites for dot to read. No inbound port on the PC.
- Amendments: NASH stays the single authority (Sites holds only the inbox and a read-only copy of what NASH reported); every inbox item passes NASH's own checks again; tasks not taken within their TTL expire and never run later; deliverable file contents stay on the PC unless the user opts in per workspace.
- Open for the user (plan section 10): hop A authentication, remote write access, remote permission answers, hosted log retention. GPT Sites capabilities are unverified until Codex reports (plan section 2).
- Review update (2026-10-05): revision 3 is blocked by missing D4/E1 wiring and protocol/security gaps. Sites documentation establishes platform-managed MCP OAuth and the separate private service-access gate; these replace the proposed custom hop A fallback. H1 is partially verified, not live-tested. See `docs/dot-mcp-remote-review-2026-10-05.md`; no Site or deployment was created. D-017's permission-answer decision is retained, with enforcement required before remote exposure.

---

## D-020 Reviewer choice, Claude login evidence during a run, and what Clef receives

- Date: 2026-10-05.
- Status: ACCEPTED, the user approved the proposed defaults ("ok").
- Validation reviewer: the first reviewer in the Routing Table whose model differs from the work model. If it is unavailable, the validation is inconclusive and goes to the user or dot; the next reviewer is not tried. A fallback chain needs an explicit user-configured fallback (architecture direction: "Do not silently replace it with another model unless the user has explicitly configured a fallback").
- Claude login during a run: when the usage service defers its login reading because a session is live, Claude subagent and workflow routes count as logged in only with evidence that the run's own primary session is live, because they run inside it. The separate headless Claude reviewer still needs its own login reading; without one it is unverified and is not dispatched (U7).
- Clef input: only TaskSpecs written for agents (data class `agent_task_spec`) reach Clef; the user's request summary no longer does.
- Still open for the user: the classifier confidence thresholds and the wording of the 13 answer options, before the first billed Clef verification.

---

## D-019 Follow-up messages from dot reach the running Claude Code session through Orca's prompt sender

- Date: 2026-10-05.
- Status: ACCEPTED, the user approved the proposal ("ok").
- dot gains a command to send a follow-up message to a run it started (English, original-language quotes kept verbatim). The app applies the same checks as a new task (ingress token, rate cap, secret scan, English check), stores the message with the run, and reports the delivery outcome to dot (delivered, queued or refused).
- Delivery reuses Orca's `sendTerminalAgentPrompt`: one paste frame and Enter only when the agent can accept input. If the session is idle the message is sent as if the user typed it; if Claude is working it is queued; it is never sent while a permission or question dialog is open. Messages from the desktop use the same path.
- Not the run mailbox: the mailbox stays for task results, which the session reads on demand.
- Open until a live run: whether Claude Code applies a queued message at its next step or after the current turn.

---

## D-018 Tasks from dot start without desktop confirmation

- Date: 2026-10-05.
- Status: ACCEPTED, from the user: "Tasks sent from dot to the app do not require my confirmation".
- A valid dot submission goes straight through the single intake door and starts a workflow run; there is no per-task confirmation step in the app and no confirmation control is built.
- Safety rails kept as defaults (no per-task step; the user can change them): dot may only target workspaces the user has enabled for dot once; dot submissions are rate-capped; requested access comes from dot's structured request and defaults to read_only.
- Unchanged: permission prompts go to dot or the user (D-016, D-017); bypass and auto permission modes stay locked off; D-012 caps and data boundary.

---

## D-017 Own app identity, permission data sent to dot, validation policy, read-only CLI checks

- Date: 2026-10-04.
- Status: ACCEPTED, from the user's answers to four questions on 2026-10-04.
- App identity: the app is named NASH (user, 2026-10-04: "the new name of my app is NASH"). It gets its own application identity and data folder, separate from Orca's, so it can never share a database, settings or single-instance lock with a real Orca install on the same machine. The repository and its folder keep the working name autopilot.
- Permission requests sent to dot: tool, command and file names with secrets masked; never file contents. If dot does not answer, the prompt waits in the app for the user. This extends the D-012 data boundary to permission summaries only.
- Validation: a delegated task counts as done only after automatic checks (tests, builds, expected files) where they exist; otherwise after a review by a different model than the one that did the work. An executor's own report is never sufficient.
- CLI checks: read-only commands on the installed Claude Code, Codex and agy (version, help, model listings) are authorized to verify routing-table models and reasoning levels. No task runs and nothing is billed; account identifiers are scrubbed from recorded evidence.
- Unchanged: D-016 and its open items (Codex write access; final model pins).

---

## D-016 Architecture direction: Claude plans, Clef classifies, a versioned Routing Table selects, Orca's runtime owns execution state

- Date: 2026-10-04.
- Status: ACCEPTED, from the user's document `docs/architecture-direction.md` ("Use this document to align the current implementation"). The document is the reference; this entry records what it changes.
- Rule (user's words): "Claude owns planning. Clef owns task classification. The Routing Table owns model/profile selection. The Orca-derived runtime owns execution state. Executors perform work. Validators determine completion." No two components own the same decision.
- Flow: dot sends a structured task to the app; the app creates or selects a workflow run and starts one visible Claude Code CLI primary session for it; that session plans and decomposes work into TaskSpecs; Clef classifies each TaskSpec into `needs_delegation` and `task_type` only; the app looks up the Routing Table (task_type to execution target, model and reasoning level) and runs the task on Claude itself, a Claude native subagent, a Claude workflow, the Codex CLI or the agy CLI; a validation layer checks the evidence against the acceptance criteria before the result returns to the primary session.
- Supersedes in D-015 and the Clef adapter spec: Clef no longer chooses profiles, models or surfaces, and there is no Clef classification at intake. Supersedes the D-014 sentence that Orca's coordinator/worker orchestration model is not adopted: Orca's runs, tasks, dependencies, attempts, workers, question/reply and artifacts become the one authoritative execution state, while the Claude primary session stays the only planner (no Orca coordinator loop competes with it). Parallel stores that duplicate run, task or attempt state are to be replaced, not kept for compatibility.
- Routing Table: a versioned configuration asset with user overrides that take priority over the benchmark-derived defaults; benchmark updates only propose changes and the user activates them; a route is active only when its CLI exists, the model is available, the reasoning level is supported and authentication is valid, otherwise it is marked unavailable with no silent fallback.
- Codex: `codex-plugin-cc` is removed from the architecture; Codex runs through the official Codex CLI in structured non-interactive mode. agy: direct CLI executor; Gemini 3.8 Flash is a configurable candidate when available; Gemini 4 stays disabled.
- Improvement systems: GEPA and Recuris are research candidates, not dependencies; Dream-RSI is a documented placeholder (upstream code unavailable). The core path works without them.
- Permission prompts (user's answer, 2026-10-04): "Send the request to dot for decision, or allow me to confirm it as well". A permission prompt raised by the primary session is forwarded to dot for a decision and can also be confirmed by the user in the app.
- Open (user will decide later): whether Codex subtasks may write files (read-only until then); confirmation of the model pins in the initial table and the mapping of each reasoning level to settings the installed CLIs actually support.
- Unchanged: D-012 credentials, caps and data boundary; D-013 language boundary (restated in the document, section 19); the order from 2026-10-04 to build dot's local software interface first and the MCP integration later, until the user changes it.
- UI (user, 2026-10-05): "UI isn't excluded from the architecture". Screens for the new flow (run status, permission prompts, dot confirmation, routing table, Clef verification, the NASH name) are part of the alignment and follow the chosen D12 Paper design; the document's note on frontend changes is read as no change to the visual design direction.

---

## D-015 Execution architecture: one main Claude Code session per task; Clef routes subtasks

- Date: 2026-10-04.
- Status: ACCEPTED, from the user's instruction: "The architectural design remains that dot receives user information and dispatches tasks to the app via MCP. Based on the task, the app launches a main Claude Code CLI session, which plans and executes the task. For certain tasks, the Clef model determines whether to spawn subtasks as needed; if a subtask is required, the Clef model identifies its task type and routes it to a subagent within the main Claude Code session, a workflow of the main Claude Code session, or hands it off to Codex or agy".
- Flow: dot receives the user's request and submits the task to the app (today through the local software interface; the MCP integration comes later). The app launches one main Claude Code CLI session per task, configured for that task, and that session plans and executes it.
- Subtasks: for tasks that need it, Clef decides whether to spawn subtasks. For each subtask Clef identifies the task type and routes it to one of four targets: a subagent inside the main Claude Code session, a workflow of the main Claude Code session, Codex, or agy. In-session targets are carried out by the main session itself; Codex and agy targets are handed off by the app through Orca's invocation pipelines (D-014).
- Supersedes the phase-1 scope in D-012 and the Clef adapter spec, where intake routing chose among Claude, Codex, plugin and agy tuples for the whole request. Intake now always targets the main Claude Code session; the existing intake classification is kept only to configure that session (profile, model, effort, permission posture, or a clarification block). Codex and agy are reached only as subtask targets.
- Implementation choices (Claude Code, open to change): the main session asks the app for a subtask route through Orca's existing agent-to-app invocation path (the Orca CLI and runtime RPC) with a caller identity scoped to that task and session, never the desktop caller; subtask routing applies the agent-input trust model from the spec (inherited data class that cannot be lowered, mandatory content scan, per-task budget inside the D-012 caps); agy stays disabled until an approved non-Gemini-4 model exists.
- Unchanged: D-012 credentials, caps and data boundary; D-013 language boundary; D-014 reuse rules.
- Annotation (2026-10-05): superseded in part by D-016. Step A of the D-015 implementation plan (intake classification that configures the main session) and step C (a Clef-routed subtask service with `subtask.*` methods, `workbench_subtask*` tables and a subtask Clef bundle) were never built and are dropped: there is no Clef call at intake, and Clef classifies each TaskSpec the primary session proposes into `needs_delegation` and `task_type` only. Kept: one visible Claude Code primary session per workflow run; Codex and agy reached only as delegated targets; the agent-input trust model (data class `agent_task_spec`, inherited and never lowered, mandatory content scan). The per-task budget inside the D-012 caps is superseded by D-022 (no caps; 2 billed attempts per TaskSpec as a retry bound). "agy stays disabled until an approved non-Gemini-4 model exists" is carried by the Routing Table's availability rule: the agy route stays unavailable until P-01, P-03 and gate G8 pass.

---

## D-014 Reuse Orca first; agent invocation uses Orca's pipelines

- Date: 2026-10-04.
- Status: ACCEPTED, from three user instructions: "If Orca already has existing mechanisms for collaboration between Claude Code, Codex, and agy, or for direct collaboration among themselves, leverage those existing mechanisms"; "If a feature in this project has already been implemented in Orca, reuse it; if it can be adapted, modify it on top of the existing foundation; only build from scratch when introducing an entirely new feature"; and the clarification "When I mentioned the collaboration mechanisms, I was referring more to things like the invocation pipelines, rather than altering the fundamental principles—such as having the main session dispatch tasks to CLIs or utilizing sub-agents".
- Rule: every feature is checked against Orca first. Reuse an existing Orca feature as is; when it is close, extend or adapt it in place; build from scratch only for a feature Orca does not have at all (for example Clef routing, the spend ledger and the dot interface).
- Agent invocation: the project's principles stay: a main session dispatches tasks to agent CLIs (for example `codex exec` and agy) and Claude uses sub-agents. What is reused is Orca's invocation plumbing: its child-process pipeline (`runProcess`/`spawnProcess`, npm shim resolution without cmd.exe, process-tree termination), its agent launch, terminal and structured-session paths, agent detection, model catalogs and status reporting. Orca's coordinator/worker orchestration model is not adopted as a replacement for these principles.
- Consequence: the headless `codex exec` runner (`src/main/codex-exec/`) stays, because it is built on Orca's child-process pipeline; it was briefly stopped on 2026-10-04 under a misreading and then restored unchanged.
- Unchanged: D-012 (credentials, caps, data boundary), D-013 (language boundary) and the fail-closed rules for model pins and permission posture apply to every launch.
- Annotation (2026-10-05): the sentence "Orca's coordinator/worker orchestration model is not adopted as a replacement for these principles" is updated by D-016. Orca's runs, tasks, dependencies, attempts, workers, question/reply and artifacts are now the one authoritative execution state, while the Claude Code primary session stays the only planner. Orca's coordinator loop is retired: `orchestration.run` and `orchestration.runStop` stay registered and answer `orchestration_migration_required` with no effect. The reuse rule and the invocation-pipeline reuse stand. The D-012 caps named under "Unchanged" are superseded by D-022.

---

## D-013 Language boundary: English inside the framework, deliverables in the requested language

- Date: 2026-10-04.
- Status: ACCEPTED, from the user's instruction: "The intention behind using English was to facilitate smoother information flow within the framework. Regardless of the language the user speaks to dot, dot always outputs the requirements in English to the framework, and all internal interactions within the framework are conducted in English as well. However, this does not affect the language used for the final output files and deliverables".
- Rule: requirements entering the framework (dot ingress and Workbench intake) are English, and all internal communication is English: routing state, Clef questions, agent handoffs, status and event messages, and logs. The user may speak any language to dot; dot writes the requirement in English.
- Deliverables: output files and other deliverables use whatever language the requirement asks for. An optional deliverable-language field (a BCP 47 tag) carries it explicitly, and agent handoffs tell the agent to write deliverables in that language while reporting back to the framework in English. No framework check rejects a deliverable for its language.
- Implementation choice (Claude Code, open to change): names, paths, quotations and other text that must not be translated may appear inside an English requirement as explicitly quoted spans in any script. They are stored and passed to agents unchanged, and are replaced by a neutral placeholder in the Clef state, so non-English bytes still never leave the machine (D-012). The G1 gate keeps blocking a requirement whose prose is not English (`missing_inputs` / `non_english_objective`).
- Refines the archived English communication policy (internal control text English, user-facing presentation in the user's language, source text kept verbatim); supersedes nothing.

---

## D-012 Clef adapter backend: sealed credentials, intake routing, structured English state, US$5 test cap

- Date: 2026-10-04.
- Status: ACCEPTED, from the user's answers when the backend work started ("proceed with the backend development"), after an adapter design and three independent critiques.
- Credentials (supersedes the environment-variable placement in D-011): the Cloudflare token and account identifier are entered by the user in Orca's settings and sealed in Orca's encrypted credential store (Electron `safeStorage`, Windows DPAPI). A plaintext fallback is refused; if sealing is unavailable, Clef stays unconfigured. The UI and RPC report presence and protection only, never values. No environment variables are used, so launched agents and other user processes cannot inherit the token. If `AUTOPILOT_CLEF_*` variables exist anyway, Orca ignores them and removes them from its own process environment at startup.
- Routing scope: phase 1 classifies each Workbench intake request once over the full legal profile/surface tuple set. Choosing `claude_planner` launches a coordinator whose own planning is not routed again. Phase 2 adds per-subtask routing at worker start, with a trust model for agent-authored input.
- Data boundary (supersedes the proposal in D-011): the Clef `state` carries length-capped structured English fields: the objective, expected outputs, acceptance criteria, explicit user constraints and a data-class label. A secret and PII scan runs first, and any hit blocks the call (`classifier_unavailable` / `data_boundary_forbids`). Paths, file contents, diffs, terminal output, hashes and original non-English bytes never leave the machine. Capability descriptions live only in the bundle-controlled question options.
- Paid calls: live calls for testing and verification are authorized up to a cumulative **US$5.00**, enforced by a local spend ledger that refuses calls before the cap could be crossed. Production routing defaults: at most 2 billed attempts per request (retries counted), a daily cap of 2,000 neurons on the 00:00 UTC day, and no call when a cap is unset.
- Rotation: the token pasted earlier (D-011 exposure note) should be rotated before it is entered in Orca; the replacement is typed only into Orca's settings.
- Evidence status (B-14): Cloudflare API facts were re-read from primary documentation (Workers AI model page, input/output schemas, pricing, limits, errors, REST reference; accessed 2026-10-04). Facts the documentation does not state (response envelope, `result.model` value, error-body shape, option-ID tolerance) stay unverified until the live verification call pins them; numbers that came only from the 2026-10-02 research note remain proposals.
- Annotation (2026-10-05): "Routing scope" is superseded by D-016 (no Clef call at intake; Clef classifies TaskSpecs). "Paid calls" is superseded by D-022 (no caps or cost warning; 2 billed attempts per TaskSpec as a retry bound). The data boundary now admits only the data class `agent_task_spec` (D-020). The sealed credential files now live under `~/.nash` (D-017). Credentials, sealing, the content scan and the rotation advice stand.

---

## D-011 Hosted Clef authorized; credentials stay outside the repository

- Date: 2026-10-04.
- Status: ACCEPTED in principle (the user supplied a Cloudflare API token and the Workers AI Clef endpoint for their account). Live use waits for the credential to be placed in the local environment as described below.
- Decision: production semantic routing uses the hosted Cloudflare Workers AI model `@cf/cloudflare/clef` through the account the user designated. The adapter reads the token and account identifier from user-scoped environment variables in the main process only. Neither value is written to any repository file, log, renderer state, prompt, task record or design evidence; this public repository records only the variable names.
- Data boundary (proposed, pending the adapter design review): only a minimized English task summary, the approved profile/surface capability descriptions and the question set leave the machine. No source code, file contents, diffs, terminal output, credentials, original user-message bytes or personal identifiers are sent.
- Exposure note: the token was pasted into a Claude Code conversation, so it exists in that session's local transcript and was transmitted to the model provider. Rotation is recommended before production use; the replacement should be entered only in the user's own terminal.
- Not authorized by this entry: routing changes to protected validators, release approval, or any unbounded paid campaign. Each live Clef verification is a small, logged call with a synthetic task.

---

## D-010 Design critic through a Claude Code subagent; Codex assets stay blocked

- Date: 2026-10-04.
- Status: ACCEPTED, from the user's instructions in the frontend session: first "Keep blocked for now" for live critic and asset jobs, then "You can call a subagent to review your interface."
- Decision: the screenshot-only Design Critic may run as a fresh Claude Code subagent of the frontend session. It receives only the unchanged `design/review-prompt.md` and anonymized real-renderer screenshots. Codex asset generation stays blocked until Clef routing and a budget exist.
- Disclosed limitation: a subagent does not inherit the builder conversation, but it loads the user's global instructions and has file tools available, so isolation is instruction-level rather than enforced, and it runs on the same model family as the builder. Reviews are recorded as independent but not verified-blind, and are not Clef-routed. No visual score establishes functional, accessibility, security or lifecycle correctness, and the fixed rubric, thresholds and revision caps in `design/review-policy.json` stay unchanged.

---

## D-009 Frozen direction: D12 Paper with the charcoal terminal default

- Date: 2026-10-04.
- Status: ACCEPTED, the user's selection after reviewing the Discover v2 captures.
- Decision: freeze D12 Paper (paper neutrals, clay primary actions and focus, Georgia display headings, 6px corners, system sans for controls) into the Orca renderer tokens, with the D12 charcoal terminal as the default terminal theme in both shells and the D12 paper terminal available as a built-in alternative.
- Evidence: the Discover v2 bundle (`design/discover-v2/README.md`, `design/discover-v2/token-candidates.json`, 16 captures with manifest hashes), archived outside the repository on 2026-10-04. The builder recommendation was not a blind result.

---

## D-008 Reuse existing Orca features before adding missing functionality

- Date: 2026-10-03.
- Status: ACCEPTED, reaffirmed by the user during backend development.
- Decision: inspect and reuse Orca's implemented features before building absent functionality. Extend existing owners and contracts where their semantics fit; preserve functioning architecture.
- Current effect: request intake extends Orca's existing database connection, runtime RPC, workspace identity and sidebar controls. It owns no parallel scheduler, terminal manager, project database or workflow task registry. Existing run/task/dispatch semantics are the next integration reference.
- Frontend ownership and English-authoring policy remain D-007. Route, permission, budget, provenance and verification requirements remain binding.

---

## D-007 Reuse Orca interface; frontend optimization owned by Claude Code

- Date: 2026-10-03.
- Status: ACCEPTED, from the user's current instructions.
- Decision: leave frontend optimization to Claude Code. Codex uses Orca's existing interface and adds only necessary columns/sections for project features. Preserve Discover artifacts as the handoff; do not freeze or apply custom design tokens in Codex's feature work.
- Language: all new documentation, filenames, source comments and internal control content are English. Preserve original multilingual user/source bytes as quoted evidence rather than rewriting source data.
- Effect: changes frontend ownership and the immediate implementation sequence in D-006. The application's authority, routing, correctness, provenance, capability, safety and budget requirements remain.
- No message or model task was dispatched to a separate Claude session; the written handoff is `claude-frontend-handoff.md`, archived outside the repository on 2026-10-04.

---

## D-006 Updated coherent Orca workbench and design process

- Date: 2026-10-03.
- Status: ACCEPTED, from updated user-supplied briefs and the current request to continue development.
- Binding scope: Orca source foundation; one active primary Claude coordinator per run; model profiles independent from execution surfaces; Clef chooses model AND surface; Codex exec default; plugin eligibility restricted to verified project-allowlisted workflows; direct agy with approved non-Gemini-4 identity; no mobile companion; dot submits to the app's authenticated gateway.
- Mandatory process: Discover -> Define -> Deliver, private script seed, three comparable directions, applicable review before token freeze, enforced fresh screenshot-only critic, verified selected-surface Codex assets, bounded revisions/budgets, subtraction/anti-template audit and separate functional verification.
- Effect: supersedes conflicting parts of D-001/D-002 and historical docs; preserves compatible security, authentication, provenance, English communication and RSI release invariants. Historical proposals are not human approval of deployments, model calls, commits or protected release.
- Authorized current work: inspect session/memory/code; preserve existing evidence; local reversible development and Discover artifacts; update active plan. No new numeric live model/design budget or protected-action authorization is inferred.
- Current plan: [implementation-plan.md](implementation-plan.md). Earlier entries below are preserved as historical evidence and apply only where consistent with later instructions.
- Annotation (2026-10-05): "Clef chooses model AND surface", the exec/plugin surface split and plugin eligibility in the binding scope are superseded by D-016 (Clef classifies; the Routing Table selects; codex-plugin-cc removed). The current architecture is docs/architecture.md; implementation-plan.md is historical.

---

Durable record of human decisions and their effect on the brief
(`CLAUDE_CODE_PROJECT_BUILD_PROMPT.md`). A decision recorded here overrides the brief text it names.
Later M0 documents (architecture, plan, compatibility report) must reflect every ACCEPTED entry.

Status values: `ACCEPTED`, `PENDING` (needs a human answer), `SUPERSEDED`.

---

## D-001 Dot session management and no remote features

- Date: 2026-10-02
- Status: ACCEPTED
- Decided by: user (conversation, 2026-10-02)
- Decision:
  - Remote-related features are not used: Claude Code Remote Control, ChatGPT Secure MCP Tunnel,
    MCP Events webhooks, ChatGPT developer-mode plugins, Codex Remote, and `agy remote-control`.
  - The ChatGPT dot assigns tasks through its own local-computer access. It may open one or more
    explicit (visible, interactive) Claude Code CLI sessions and decides itself whether an
    additional session needs to be launched.
- Effect on the brief:
  - Brief section 1 and user requirement 1 ("one visible, persistent coordinator") become: one or
    more explicit Claude Code coordinator sessions, each registered with the local task service.
  - The project provides a local, durable, idempotent ingress command and session helpers that the
    dot (and the manual test client) can call. Delivery into an already-open session uses a
    local-only mechanism. The Channels development flag is not the primary path because its
    per-launch confirmation dialog blocks unattended launches.
  - Multiple coordinators require per-job leases, isolated worktrees, and serialized repository
    writers per checkout.
- Annotation (2026-10-05): superseded in part. dot no longer opens Claude Code sessions itself: the app starts one visible primary session per workflow run (D-015, D-016). dot reaches the app through a remote MCP server hosted on GPT Sites (D-021), which replaces "no remote features" for the dot path only; Claude Code Remote Control, the Secure MCP Tunnel, MCP Events webhooks, developer-mode plugins, Codex Remote and `agy remote-control` remain unused.

## D-002 Direct `codex exec` executor as the default Codex surface

- Date: 2026-10-02
- Status: ACCEPTED
- Decided by: user (conversation, 2026-10-02)
- Decision:
  - Codex tasks default to a direct, project-supervised `codex exec` executor (official Codex CLI
    non-interactive mode).
  - Selection still goes through Clef-direct routing; there is no bypass of Clef.
  - The official `openai/codex-plugin-cc` plugin is kept unchanged and continues to be selected
    within its original scope: in-session delegation through the `codex:codex-rescue` subagent and
    the plugin's official review surfaces.
- Effect on the brief:
  - Supersedes the parts of brief sections 1, 9.2, 12 and 18 and user requirement 2 that require
    all Codex delegation through the plugin and forbid a direct `codex exec` backend.
  - Still forbidden: a custom Codex app-server client, hosted OpenAI model HTTP clients, editing
    the plugin, reading or copying Codex credentials, `--dangerously-bypass-approvals-and-sandbox`,
    `--approve-for-me`, `--dangerously-bypass-hook-trust`, and `resume --last` in concurrent work.
  - Each execution profile still binds to exactly one surface. Exec-bound and plugin-bound Codex
    profiles are separate profile IDs; deterministic eligibility checks (for example, the plugin
    needs an attended coordinator session) filter them before Clef chooses.
  - Acceptance criteria AC-CODEX-01 to AC-CODEX-03 and the threat model must be rewritten
    accordingly during M0 synthesis.
- Annotation (2026-10-05): the clauses that keep `openai/codex-plugin-cc` in its original scope and the separate plugin-bound Codex profiles are superseded by D-016 ("codex-plugin-cc is removed from the architecture"). The direct `codex exec` executor is now the only Codex path, run read-only until the user decides otherwise. "Selection still goes through Clef-direct routing" is also superseded: Clef classifies each TaskSpec and the Routing Table selects the target, model and effort (D-016). The list of forbidden Codex flags and behaviours still applies.

## D-003 Codex reasoning effort `max` and `ultra`

- Date: 2026-10-02
- Status: PENDING (partially decided)
- Request: the user asked for `max` and `ultra` to be usable.
- Facts:
  - The local Codex catalog lists `max` and `ultra` for `gpt-6-astra` and `gpt-6.1-sol`.
  - codex-plugin-cc 1.0.6 rejects both locally (`VALID_REASONING_EFFORTS`, upstream issue #751,
    unmerged PR #761). Patching the installed plugin was blocked by the Claude Code auto-mode
    classifier and was not performed.
  - Under D-002 the `codex exec` path can pin effort per job with `-c model_reasoning_effort=...`
    without modifying the plugin. Live acceptance is unverified.
  - `ultra` is described in the Codex catalog as "Maximum reasoning with automatic task
    delegation", which conflicts with the brief's default ban on recursive worker delegation.
- Open question for the user: approve `ultra` as an explicit exception, or allow `max` only.
- Annotation (2026-10-05): the codex-plugin-cc facts above (its local rejection of `max` and `ultra`, issue #751, PR #761) are historical under D-016. Current state: the Routing Table schema excludes `ultra`; the default table uses `max` for four Codex rows and the runner passes it as `-c model_reasoning_effort="max"`; live acceptance of `max` stays unverified until gate G7. The open question stands, with `max` only as the working default.

## D-004 Orchestrating the official agy CLI under the user's own login

- Date: 2026-10-02
- Status: ACCEPTED (user-directed; residual risk accepted by the user)
- Decided by: user (conversation, 2026-10-02), by supplying two forum threads in answer to the
  question how the agy executor should treat the Antigravity terms
- Decision: the agy executor runs the official, unmodified, signed `agy` binary under the user's own
  Antigravity login, using only documented headless flags. The CLI performs its own authentication.
  The project never reads, copies, relays, or reuses Antigravity credentials, never calls private
  Antigravity endpoints, and never circumvents quotas.
- Evidence (accessed 2026-10-02):
  - Antigravity Additional Terms: "Using third party software, tools, or services to access the
    Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement."
  - Antigravity FAQ: "Why can't I use third-party software (such as Claude Code, OpenClaw, or
    OpenCode) with my Antigravity login?"
  - Official Antigravity headless docs (https://antigravity.google/docs/cli/headless/, saved copy
    verified line by line on 2026-10-02):
    - line 181: "Run Antigravity CLI non-interactively to script agent tasks, integrate with CI
      pipelines, and capture machine-readable output."
    - line 183: "Use it whenever you need the agent's output in a program instead of a terminal UI."
    - lines 529-543: section "Drive a session programmatically": "you can hold the `stdin` pipe open
      in a script. This allows your application to evaluate the model's answer before submitting the
      next prompt", with an official Python example
      `subprocess.Popen(["agy", "--input-format", "stream-json", "--output-format", "stream-json"], stdin=subprocess.PIPE, ...)`.
    This is first-party documentation of exactly the transport the project's agy adapter uses
    (supervised subprocess, stdin stream-json, program-driven turns). It is the strongest evidence
    for D-004; the forum threads below are supporting community opinion only.
  - https://discuss.ai.google.dev/t/is-orchestrating-the-official-antigravity-cli-from-a-local-multi-agent-coding-application-allowed/181088
    (2026-09-07): same pattern; the single reply says it is permitted. Replier is a community member
    (`staff: false`, `moderator: false`, `admin: false`, trust level 3). No accepted answer.
  - https://discuss.ai.google.dev/t/is-invoking-the-official-antigravity-cli-agy-print-from-a-third-party-developer-tool-an-acceptable-use/175462
    (2026-07-20): same pattern; the reply ("That's fine. The issue Google has with third-party tools
    is when they use the models at your disposal for your account in other harnesses (like OpenCode
    via Antigravity OAuth)") is the accepted answer. Replier is a community member (`staff: false`,
    trust level 2).
- Limitation: no official Google or Antigravity staff ruling was found. Account enforcement remains
  at Google's discretion. If Google publishes contrary guidance, live agy dispatch must be disabled
  and this entry superseded.
- Still required before live agy use: P-01 (model choice), P-03 (global permission review), and an
  authorized smoke test.
- Annotation (2026-10-05): the built agy runner uses the documented headless print mode (`--print=<prompt> --sandbox --model <id>`) rather than the stream-json transport cited above; both are covered by the headless documentation quoted in this entry. The runner refuses `--dangerously-*`, `--continue`, accept-edits mode and Gemini 4. Still required before live use: P-01, P-03 and gate G8.

## D-005 Dot ingress surface: local plugin (proposed)

- Date: 2026-10-02
- Status: PENDING (proposed by the lead architect after the dot-plugin study; needs user approval and
  a live spike)
- Question from the user: how does the dot communicate with the system, and what if it is provided
  to the dot as a plugin?
- Verified findings (study notes `scratchpad/m0/dot_plugin/{facts,facts.verify,design}.md`):
  - A local plugin (skills plus a stdio MCP server) can be installed privately on this PC through a
    personal or repository marketplace (`~/.agents/plugins/marketplace.json`) with no publication, no
    public endpoint, no developer mode, and no Secure MCP Tunnel. Locally orchestrated Codex/Work
    threads in the ChatGPT desktop app and the Codex CLI run its stdio server as a local process.
  - The dot's own cloud conversation cannot use it: MCP-bearing plugins are "Desktop only", and "An
    account upload does not make a local process available on web/mobile".
  - Dots with local access are cloud-coordinated. Plugin hooks do not run there. Whether a
    dot-created local task loads a local plugin's skill or starts its stdio MCP server is
    undocumented (UNVERIFIABLE without a live test).
  - The current CLI relay has likely Windows-sandbox problems: a sandboxed `teamctl` call probably
    cannot read the owner-only daemon secret or reach loopback without an escalation approval, and
    `teamctl session open` run from the sandbox may open the coordinator window on an invisible
    private desktop. Escalation approvals are answered in desktop Activity, not documented for mobile.
  - The ChatGPT desktop app reads `$REPO_ROOT/.claude-plugin/marketplace.json`; the repository must
    never contain that file, or coordinator tools could be offered to Codex tasks.
  - Dot-started local Work and Codex tasks count toward those products' usage limits.
- Proposal:
  - Target ingress (option C): a locally installed `autopilot-dot` plugin with a relay skill and a
    stdio ingress MCP server exposing a closed set of six tools (`submit_request`, `get_status`,
    `get_artifacts`, `list_sessions`, `open_session`, `cancel_request`) backed by the same application
    services as `teamctl`. No approval, override, release, takeover, dispatch, or evidence tools.
  - Fallback (option B): the same skill driving the `teamctl` CLI with JSON in and out.
  - The manual/local client remains the only verified ingress until a live spike passes.
  - Two MCP surfaces from one code base (`autopilot.mcp.coordinator`, `autopilot.mcp.ingress`) with
    per-role daemon secrets and per-role method allowlists; ancestry guard rejects ingress from
    `claude.exe`, `agy`, or daemon-managed jobs (evidence, not authentication).
  - The daemon launches a coordinator session only on an explicit authenticated
    `sessions.request_launch` (never on its own initiative), so the window opens on the user's desktop.
    The dot still decides whether a session is launched (D-001 unchanged in intent).
- Acceptance condition: live read-only spike (S0 to S8 in the design notes), starting with a harmless
  `ping` tool called from a dot-created local Codex task.
- User actions required: attest dot enablement and connect this PC; authorize the local marketplace,
  plugin install and ChatGPT app restart; authorize the spike (consumes dot and Codex usage; see P-08);
  choose the host approval mode for the write tools.
- Annotation (2026-10-05): SUPERSEDED. The local plugin proposal was not adopted. dot's local software interface (a dedicated pipe with its own token and contract versions 1 and 2) was built first (D-016), and dot reaches it through a remote MCP server on GPT Sites (D-021, planned).

---

## Pending decisions collected during M0 (to be confirmed at Gate 1)

| ID | Topic | Needed from the user |
|---|---|---|
| P-01 | agy model | Select one approved non-Gemini-4 slug from `agy models`. The bundled Routing Table uses `gemini-3.8-flash-high` (listed by `agy models` on 2026-10-04) pending this confirmation; the agy route stays unavailable until P-01, P-03 and gate G8 |
| P-02 | agy terms of service | Resolved by D-004 |
| P-03 | agy global permissions | Review the 58 persisted allow rules, `allowNonWorkspaceAccess`, and trusted home directory |
| P-04 | Clef | Cloudflare account ID and API token, data-sharing boundary, authorization for the first live call |
| P-05 | Claude subscription automation | Policy for unattended optimizer work through native Claude subagents under Max-plan Consumer Terms |
| P-06 | codex-plugin-cc enablement | CLOSED 2026-10-05: obsolete; codex-plugin-cc is removed from the architecture (D-016) |
| P-07 | Codex stop-review gate | CLOSED 2026-10-05 for the app: obsolete under D-016 (the stop-review gate is a codex-plugin-cc feature). It may still affect the user's own Claude Code environment, where the Codex plugin skills are installed; that is outside NASH |
| P-08 | Codex usage limit | Account is usage-limited until the reset reported by Codex (Oct 4, 2026, timezone not stated); authorize live smoke tests after that |
| P-09 | Codex effort tiers | See D-003 |
