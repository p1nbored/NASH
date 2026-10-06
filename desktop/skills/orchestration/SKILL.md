---
name: orchestration
description: >-
  Coordinate supervised NASH workers: threaded messages, blocking ask/reply,
  task dispatch, worker_done/escalation waits, task DAGs, decision gates,
  supervised waves, and decomposing work across agents. Use `orca-cli` for full
  ownership handoffs — "hand off", "handoff", "handover", "give this to another
  agent", "another worktree" — unless asked to supervise, monitor, or coordinate
  a DAG, and for terminal control, lightweight terminal prompts, shell commands,
  NASH worktree management, and reading or waiting on terminals.
---

# NASH Orchestration

This file is a discovery stub, not the usage guide. The full, version-matched NASH
orchestration reference is served by the `nash` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage NASH orchestration whenever you need structured multi-agent coordination: threaded
messages, blocking ask/reply flows, task dispatch, worker_done/escalation waits, task DAGs,
decision gates, supervised waves, or decomposing work across agents. Use the orca-cli skill
instead for full ownership handoffs ("hand off", "handoff", "handover", "give this to
another agent", "another worktree") when the user did not ask to supervise, monitor, wait
for results, or coordinate a DAG — and for ordinary terminal control, shell commands,
worktree management, and the built-in browser. Coordination requires real NASH runtime
state; never substitute a non-NASH subagent tool. The primary session of a NASH app run is
its only planner: it uses the commands its launch prompt names and runs no supervised loop.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `ORCA_CLI_COMMAND` environment variable is set, use its value. NASH exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `ORCA_DEV_REPO_ROOT`, use `nash-dev`.
- Otherwise, on Linux outside a NASH-managed terminal, use `orca-ide`, NASH's Linux command
  name for now. Never run bare `orca` there — outside NASH's terminals it normally resolves
  to the GNOME Orca screen reader (`/usr/bin/orca`) and starts speech on the user's machine.
- Otherwise, use `nash`. Inside NASH terminals `orca` is an alias for the same executable.

Below, `ORCA` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `ORCA` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different NASH build.

## Load the version-matched guide before running NASH commands

```text
ORCA skills get orchestration
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers the normal local supervised loop. For a conditional action gate
such as remote placement, uncertain release recovery, or expanded DAG work, load only the
reference that gate names with
`ORCA skills get orchestration --reference references/<file>.md`
(`--references` lists the names). If that binary rejects `--reference`, run
`ORCA skills get orchestration --full` and read the named bundled reference before acting.

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that NASH is not running, start it with `ORCA open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `ORCA open` or restart NASH. If
`skills get` is unknown, explain that updating NASH restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
