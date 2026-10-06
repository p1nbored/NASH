# Task window and write mode: design (D-024, D-025)

Date: 2026-10-05. Status: design for implementation. Inputs: D-024, D-025 and the code scan in the session scratchpad (`wp-t1-scout.md`). Paths are under `desktop/orca/src/`.

## 1. Task window (D-024)

The user can open a read-only window for any Codex or agy task, running or finished, and watch what the CLI does from the start of the attempt. The CLIs keep running headless; NASH records what they print as they run.

### 1.1 Transcript file

- **Location:** one file per attempt, `<runDir>/transcript.jsonl`. `<runDir>` is the attempt's run directory, `<userData>/autopilot-runs/<runId>/<dispatchId>/`.
- **Creation:** the runner creates it exclusively, with mode 0o600, when the child starts.
- **Format:** UTF-8, one JSON object per line, LF line endings.

Every record has:

| Field | Value |
|---|---|
| `v` | `1` |
| `seq` | integer, from 0, no gaps among written records |
| `at` | ISO-8601 UTC with milliseconds, e.g. `2026-10-05T18:00:00.000Z` |
| `kind` | one of the kinds below |

Kinds:

| `kind` | Extra fields | Written for |
|---|---|---|
| `start` | `executor` (`codex` or `agy`), `model`, `effort` (or null), `sandbox` (`read-only` or `write`), `cwd`, `worktree` (`{branch, path, baseCommit}` or null) | both, first record |
| `command` | `id`, `status` (`started`, `completed`, `failed`), `command`, `exitCode` (or null), `output` (or null; on completion, the tail of the aggregated output, at most 4 KiB) | Codex `command_execution` items |
| `message` | `text` | Codex agent messages |
| `file_change` | `status`, `paths` (at most 50) | Codex `file_change` items |
| `tool` | `itemType`, `status` | other Codex items (MCP calls, web search), type and status only |
| `turn` | `phase` (`started`, `completed`, `failed`), `usage` (or null), `error` (or null) | Codex turns |
| `output` | `stream` (`stdout` or `stderr`), `text` | agy output, one record per line; Codex stderr lines |
| `error` | `text` | Codex `error` events |
| `note` | `code` (`records_dropped` with `count`, or `truncated`) | both |
| `end` | `state`, `exitCode` (or null), `reasonCode` (or null) | both, last record |

Rules:

- **Reasoning is never written.** Codex reasoning items are dropped, as the normalizer already does.
- **Redaction:** every text field goes through `redactAndBound` (`agent-exec-shared/secret-redaction.ts`) before it is written.
- **Record size:** a serialized record is at most 8 KiB. Longer text is cut and ends with `…[trimmed]`.
- **File size:** at most 8 MiB, keeping the start. When the next record would pass the cap, write one `note` with code `truncated` and stop, except for the `end` record (4 KiB reserved for it).
- **Never block the CLI:** writes go through one queue per attempt, so they never block the child's pipes. If the queue passes 1,000 records, new records are dropped and counted, and the count is written as `records_dropped`.
- **Retention:** when an attempt starts, the runner deletes `transcript.jsonl` files under the runs root whose attempts settled more than 30 days ago, at most 50 per pass. It deletes nothing else.
- **Stays on this machine.** The transcript is never part of a dot event, run summary, `attempt_artifacts` row, database row or `orchestration.taskShow` (RG6), and only the desktop renderer can read it.

Hooks:

- **Codex:** whole stdout lines through `onLine` (`codex-exec/codex-exec-session-io.ts`), mapped to the kinds above by a new `codex-transcript-records.ts`. Stderr lines go through the existing listener.
- **agy:** the stdout and stderr data listeners (`agy-exec/agy-exec-session.ts`), split into lines.
- **Setup:** the executors pass `transcript: { path }` in the run options. The runner owns the writer, `agent-exec-shared/attempt-transcript.ts`.

### 1.2 RPC (desktop caller only)

Every method below is in the caller-boundary test and the params catalog, and stays off the mobile allow list.

- **`workbench.runs.tasks {runId}`** returns `{tasks: [{taskId, title, executorKind, attempts: [{dispatchId, state, startedAt, settledAt, hasTranscript, worktree}]}]}`.
  - `executorKind` is `codex`, `agy`, `claude_subagent`, `claude_workflow` or `claude_primary`.
  - `worktree` is `{branch, path, baseCommit, merged}` or null.
  - Sources: the executor process store and the task snapshot reader.
- **`workbench.attempts.transcript.read {dispatchId, fromByteOffset, maxBytes}`** returns `{chunk, nextByteOffset, fileIdentity, reset, truncated, live, ended}`.
  - `maxBytes` is at most 262,144.
  - The server resolves the file from the attempt's `run_directory`, with an `isPathInside` guard. No path crosses the wire.
  - It reuses the reader logic of `ai-vault/local-log-tail-reader.ts`.
- **Live updates:** the window calls `read` every second while `live` is true, and stops after the `end` record. Version 1 makes no change to the streaming transport.

### 1.3 Screen

- **Task list:** each run row in the Workbench panel gets a task list (`WorkbenchRunTasks.tsx`, on the existing poll). Each row shows the title, the executor, the state and the elapsed time.
- **Entry point:** Codex and agy attempts have **Open task window**. Claude subagent and workflow tasks say they run in the main session and offer **Show terminal**.
- **The window:** a read-only tab in the main window (a new virtual tab mode), titled `Codex · <task title>` or `agy · <task title>`.
  - **Header:** executor, model, effort, sandbox, state, start time and elapsed time. For a writing task, the worktree branch, the base commit and **Open worktree**.
  - **Codex body:** rows for commands (output collapsed), messages, file changes, turns with usage, and errors.
  - **agy body:** plain lines.
- **Behavior:** the tab follows the newest output unless the user scrolls up, with **Jump to latest**. Earlier attempts of the same task are selectable.
- **Separate OS window:** a later option. It needs the trusted-caller admission described in the scan.

## 2. Write mode (D-025)

### 2.1 Access

- **Run access sets the mode.** The Codex and agy mode follows the run's access level. A `read_only` run keeps today's read-only behavior. In a `workspace_write` run, Codex and agy tasks write.
- **Remote runs:** the remote submit cap (read-only by default; a user decision is pending) and the RG7 permission ceiling are unchanged.

### 2.2 Own worktree per writing task

- **Every writing task is isolated.** Every Codex or agy task in a `workspace_write` run gets its own new worktree, whatever its `isolationNeed` says, so it never writes where the primary session or another task writes. `isolationNeed` stays recorded.
- **Creation:** through `runtime.createManagedWorktree`:
  - no startup agent and `activate: false`;
  - `setupDecision: 'inherit'`;
  - `lineage.parentWorktree` is the run's workspace, and `orchestrationContext` is `{orchestrationRunId, taskId}`;
  - name `nash-<run 8>-<task 8>`;
  - base: the run worktree's current HEAD commit.
- **Record:** the attempt stores the worktree id, path, branch and base commit.
- **Committed work only.** The new worktree starts from the last commit, not from uncommitted changes. The primary session's guidance says to commit what a writing task needs before proposing it.
- **Folder workspaces** (not git) cannot branch. A writing Codex or agy task there is refused with reason `task_worktree_unavailable`, and the primary session is told; read-only tasks still run.
- **CLI mode:** Codex runs with `--sandbox workspace-write --cd <task worktree>`. agy runs without its read-only flag only after the installed 1.2.16's flags are confirmed with `agy --help` (a read-only CLI check, D-017). Until then, agy tasks stay read-only and the route says why.

### 2.3 After the attempt

- **Validation** runs in the task worktree.
  - The sandbox check becomes "the sandbox matches the run's access" instead of `sandbox_not_read_only`.
  - The `no_workspace_writes` machine check applies only to read-only attempts.
- **On pass:** NASH sends the primary session a notice through the existing claim-notice and prompt path. It gives the task title, branch, base commit and diffstat, and asks it to merge the branch into its own when ready and resolve any conflict in its terminal.
- **Merge policy:** NASH does not merge by itself. This is the default the user was offered; the alternative, NASH merges automatically and asks Claude only on a conflict, is not built.
- **On failure:** the notice says the branch is kept for inspection.
- **Cleanup when the run ends:** NASH removes task worktrees whose branch is merged into the run worktree's branch (`git merge-base --is-ancestor`), through Orca's worktree removal. Unmerged ones stay, listed in the run row with **Remove worktree**.

## 3. Packages and status

- **E3, transcript** (main): the writer, Codex and agy hooks, run options, executor wiring and retention. Ready to build.
- **UI-8, task window** (RPC and renderer): the two methods, the task list, the tab, and screenshots from fixtures. Ready to build.
- **W1, write mode** (main): the access-to-mode rule, a `taskWorktree` launch port replacing `workspacePath` for writing tasks, the sandbox policy and report checks, the merge notice and cleanup.
  - W1 may run `agy --help` and `codex exec --help` once, and nothing else against the real CLIs.
  - On hold: in auto mode, Claude Code's permission check refused both attempts at the D-023 removal (X1, X2) even with the user's approval, and W1 relaxes the same kind of boundary. It waits until the user approves edits in a permission mode the check accepts.
- **Shared files:** E3 and W1 both touch `codex-task-executor.ts` and `agy-task-executor.ts`, in different functions. Each re-reads before every edit.
