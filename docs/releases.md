# Releases and verification

## v1.4.218 — 2026-10-09

[Windows x64 release](https://github.com/p1nbored/NASH/releases/tag/v1.4.218).

- Enables native stable/RC update checks against `p1nbored/NASH`, including updater metadata in the release assets.
- Restores the official Orca plugin catalog and safety-feed lifecycle, retaining NASH names and profile directories.
- Opens feedback and crash reports as prefilled NASH GitHub Issues. The user submits in the browser; opening a draft is not recorded as a sent report.
- Reuses native message serialization/status events and coordinator bindings. Manual routed Claude/Codex workers honor native structured-chat preferences; Auto retains the terminal permission transport.

Node, CLI and Web typechecks and changed-code quality checks passed. Focused runtime-reuse verification passed 722 tests. Update/catalog/report verification passed 397 tests, with 24 platform/environment cases skipped; plugin filesystem tests passed outside the Windows sandbox after its temporary-file rename restriction prevented the sandboxed run. Localization catalog/extraction checks passed.

Assets: `nash-windows-setup.exe`, its `.blockmap`, `latest.yml`, and `SHA256SUMS.txt`. Exact asset checksums are provided in the release. The installer is unsigned. Builds before v1.4.218 require one manual upgrade because they have no enabled update feed. No macOS/Linux installer is included. Real provider CLI approval and a full installed-app update cycle remain outside the verified scope.

## v1.4.217 — 2026-10-09

[Windows x64 release](https://github.com/p1nbored/NASH/releases/tag/v1.4.217).

Fixes orchestration updates that reported all skills current while NASH still marked the installed skill outdated. New installs use NASH's desktop/skills source; desktop and global CLI updates migrate selected, unpinned upstream registrations before updating. Other registrations, installed hashes and user-pinned refs are preserved. The dialog's copied retry command follows the same NASH CLI migration path.

Validation: 282 tests passed, 4 skipped across 20 relevant files. Node, CLI and Web typechecks and changed-code quality gates passed. The isolated Windows build passed package dependency, native terminal, daemon entry, plugin and packaged CLI smoke checks. The packaged version and source migration were also verified.

The Windows x64 installer remains unsigned and automatic updates remain off. No macOS/Linux package or orcad template is included. This release excludes unrelated in-progress workflow changes in the primary checkout.

| Asset | Size / SHA-256 |
|---|---|
| nash-windows-setup.exe | 259214898 bytes; dc5983f0e62d3b17207eedd9c58b0efd627814bbe994ad0416a37d7e9227cb75 |
| nash-windows-setup.exe.blockmap | 264254 bytes; 26f652ab87d67aa76fcdb9644173bf52a6bec97389ff5c51ff739af5649527bf |
| SHA256SUMS.txt | Installer and blockmap checksums |

## v1.4.216 — 2026-10-08

[Windows x64 release](https://github.com/p1nbored/NASH/releases/tag/v1.4.216). Source is pinned by the `v1.4.216` tag.

This update adds the saved **Auto** permission mode, connects manual/automatic review behavior, and replaces routing model text fields with CLI model lists. **Refresh model list** reads all routing providers; the Claude workflow supports its Claude model and thinking level. The orchestration skill installer was left unchanged as requested.

| Asset | Size / SHA-256 |
|---|---|
| `nash-windows-setup.exe` | 259,321,620 bytes; `351a6a964cc773178c731fb3a23367d82cbf4765250adb2e55006fb16aad37a5` |
| `nash-windows-setup.exe.blockmap` | 264,761 bytes; `374ef2328b1d6ea6ad3367213463f1e5d70aca2de1aba73af983647ee3a12a4e` |
| `SHA256SUMS.txt` | Checksums for the installer and blockmap |

The installer is unsigned and automatic updates remain off. No macOS/Linux package or cross-platform prebuilt orcad template is included.

## Verification

- 120 affected test files: **1,559 passed, 1 skipped**. Covers permission modes, persistence, routing, workflows, onboarding, paired clients and localization.
- Desktop Node, CLI and Web typechecks passed.
- Changed-code quality, React Doctor, design-system, localization and generated RPC catalog checks passed.
- CLI, desktop, relay, projected web, mobile web and Windows installer builds completed.
- Packaged version, native terminal ownership, daemon loading and plugin checks passed; packaged CLI help/skills checks use a temporary copy.

## Scope

Auto enables supported hooks in NASH-managed runs. Custom launch arguments retain their permission behavior; unsupported or unmanaged sessions use native manual prompts. Managed runs keep their access ceilings. Native launch presets affect new sessions, while changing away from Auto also stops pending relay decisions.

Real provider approval, routing and takeover have not been exercised end to end. The Windows AGY adapter was previously tested with disposable credentials; real two-account switching remains unverified. SSH/WSL permission-hook installation and a fresh packaged GUI end-to-end test are outside this release's verified scope.

No hosted Dot Site deployment was performed. See the [separate deployment record](dot-mcp.md#deployment-record).

Earlier notes and installers, including v1.4.215, remain on [GitHub releases](https://github.com/p1nbored/NASH/releases). Superseded local plans and checkpoints remain in Git history.
