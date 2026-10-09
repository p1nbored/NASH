# NASH

NASH is a desktop workspace built from Orca. Workbench is its in-app task workspace; Dot is the external entry point. Both use Orca's native coordinators, workers, terminals, worktrees and messages. A task classifier and routing table select the CLI, model and supported reasoning effort.

Dot can start a new coordinator or attach to an existing local Claude Code or Codex coordinator. Ordinary worker permissions go to the coordinator, ordinary coordinator permissions go to Dot, and critical permissions require the user.

## Download

[Windows x64 release v1.4.218](https://github.com/p1nbored/NASH/releases/tag/v1.4.218). The installer is unsigned. This version enables automatic updates from `p1nbored/NASH`. Earlier NASH builds need one manual upgrade because their update feed was disabled. See [release verification and limits](docs/releases.md).

## Documentation

- [Architecture and current decisions](docs/architecture-direction.md)
- [Setup and daily operation](docs/nash-operations.md)
- [Dot local and remote integration](docs/dot-mcp.md)
- [Differences from native Orca](docs/nash-orca-feature-differences.md)
- [Releases and verification](docs/releases.md)

These documents describe the current implementation. Superseded plans, handovers and checkpoints are available in Git history.

## Repository

| Path | Purpose |
|---|---|
| `desktop/` | Electron app and CLI; read [AGENTS.md](desktop/AGENTS.md) before editing |
| `sites/nash-dot-mcp/` | Owner-private remote mailbox for Dot |
| `docs/` | Current project documentation |
| `scripts/design/` | Optional design-review tooling; [scope](docs/design/README.md) |

NASH is independently maintained at [p1nbored/NASH](https://github.com/p1nbored/NASH). Orca changes are adopted deliberately. The original MIT license remains in [desktop/LICENSE](desktop/LICENSE). Private briefs and the earlier working copy remain outside this repository in `C:\Programs\autopilot`.

## Development

From `desktop/`, run `pnpm dev` for development and `pnpm build:win` for Windows packaging. Dependencies are pinned in `package.json` and the lockfile. For agent-launched tests and apps, set `ORCA_BACKGROUND_LAUNCH=1` and keep windows hidden.

Use `pnpm tc`, focused `pnpm test` suites and `pnpm run check:code-quality:changed` for relevant changes. The [operations guide](docs/nash-operations.md#development-checks) includes direct local tool entry points.

UI work follows [STYLEGUIDE.md](desktop/docs/STYLEGUIDE.md) and [DESIGN.md](DESIGN.md). Internal coordination messages use English; user artifacts follow the requested language.
