---
name: orca-emulator
description: >-
  iOS Simulator control from inside NASH, with the live device view in NASH's
  emulator pane. Use when driving a booted Apple Simulator on macOS: taps,
  gestures, typing, hardware buttons, rotation, and the accessibility tree, or
  when an iOS change needs simulator evidence. For an Android device or emulator
  use the Android emulator skill; build and install the app with xcodebuild or
  simctl first.
license: Apache-2.0
---

# NASH Emulator

This discovery stub loads the version-matched guide from the NASH executable used for this session.

Prefer NASH over raw `serve-sim` or direct `simctl` for simulator control inside NASH; it
handles device scoping, helper lifecycle, and worktree context.

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
ORCA skills get orca-emulator
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that NASH is not running, start it with `ORCA open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `ORCA open` or restart NASH. If
`skills get` is unknown, explain that updating NASH restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
