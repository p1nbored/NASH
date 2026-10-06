# NASH developer workspace

NASH is a desktop app built on a pinned snapshot of Orca (`desktop/orca/`). dot (ChatGPT) or the desktop submits a request; NASH starts one visible Claude Code primary session per workflow run; Claude proposes TaskSpecs; Clef classifies each TaskSpec into `needs_delegation` and `task_type`; the versioned, user-customizable Routing Table picks the executor, model and effort; executors (Claude subagents, Claude workflows, Codex CLI read-only, agy CLI) do the work; validators decide completion. Orca's runs, tasks and attempts are the single authoritative state.

NASH uses the official Claude Code, Codex and agy CLIs installed on this machine, the same binaries the shell finds on PATH. It does not bundle, patch or update them.

## Read first

- `docs/architecture-direction.md`: the user's architecture direction (binding).
- `docs/decision-log.md`: decisions D-001 to D-025; later entries take precedence.
- `docs/architecture.md`: the architecture as built, including what is not yet verified live.
- `docs/nash-operations.md`: starting NASH safely, where data lives, turning dot and remote access off, and what each live gate needs from the user.
- `docs/dot-mcp-remote-plan.md`: the GPT Sites mailbox for dot; `docs/dot-mcp-sites-deployment-2026-10-05.md` records its owner-private deployment.
- `CLAUDE_CODE_START_INSTRUCTION.txt` and the two root build briefs: the original project brief, annotated where later decisions supersede it.

## Status

Work is paused at a checkpoint: `docs/nash-checkpoint-2026-10-05.md` records the state, what was stopped mid-way and the order to resume in.

Built and tested with injected fakes only. Nothing has run against a real Claude Code, Codex, agy, Clef or dot session yet; those live gates need the user's authorization. The remote mailbox Site (source in `sites/nash-dot-mcp/`) is deployed owner-private with MCP enabled, but no MCP client has connected to it and no NASH App is paired with it.

All newly authored project files, documentation, comments and internal control messages are English; original source and user artifacts are preserved verbatim.

## Source and local checks

The product source is `desktop/orca/`, with its upstream license, contributor instructions (`AGENTS.md`), style guide and lockfile retained. Read those instructions before editing. From `desktop/orca/`, type checks run without launching the application:

```powershell
$env:ORCA_BACKGROUND_LAUNCH='1'
node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.node.json
node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.tc.web.json
node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.cli.json
```

Native desktop launch, Windows terminal lifecycle and release packaging remain unverified.
