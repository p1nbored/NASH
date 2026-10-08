# NASH operations

- Date: 2026-10-05. Audience: the user. Companion to [architecture.md](architecture.md).
- Status: describes the code as built. **Nothing has run live.** No real Claude Code, Codex, agy, Clef or dot session has been started by NASH. No packaged NASH build has been produced, and no package has watched the real app start with the D-016 wiring.

## 1. Start NASH safely with nothing live

### What startup does

- It creates or checks NASH's three table families in its own `orchestration.db`: Workbench, autopilot runtime and dot ingress. It installs the bundled Routing Table version 1 on first start, and installs the classifier, primary-session, executor, validation, relay and task-API runtimes.
- The NASH packages start no agent CLI, make no network call and read no credential during startup. This is tested with the production builders over a memory database. Orca's own features keep their usual behaviour; the update check is off because NASH has no update feed.
- NASH uses fresh folders (section 3). It never reads Orca's settings or data.

### What makes something live

| Action | What goes live | Until the gate passes |
|---|---|---|
| Submitting a Workbench request | Launches a real Claude Code session in that workspace under your login (subscription usage). Route checks run a turn-free `claude -p` model listing. | Do not submit (G5) |
| Turning dot on | Opens the dot endpoint and writes a token file. Any local process of yours that reads the token can submit tasks, which start runs without confirmation (D-018). | Leave it off (the default) |
| Enabling a workspace for dot | dot submissions to it start runs | Enable none (the default) |
| Clicking Verify in the Clef section | One billed Cloudflare call | Do not click (G4) |
| Entering Clef credentials | Nothing by itself. Once a profile is pinned, every TaskSpec a run proposes is classified with a billed call. | Optional; needed for G4 |
| Opening Settings > Integrations > Task routing | Nothing: it reads local files only | Safe |

### Steps

1. Start a dev build from `desktop` with `pnpm dev`, which runs `ensure:electron-runtime` and then `node config/scripts/run-electron-vite-dev.mjs`. Dev data goes to `%APPDATA%\nash-dev`. To isolate a session further, set `ORCA_DEV_USER_DATA_PATH` to an empty folder before starting. Agents in this repository do not run pnpm, because of the antivirus rules; you start it yourself.
2. Leave dot off and no workspace enabled for dot. Both are the defaults. The dot settings screen is being built (package UI-C). Until it lands, the switch is the desktop method `workbench.dotIngress.settings.setEnabled`.
3. Do not submit Workbench requests and do not click Verify.
4. What you can look at safely:
   - Settings > Integrations > Task routing: the active Routing Table, proposals and history, and the Clef status (not configured until G4).
   - The Workbench panel: Runs and Permission prompts, both empty.
5. Watch the app's startup log. Each install step fails closed after 10 s, and a failed step leaves its features refusing with an `unavailable` code rather than half working. A real start with this wiring has not been observed yet.

## 2. Live gates and what each needs from you

Gates G0 to G2 need nothing more from you:

- G0 (package checks) is done per package report.
- G1, the security and TypeScript review (package F1), is pending.
- G2 (read-only CLI probes) was done on 2026-10-04 under D-017.

The remaining gates run in order. Each needs your explicit authorization at the time. Live Clef calls during testing stay within the Cloudflare free tier plus US$5 in total (D-022).

### G3: route availability and model confirmation

- **Decide:**
  - confirm or change the bundled table: model pins, levels, the `coordinator_reasoning` row and the reviewer order;
  - confirm the source names on rows ([evidence](routing-table-evidence.md));
  - supply the benchmark snapshot date.
  Edits go through Settings > Task routing ("Edit routes" creates a proposal you accept).
- **Authorize:** the first availability evaluation. It runs read-only listing probes: the turn-free `claude -p` model listing, Codex's `model/list` and `agy models`. No task runs and nothing is billed.
- **Verifies:** each route's status. Expected results:
  - Codex routes need a git workspace;
  - the agy route stays unavailable until G8;
  - a Claude route on a model without effort control is unsupported.
- **Gap:** the Settings view does not yet show availability per route, so G3 needs that view (follow-up package V1) or a supervised check.

### G4: first billed Clef verification

- **Decide:** confirm or change the classifier thresholds (0.6, 0.4, margin 0.10) and the 13 answer texts (D-020). A change alters the bundle hash, so decide before Verify.
- **Provide:**
  - rotate the Cloudflare API token (D-012);
  - type the new token and the account identifier into Settings > Integrations, where they are sealed with Windows DPAPI.
  Never paste them into a chat, file, terminal or environment variable.
- **Authorize:** one billed Verify, about US$0.0012 reserved. Then review the report and click Pin profile.
- **Verifies:** the response envelope, model identity, answer shape and token usage. Sequence: [Clef classifier spec](clef-classifier-spec-2026-10-04.md), section 8.

### G5: primary-session launch

- **Needs first:** G3 (the coordinator route must be available).
- **Provide:** a disposable git repository as a scratch workspace, and your Claude Code login (already on this machine).
- **Authorize:** one real Claude Code session launch. It uses your Claude subscription.
- **Verifies:**
  - the launch command on Windows, including PowerShell 5.1 quoting of `--agents` (a known risk: 5.1 drops embedded quotes, so the launch would fail visibly);
  - the settings locks: bypass and auto disabled, Edit, Write and NotebookEdit denied on read-only runs;
  - `--agents` accepted;
  - the hook command resolves;
  - the allow rules match the heredoc `task-propose` call;
  - hook attestation at the first command;
  - Show terminal reveals the tab;
  - follow-up message delivery (delivered, queued, held), and whether a queued message applies at the next step or after the turn;
  - restart reconcile.
- **Watch for:** your global Claude Code instructions may lead the primary to start its own subagents outside routing.

### G6: permission relay

- **Needs first:** G5.
- **Provide, for dot answers:** turn dot on and enable the scratch workspace (read-only).
- **Authorize:** a session that raises permission prompts.
- **Verifies:**
  - the hook blocks and waits;
  - the desktop answer;
  - the dot answer through the local client;
  - a terminal answer closes the record as `answered_in_terminal`;
  - the native dialog stays answerable while the hook waits;
  - pane variables are inherited on Windows;
  - a late decision is ignored.

### G7: Codex read-only smoke

- **Needs first:** the Codex usage limit (P-08) cleared, a git workspace and a folder workspace.
- **Authorize:** billed Codex runs: one task and one review.
- **Verifies:**
  - `max` is accepted for `gpt-6.1-sol` and `gpt-6-astra`;
  - a run in the folder workspace starts with `--skip-git-repo-check` (D-027);
  - event and output shapes;
  - read-only sandbox enforcement on Windows;
  - process-tree proof;
  - which model served the review (for reviewer independence).

### G8: agy smoke

- **Needs first:**
  - P-01: confirm `gemini-3.8-flash-high` or another actually listed model id;
  - P-03: review agy's global permissions, including the persisted allow rules, `allowNonWorkspaceAccess` and the trusted home directory.
- **Authorize:** billed agy runs.
- **Verifies:**
  - write behaviour under `--print --sandbox`;
  - whether a trust prompt hangs the run;
  - error text on stderr;
  - the variant id with no effort flag.

### G9: end-to-end synthetic run

- **Needs first:** G4 to G7.
- **Provide:** dot on, with one read-only test workspace enabled.
- **Authorize:** one billed run within the testing rule.
- **Verifies:**
  - dot local client submit;
  - run launch;
  - one `claude_subagent` and one `codex_cli` TaskSpec;
  - classification;
  - validation, including a headless Claude review;
  - `run-complete`.

### G-remote: remote MCP for dot

- **Needs first:**
  - package R1 (the sync agent) and UI-7 (the remote switch, pair and revoke);
  - Codex's hosted side passing every conformance vector;
  - review gates RG1 to RG9 closed;
  - your decisions in section 10 of the [remote plan](dot-mcp-remote-plan.md) and on the R2 defaults (no deliverable contents, read-only remote submissions, TTL 30 minutes, retention 7 days, remote permission answers under RG7).
- **Authorize:**
  - creating a separate owner-private test Site (every Sites URL is production);
  - how the desktop obtains platform service access (no documented durable renewal path yet);
  - an owner-approved pairing;
  - connecting dot to the Site's plugin.
- **Verifies:** one live pass per tool, plus offline, expiry and revocation cases.

## 3. Where data lives

The paths are for Windows. On macOS the user data folders sit under the application-data folder with the same names. Linux packaging is not done.

| Location | Content |
|---|---|
| `%APPDATA%\nash` (packaged) or `%APPDATA%\nash-dev` (dev); `ORCA_DEV_USER_DATA_PATH` overrides the dev folder | NASH user data. NASH's single-instance lock follows it. |
| `...\orchestration.db` | Orca's tables plus the NASH families: Workbench requests, runs, primary-session owners, TaskSpecs, classifications, routes, executor records, validations, permission decisions, follow-up messages, dot requests and settings, the Clef spend ledger, and raw Clef responses (sensitive at rest) |
| `...\routing-table\` | `index.json`, `versions\`, `proposals\`, `availability.json` (route latches) |
| `...\primary-sessions\` | Generated `--settings` files, owner-only; kept after the run |
| `...\autopilot-runs\<run>\` | Codex and agy run directories, including raw output; no retention policy yet |
| `...\autopilot-reviews\` | Reviewer run directories |
| `...\clef-verified-profile.json` | The pinned Clef profile, after G4 |
| `...\dot-ingress-runtime.json` | The dot endpoint name and per-start token, owner-only; exists only while dot is on |
| `~\.nash` | Agent hook scripts (`agent-hooks`), sealed credential stores including the Clef token and account id (`clef-api-token.enc`, `clef-account-id.enc`), keybindings, the managed-hook install lock |
| `~\.nash-relay`, `~\.nash-remote`, `~\.nash-wsl` | Relay, remote-host and WSL helper state |
| `~\.local\share\nash`, `~\.cache\nash` | Shared data and caches |
| `~\nash\projects`, `~\nash\workspaces` | Default project and workspace folders |
| `%LOCALAPPDATA%\NASH\daemon-host` | The terminal daemon host |

- NASH never reads or writes Orca's folders (`%APPDATA%\orca`, `~\.orca` and the rest). It ignores an inherited `ORCA_USER_DATA_PATH` that points at an Orca profile.
- The global command is `nash` (`nash-dev` for dev builds). Inside NASH terminals, `orca` resolves to NASH's own command through a session alias, so the primary session's `orca orchestration ...` calls reach NASH.
- Claude Code, Codex and agy keep their logins and data in their own folders. NASH never reads their credentials.
- Stores refuse new rows at 10,000 Workbench or dot requests; there is no pruning yet.
- Nothing is stored on GPT Sites: no Site exists.
- Rollback copies of every file the alignment deleted or rewrote are under `C:/Programs/autopilot-archive/2026-10-04/removed-code/d016-alignment/` (see its `README.md`).

## 4. Turning dot and remote off

### dot (local interface)

- **Off is the default.** To turn it off, use the dot settings screen (UI-C, in progress) or the desktop method `workbench.dotIngress.settings.setEnabled` with `enabled: false`.
- **Effect of switching off:**
  - the endpoint closes and `dot-ingress-runtime.json` is removed;
  - no new submission, message or answer can arrive;
  - stored requests stay readable on the desktop;
  - a request NASH had received but not yet accepted never starts later, even after a restart; it ends `failed`.
- **Runs already started keep running.** Whether switching off should also cancel them is an open decision. Stop them with Workbench > Runs > Stop run.
- **Narrower controls:**
  - disable one workspace with `workbench.dotIngress.workspaces.disable`;
  - lower a workspace's ceiling by enabling it again with `maxAccess: read_only`;
  - lower the rate caps with `workbench.dotIngress.settings.setRateLimits`.
- **Token.** It is new on every start, so restarting NASH invalidates any copied token.
- **Hard off.** Quit NASH; nothing listens.

### Remote (GPT Sites)

- **Today.** Nothing exists to turn off: there is no sync agent, Site or pairing, and NASH makes no remote call.
- **Planned (R1, UI-7).**
  - A remote access switch in Settings, off by default and separate from the local dot switch. Off means no polling and no events.
  - Revoking the pairing from NASH or the Site's admin page fences every session, lease and event by pairing generation and deletes the waiting inbox.
  - Revocation stops future remote work; it does not cancel runs NASH had already accepted.
  - Remote items enter through the local dot endpoint, so the local dot switch also blocks them.
- **Keep remote off until G-remote passes.**

## 5. Stopping work

- **Stop a run:** Workbench > Runs > Stop run. NASH interrupts the primary session, waits 5 s, then closes its terminal. If the close cannot be confirmed, the run reads `unverifiable`; there is no force-end control yet.
- **Cancel a request:** before launch this cancels only the request. After launch it stops the run first.
- **Unanswered permission prompts:** they wait 240 s, then fall back to Claude Code's own dialog in the terminal. They are never allowed or denied automatically.
- **Quit NASH:** quitting aborts classification, validations and Codex and agy children within the 20 s shutdown window. On Windows only the root process's exit can be proven, so check Task Manager for leftover `codex.exe` or `agy.exe` after an interrupted run.

## Native execution update — 2026-10-08

For new routed Codex/AGY tasks, task-start now uses Orca worker launch, native preamble delivery, mailbox reports and worker stop/release. Task-show reads the native result. Do not task-report on behalf of those workers. Claude primary/subagent/workflow tasks keep their existing in-session reporting. Existing headless attempt logs remain readable.

Task access ceilings are passed into native PTY/structured launch; user global settings are not rewritten. Dynamically verified route choices carry through to native argv, including an effort absent from the old static catalog. There are no new hard-coded model availability entries. Failed/canceled runs still offer Stop run for leftover-worker cleanup.

Native reports are not automatically labeled as independent validation passes. The existing independent Codex/Claude reviewer path remains headless for in-session/historical validation; it is not used to launch new routed Codex/AGY task workers. Actual provider/account, WSL and SSH behavior still requires live verification; passing fixture tests is not a claim of live model access.
