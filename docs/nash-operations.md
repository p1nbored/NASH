# NASH operations

Current source guide. See [architecture](architecture-direction.md), [Dot integration](dot-mcp.md) and [published releases](releases.md).

## Install and configure

1. Download the Windows x64 installer from [NASH releases](https://github.com/p1nbored/NASH/releases/latest). Verify it against the release's `SHA256SUMS.txt`. Builds before `v1.4.218` need one manual upgrade because their update feed was disabled.
2. Install and sign in to the official Claude Code, Codex or AGY CLI you want to use. NASH does not bundle or patch those CLIs.
3. In **Settings → Agents → Agent Permissions**, choose **Auto** for coordinator/Dot review or **Manual** for native confirmation. Yolo remains the native bypass preset where supported. Auto does not mean automatic model selection.
4. In **Settings → Task routing**, click **Refresh model list** to read the CLI catalogs, then choose a coordinator and the CLI/model for each task type. Reviewers are editable. Claude workflow offers a Claude model and its supported effort; it has no CLI selector.
5. Configure **Classifier** credentials and run its verification, then use the verified result. Clef is the current provider. Verification and classification make real provider calls.
6. Open a repository or folder workspace. Submit work in **Workbench**, or enable Dot for the intended workspace.

Running tasks and provider verification use the user's configured accounts. Browsing a route is not proof that its model is available.

## Updates, plugins and reports

Update checks and downloads target `p1nbored/NASH` for stable and RC releases. Releases include the installer, blockmap and `latest.yml` update metadata; upload them together before making a release public.

Enable the ordinary plugin-system setting to browse Orca's official catalog. The extra NASH catalog opt-in is gone; packaged builds also refresh the native plugin safety list. Catalog data lives in the NASH profile's `plugins-data/`, and installed plugins in its `plugins/`. This does not create a separate Orca profile or rename NASH.

Feedback and crash-report actions open a NASH GitHub Issue draft. Review it and submit it in the browser; opening the draft neither uploads a report nor marks it sent. Update, catalog and reporting entry points no longer carry NASH disable restrictions. Orca Account, Mobile and other disabled cloud services remain unchanged.

## Workbench and existing coordinators

Workbench is the application entry point for requests, runs, tasks, messages, permissions and validation results. It uses the native Orca runtime underneath.

An existing local Claude Code or Codex coordinator can keep its context and current CLI/model. New managed tasks still pass the classifier and routing table. Dot can select a particular existing run:

```text
nash dot attach --workspace <workspace-ref> --run <run-id> --objective-file <file> --access read_only
```

Use the existing run's access level; attaching cannot upgrade it. Obtain workspace references and run IDs from NASH's workspace/run views or CLI. See `nash dot --help` and `nash orchestration --help` for commands.

The coordinator reviews its worker permissions with `nash orchestration permission-list` and `permission-answer`. Dot reviews ordinary coordinator requests. Critical requests need the user's confirmation in NASH or the native CLI.

## Hook activation

NASH installs permission hooks for Claude Code, Codex and AGY during local application startup. Claude uses the selected/inherited account directories. Managed status hooks remain a separate Claude-only integration.

New sessions load hooks under the provider's normal rules. Existing sessions may need a native hook refresh or trust confirmation; NASH does not restart them. Codex only auto-trusts the exact NASH-owned permission hook after vendor hash verification.

If the hook, application or valid NASH session context is unavailable, permissions fall back to the native CLI. An unanswered relayed AGY request uses `force_ask`; ordinary out-of-session fallback uses `ask`. This release does not install permission hooks on SSH/WSL hosts.

## Turn Dot off and stop work

- **Settings → Dot** controls the local interface, allowed workspaces and each workspace's maximum access.
- Remote access has its own switch and pairing controls. Disable it to stop polling; revoke the pairing to invalidate its remote credentials and queued authority.
- Disabling local Dot also prevents remote submissions from being admitted. Revoked or reduced access blocks held messages before delivery.
- Turning access off does not terminate an already-running CLI. Use the native run/terminal controls to stop it.
- Canceling an attached Dot request does not kill the existing user-owned coordinator; NASH refuses that cancellation. A separate detach operation is not implemented.
- An unconfirmed process stop stays visible as unverified; it is not reported as success.

## Local data

| Location on Windows | Contents |
|---|---|
| `%APPDATA%\nash` | Packaged application settings and orchestration database |
| `%APPDATA%\nash-dev` | Development profile |
| Profile `routing-table/` | Current index, immutable configuration versions and availability state |
| Profile `primary-sessions/` | Generated coordinator settings |
| Profile `autopilot-reviews/` | Independent reviewer output |
| Profile `dot-ingress-runtime.json` | Current local Dot endpoint discovery and token |
| `~/.nash/` | NASH hook scripts, sealed credentials and other shared app state |
| `%LOCALAPPDATA%/NASH/daemon-host` | Terminal daemon runtime |

Provider account management uses Orca's native implementation, including the Windows AGY credential adapter. Do not treat NASH's profile as the provider's login directory.

Quit the application before making a database backup. Copy the profile's database together with any WAL/SHM files. Do not remove a live profile to fix a routing error. Historical development layouts without an explicit migration are not supported.

## Development checks

From `desktop/`:

```powershell
$env:ORCA_BACKGROUND_LAUNCH='1'
node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.node.json
node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.tc.cli.json
node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.tc.web.json
node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts <test-path>
node config/scripts/check-changed-code-quality.mjs HEAD
```

These entry points use installed dependencies when a package-manager shim cannot run. They do not install dependencies. Follow [desktop/AGENTS.md](../desktop/AGENTS.md), keep agent-launched windows hidden, and use disposable profiles for launch tests.

The normal Windows release entry point is `pnpm build:win`. Packaging verifies native terminal ownership, daemon loading, plugin resources and CLI dependencies. When publishing an authorized release, include the installer, blockmap, generated update metadata (`latest.yml` for stable Windows releases) and SHA-256 checksums after those checks pass.
