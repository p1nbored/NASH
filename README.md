# NASH

NASH is a desktop development workspace built from a snapshot of Orca (`desktop/`). dot (ChatGPT) or the desktop submits a request; NASH starts one visible Claude Code primary session per workflow run; Claude proposes TaskSpecs; Clef classifies each TaskSpec into `needs_delegation` and `task_type`; the versioned, user-customizable Routing Table picks the executor, model and effort; executors (Claude subagents, Claude workflows, Codex CLI, agy CLI) do the work; validators decide completion. Orca's runs, tasks and attempts are the single authoritative state.

NASH uses the official Claude Code, Codex and agy CLIs installed on this machine, the same binaries the shell finds on PATH. It does not bundle, patch or update them.

## Repository

- Home: <https://github.com/p1nbored/NASH> (private). NASH issues, releases and update sources belong here (D-036).
- Layout: `desktop/` is the app, `sites/nash-dot-mcp/` is the remote mailbox Site for dot, `docs/` holds the project records and `scripts/design/` the design-review tooling.
- History: the first commit is Orca's untouched files at stablyai/orca 995715b1 (MIT, license kept in `desktop/LICENSE`); every later commit is NASH's own change. Orca is a starting snapshot, not an upstream; Orca features are adopted by hand where useful.
- Not in version control: dependencies, build output, runtime state, private design inputs and the original build briefs. Those briefs and the earlier working copy stay in `C:\Programs\autopilot`.

## Read first

- `docs/architecture-direction.md`: the user's architecture direction (binding).
- `docs/decision-log.md`: decisions D-001 to D-039; later entries take precedence.
- `docs/architecture.md`: the architecture as built, including what is not yet verified live.
- `docs/nash-operations.md`: starting NASH safely, where data lives, turning dot and remote access off, and what each live gate needs from the user.
- `docs/nash-ui-ia-independence-plan-2026-10-06.md`: the current plan for the interface, settings, dot write access, agy on Windows, Orca compatibility and this repository.
- `docs/dot-mcp-remote-plan.md`: the GPT Sites mailbox for dot; `docs/dot-mcp-sites-deployment-2026-10-05.md` records its owner-private deployment.

## Status

Built and tested with injected fakes only. Nothing has run end to end against a real Claude Code, Codex, agy, Clef or dot session yet; those live gates need the user's authorization. The remote mailbox Site is deployed owner-private with MCP enabled.

All newly authored project files, documentation, comments and internal control messages are English; original source and user artifacts are preserved verbatim.

## Source and local checks

The product source is `desktop/`, with Orca's license, contributor instructions (`AGENTS.md`), style guide and lockfile retained. Read those instructions before editing. From `desktop/`, type checks run without launching the application:

```powershell
$env:ORCA_BACKGROUND_LAUNCH='1'
node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.node.json
node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.tc.web.json
node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.cli.json
```

Native desktop launch, Windows terminal lifecycle and release packaging remain unverified.
