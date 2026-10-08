# NASH

NASH is a desktop development workspace built from Orca (`desktop/`). Dot (ChatGPT) or the desktop submits a request, and NASH starts one primary session using Claude Code or Codex, selected in Settings → Task routing. The primary proposes TaskSpecs; Clef classifies them; the versioned routing table selects the CLI, model and effort. Execution, context delivery, messages and stopping reuse Orca's native mechanisms. In-session work uses NASH validation, while native workers retain their native completion lifecycle. Orca's runs, tasks and attempts remain the authoritative state.

Windows x64 installer: [NASH releases](https://github.com/p1nbored/NASH/releases/latest). The initial installer is unsigned; automatic updates are not configured.

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

The October 6 interface/independence plan is implemented. See [the current checkpoint](docs/nash-checkpoint-2026-10-06.md) for checks and limits. All 1,633 NASH-specific keys are translated into the five supported non-English languages. Windows credential I/O passed a disposable real-store test. The owner-private remote mailbox is deployed on contract v4; the desktop is currently offline.

Real routed CLI/Clef tasks, two-account switching and release packaging remain unverified.

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
