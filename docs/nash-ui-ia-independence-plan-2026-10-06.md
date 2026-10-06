# UI, settings, dot, agy, Orca compatibility and NASH independence: issues and plan

Date: 2026-10-06. Source: the user's request of 2026-10-06 ("Record these issues and prepare an implementation plan. I approve the plan and you can execute."). Investigations were read-only; file references are relative to `desktop/src/` unless stated.

## 1. Issues

| ID | Issue | Area |
|---|---|---|
| I-01 | Follow `CLAUDE_CODE_FRONTEND_DESIGN_PROMPT.md`: warm, quiet, editorial, terminal-first workspace | Frontend |
| I-02 | One design language through semantic tokens and reusable variants: fonts (multilingual), sizes, spacing, 6-10 px radii, dividers, buttons, inputs, states, colours; no scattered hard-coded styles | Frontend |
| I-03 | New interfaces and settings fit Orca's UI and are more concise: fewer cards, borders, badges, helper text and developer terms; no internal IDs or implementation details (such as route tables) in the UI | Frontend |
| I-04 | Complete translations for all new content; check layouts in every supported language | Frontend |
| I-05 | Replace the application icon with the user's icon (`~/Desktop/icon.png`, 1254x1254) | Frontend |
| I-06 | All dot settings in one dedicated Settings category | IA |
| I-07 | Hide the Orca Account and Mobile interfaces for now | IA |
| I-08 | RSI belongs in the main left navigation, hidden until its backend exists; no invented data | IA |
| I-09 | Explain what the Workbench is for and whether it relates to RSI | IA |
| I-10 | Onboarding checklist matches the current app | IA |
| I-11 | dot reports no write capability although the workspace allows writing | dot |
| I-12 | agy account switching on Windows: "Native Antigravity account switching is not supported on this host yet..." | CLI |
| I-13 | Explain the restrictions and modifications applied to CLI use; report each other CLI and harness | CLI |
| I-14 | Keep Orca's plugins, terminal, worktree, editor, browser, diff, GitHub and Linear working | Orca |
| I-15 | Check whether the plugin mechanism is broken; prefer a compatibility adapter over removal | Orca |
| I-16 | Independent project at `C:\Programs\NASH`, remote `https://github.com/p1nbored/NASH.git` | NASH |
| I-17 | NASH data, issues, update sources and release logic trace to that repository | NASH |

## 2. Findings

**I-11 dot write.** The per-workspace maximum ("Workspace write") governs the local dot interface only. The remote path that ChatGPT dot uses has a separate cap, `DOT_REMOTE_SUBMIT_ACCESS_CAP = 'read_only'` (`shared/dot-remote/dot-remote-defaults.ts:10`). The cap shapes the generated tool schema (`requestedAccess` enum `["read_only"]`), the tool description ("Remote tasks may only read"), the Site's validator and a second desktop check (`main/runtime/dot-remote/dot-remote-item-checks.ts:49-59`). The workspace maximum is never sent to the Site. This was the recommended default of remote-plan decision 3 (`docs/dot-mcp-remote-plan.md` section 10), which still awaits the user. Also, the Site's MCP `initialize` answer still names `nash-local-scaffold` with "No real NASH device or task execution is connected" (`sites/nash-dot-mcp/lib/mcp-scaffold.ts:104-106`).

**I-12 agy on Windows.** Windows is refused before any work (`main/antigravity/native-credential-backend.ts:58-62`). agy on Windows keeps its login in Windows Credential Manager (generic credential `gemini:antigravity`, raw JSON, at most 2,560 bytes), not in a file, and has no home-folder variable, so Codex's per-account `CODEX_HOME` approach cannot apply. A fix needs a narrow Credential Manager reader and writer for that one item, mirroring the macOS Keychain adapter (`native-macos-credentials.ts`). The repository already builds a Windows N-API addon (`native/windows-registry`), and MSVC is installed. The launch guard also compares `HOME` instead of `USERPROFILE` on Windows (`native-account-launch.ts:36`).

**I-13 CLIs.** Every CLI in Orca's catalog (45) still launches by hand in a terminal as in Orca. Only Claude Code, Codex and agy are installed on this machine. Only Claude (primary session, subagents, workflows, reviewer), Codex (`codex exec`) and agy (`--print`) take NASH tasks. Other CLIs lose NASH-managed status hooks (D-032) and usage meters (D-029); Claude loses account switching (D-030). Undocumented so far: routed Codex runs pass `--ignore-user-config --ignore-rules` (`main/codex-exec/codex-exec-argv.ts`), so the user's Codex MCP servers, profiles and rules are not loaded there; the Claude reviewer's environment drops `CLAUDE_CONFIG_DIR`. No route has run live.

**I-14, I-15 Orca compatibility.** The plugin mechanism is intact: `main/plugins/`, `shared/plugins/`, the plugin IPC, preload and RPC are byte-identical to Orca 995715b1. Gaps: the official marketplace is not seeded and the plugin safety list is not refreshed (D-028), so the list fails open; NASH's own data folder (D-017) does not see plugins installed in a real Orca. Terminal, worktree, editor, browser, diff, GitHub and Linear are preserved; Linear keys moved to `~/.nash`, so Linear must be reconnected once.

**I-09 Workbench.** The NASH Workbench is the right-sidebar tab where the user starts local requests and follows NASH runs: permission prompts, validations waiting for a decision, run tasks and their windows, follow-up messages and stop. It is not related to RSI; it only hosts two "Not connected" RSI placeholders (`components/right-sidebar/WorkbenchPanel.tsx:29-51`). There is no RSI data, fixture or left-navigation entry.

**I-10 Onboarding.** The checklist (`shared/feature-wall-setup-steps.ts`) has eight Orca items. "Choose your default agent" only affects manual terminals, "Give agents NASH skills" installs Orca's retired orchestration skill and Computer Use, and nothing covers Claude Code, Clef, routing or dot.

**I-02, I-04, I-05.** No CJK fonts in any stack and no `lang` on `<html>`. No type-scale tokens (sizes are Tailwind defaults plus arbitrary pixels). NASH-added components use few hard-coded styles (25 arbitrary text sizes, 2 pill chips). NASH strings go through i18n but exist only in `en.json`: about 900 keys are missing from each of zh, ja, ko, es and fr. Every icon is still Orca's.

## 3. Plan

Work packages, in order. Packages marked parallel run as separate agents on disjoint files; locale catalogs are edited only in package P7.

- **P0 Repository.** Create `C:\Programs\NASH` as the canonical working copy with remote `origin` = `https://github.com/p1nbored/NASH.git` (private, empty). History: (1) Orca's untouched files at 995715b1, (2) NASH as of 2026-10-06 before this plan, (3) one commit per package below. Runtime state, `node_modules`, build output and `.local/` stay out. `C:\Programs\autopilot` is left untouched as the archive.
- **P1 Foundation (parallel).** Tokens in `main.css`: type scale (11/12/13/14 px controls, 18-24 px display), spacing roles, radii 6/8/10 px, multilingual font stacks with per-language CJK fallbacks, status tokens. Set `<html lang>` from the UI language. Align `ui/` primitives (card, badge, input) with the tokens. Update `DESIGN.md`.
- **P2 Information architecture (parallel).** A "Dot" Settings category holding every dot card; one flag hiding Orca Account and Mobile everywhere (Settings, sidebar button, page, menus, toasts, sign-out card) without deleting code; RSI entries in the left navigation behind a flag that stays off, with the Workbench placeholders removed; update entry points hidden while updates are off (D-026); Help menu links to the NASH repository.
- **P3 Concise NASH surfaces (parallel).** Subtraction pass on Workbench, task window, routing, Clef, dot and usage UI: fewer cards, borders and badges; human messages instead of raw codes; IDs, hashes and versions moved behind a "Copy details" action; token classes instead of arbitrary values.
- **P4 Onboarding (parallel with P3).** Checklist items that match NASH, each done from a real signal.
- **P5 agy on Windows (parallel).** `native/windows-credentials` N-API addon (`CredReadW`/`CredWriteW`, one fixed target, size cap, read-back), win32 backend, `USERPROFILE` launch guard, tests with a fake store; any real test uses a disposable target, never `gemini:antigravity`.
- **P6 dot write (parallel, after the user's choice).** If remote write is allowed: cap raised to `workspace_write`, still limited by each workspace's maximum; tool text, rules, goldens and vectors regenerated; Site `initialize` text fixed; a handover for the user's Codex to redeploy the Site.
- **P7 Translations.** After P1-P6: sync the catalog, then translate every NASH key into zh, ja, ko, es and fr (one agent per language); a test that fails when a NASH key is missing in any language; screenshots of Settings and the Workbench in en, zh, ja and fr, light and dark.
- **P8 Icon and identity.** Icon set from the user's image (PNG 256 and 1024, ICO, ICNS, titlebar and in-app logo); Orca's whale variants no longer offered. Release repository `p1nbored/NASH` recorded in the app identity; issue links point there; the update feed stays off (D-026), because the private repository's releases cannot be read without sign-in.
- **P9 Plugin adapter.** An opt-in "Use Orca's plugin catalog" switch in Plugins settings, off by default, that seeds Orca's official marketplace and refreshes its safety list through the existing services. No plugin code is removed.
- **P10 Verification and delivery.** Type checks, affected test suites against the known baseline, localization checks, code and security review, secret scan, then push `main` to `origin`.

## 4. Decisions

The user answered on 2026-10-06:

1. Remote write for dot: up to each workspace's maximum (D-034).
2. Task routing stays in Settings, with per-task choices, less text and a cleaner layout (D-035).
3. The app folder is `desktop/`, formerly `desktop/orca/` (D-036).
4. The build briefs stay outside the repository (D-036).

D-037 to D-039 record the agy adapter, the navigation changes and the plugin catalog opt-in.
