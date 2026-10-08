# Releases and verification

## v1.4.215 — 2026-10-08

[Published release](https://github.com/p1nbored/NASH/releases/tag/v1.4.215), Windows x64. Source tag points to `7ca35557e405e560474ebd1aa002fcee40a0959e`; the functional change is `bfacc321`.

Includes native coordinator adoption, Dot attachment, Claude/Codex/AGY permission review, editable reviewers, provider-specific effort choices and removal of the Star/Advanced UI and exclusive backend code. See the [feature comparison](nash-orca-feature-differences.md).

| Asset | Size / SHA-256 |
|---|---|
| `nash-windows-setup.exe` | 259,296,582 bytes; `bd7adb8379c8d9417c03f20d618e71a44d693f475141f29faaef6403105203ef` |
| `nash-windows-setup.exe.blockmap` | `d05f7d20dcd6c3160bc8dc103985ff4632469033d12130cce6e886bb3f6f7db1` |
| `SHA256SUMS.txt` | Checksums for the installer and blockmap |

GitHub's uploaded sizes and digests were matched to the local files before publication. The installer is unsigned and automatic updates remain off. No macOS/Linux package or cross-platform prebuilt orcad template is included.

## Verification for this release

| Area | Result |
|---|---|
| Permissions, coordinator, messages, migrations and startup | 73 files; 985 tests passed |
| Routing, classifier and related UI | 97 files; 1,557 tests passed |
| Dot local/remote and CLI | 62 files; 954 passed, 1 skipped |
| Site mailbox | 150 passed; generated contract checks passed |
| Types and quality | Desktop Node/CLI/Web and Site typechecks passed; changed-code, React Doctor and design-system gates passed |
| Builds | CLI, desktop, relay, projected web, mobile web and Windows installer completed |
| Packaged checks | Version, native terminal ownership, daemon loading and plugins passed; CLI help/skills passed from a temporary copy |

Test batches may overlap and are not added together as a unique total.

## Remaining verification

- Real Claude/Codex/AGY task approval and existing-coordinator takeover have not been exercised end to end.
- The Windows AGY credential adapter was previously tested with disposable credentials; real two-account switching remains unverified.
- This release did not deploy the hosted Dot Site. See its [separate deployment record](dot-mcp.md#deployment-record).
- The packaged GUI was not newly tested end to end for v1.4.215. The earlier v1.4.214 hidden startup check is not substituted for that verification.
- SSH/WSL permission-hook installation is outside this release.

Earlier release notes and assets remain on [GitHub](https://github.com/p1nbored/NASH/releases). Superseded local plans and checkpoints remain in Git history.
