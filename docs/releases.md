# Releases and verification

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
