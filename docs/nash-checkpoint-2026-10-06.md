# NASH checkpoint, 2026-10-06 (EDT)

> Historical checkpoint. Work resumed; see [the current delivery report](nash-delivery-2026-10-08.md).

Work is stopped at the user's request ("stop here and i will resume later", then "set the checkpoint"). Nothing is running. The working tree was clean when this was written; the only commits are the four listed below, and nothing is pushed.

Read with: `docs/nash-ui-ia-independence-plan-2026-10-06.md` (issues I-01 to I-17, findings, packages P0-P10) and `docs/decision-log.md` D-034 to D-039.

## Repository state

- `C:\Programs\NASH`, branch `main`, remote `origin` = https://github.com/p1nbored/NASH.git (private, still empty on GitHub).
- Commits: `8105599b` Orca 995715b1 untouched under `desktop/`; `14538fa8` NASH as of 2026-10-06 (from `C:\Programs\autopilot`); `c4eebf5a` plan, D-034 to D-039, `desktop/orca` paths renamed to `desktop`; then this checkpoint.
- Toolchain: `desktop/node_modules` (pnpm layout, 1.8 GB) and `sites/nash-dot-mcp/node_modules` were copied from autopilot. robocopy could not create the 4,036 pnpm symlinks (error 1314), so they were recreated with Node (relative targets kept). `tsc -p config/tsconfig.node.json` passes in the new location (27 s, exit 0). The web and cli configs were not rerun here.
- `C:\Programs\autopilot` is untouched apart from the plan document added at the start of this session; it keeps the four build briefs, `.local/` and the Site's hosting checkout (`sites/nash-dot-mcp/.git`).

## Done

- P0 Repository (D-036).
- Read-only investigations for every issue; findings are in the plan, section 2.
- Decisions D-034 (remote dot write up to each workspace's maximum), D-035 (routing stays in Settings, simplified), D-036 (this repository, `desktop/` layout, briefs kept local), D-037 (agy Credential Manager adapter on Windows), D-038 (dot category; Orca Account, Mobile and RSI hidden; onboarding; update entries), D-039 (opt-in Orca plugin catalog).

## Stopped before any edit

Seven agents were started and then stopped while still reading; none changed a file. Each needs a restart with the same scope:

| Package | Scope | Owns |
|---|---|---|
| P1 | Tokens and primitives | `assets/main.css`, `components/ui/**`, document `lang`, font stacks, `DESIGN.md`, `desktop/docs/STYLEGUIDE.md` |
| P2+P4 | Navigation, settings and onboarding | settings registry and sidebar, IntegrationsPane, new Dot and Task routing categories, Orca Account/Mobile and RSI flags, Help menu, app and tray menus, app identity `releaseRepository`, onboarding checklist, WorkbenchPanel RSI removal |
| P3-settings | Routing, Clef, dot and usage settings surfaces | `settings/routing-table-*`, `clef-*`, `dot-ingress-*` (not search), `dot-remote-*`, usage sections |
| P3-workbench | Workbench and task window | `right-sidebar/Workbench*` (not WorkbenchPanel), `workbench-*`, `task-window/**` |
| P5 | agy on Windows | `native/windows-credentials` (new N-API addon), `src/main/antigravity/**`, workspace and packaging entries |
| P6 | Remote dot write | `shared/dot-remote/**`, `main/runtime/dot-remote/**`, dot-ingress as needed, generators, `sites/nash-dot-mcp/**`, a new handover doc |
| P9 | Orca plugin catalog switch | `main/startup/main-process-plugins.ts` and an adapter, one global setting, the Plugins settings switch |

Shared rules for those agents: only owned files; no locale catalog edits (P7 syncs and translates once at the end); `translate('key', 'English')` for new strings, with a new key when English changes; Edit tool or EOL-preserving node scripts (many files are CRLF); tests only through the guarded runner; no commit, push, app launch, `pnpm install` or network.

Token utility names fixed for all packages (P1 implements them):

- Text: `text-caption` 11/16, `text-meta` 12/16, `text-body` 13/20, `text-body-lg` 14/20, `text-heading` 15/22, `text-title` 20/28 (with `font-display`), `text-display` 26/34.
- Spacing: `row` 8 px, `group` 16 px, `section` 24 px (`p-row`, `gap-group`, `mt-section`).
- Radii: `rounded-sm` 4, `rounded-md` 6 (controls), `rounded-lg` 8 (cards, panels), `rounded-xl` 10 (dialogs); larger radii capped at 10.
- Colours: `hover`, `selected`, `selected-foreground`, `control-border`, `disabled-foreground`, `status-error`, `status-error-background`, `status-error-border`, next to the existing success and warning families.

## Not started

- P8 Icon and identity. Source: the user's `C:\Users\Administrator\Desktop\icon.png` (1254x1254, RGBA). Its card sits at about (184,166)-(1068,1056) with alpha 253 inside, surrounded by a noisy semi-transparent halo (alpha 16-200, roughly 70 px wide). Intended approach: drop the halo by remapping alpha 200-253 to 0-255, then build `resources/build/icon.png` (1024, card at about 80 % of the canvas), `build/icon.ico` through `config/scripts/trim-windows-icon-source.mjs`, `build/icon.icns` with Pillow, `resources/icon.png` and `icon-dev.png` (256), a monochrome N mark for `resources/logo.svg` and the macOS tray template, and only the NASH icon offered in `shared/app-icon.ts`. Tools here: Python Pillow 12.2 and pngjs; no ImageMagick or sharp.
- P7 Translations, P10 verification, review, secret scan and the first push.

## Resume order

1. Restart P1, P2+P4, both P3 packages, P5, P6 and P9 in parallel with the scopes above.
2. P8 (icon), which overlaps none of them.
3. P7: sync the catalog, translate the NASH keys into zh, ja, ko, es and fr (one agent per language), add a missing-key test, capture Settings and Workbench in en, zh, ja and fr, light and dark.
4. P10: three tsc configs; affected test suites through the guarded runner, compared with the D-016 baseline; code and security review; secret scan; one commit per package; push `main` to `origin`.
5. Hand the dot Site redeploy (P6 handover) to the user's Codex. Until the Site and NASH run the same contract, dot shows NASH offline.

## Working files (outside the repository)

Session scratchpad `C:\Users\ADMINI~1\AppData\Local\Temp\claude\C--Programs-autopilot\d58be37e-3966-4113-abb6-6b3a457e2123\scratchpad\`:

- `tools/run-vitest-safe.mjs`: the guarded test runner, pointed at `C:/Programs/NASH/desktop`. It needs `spawn-guard.mjs` and `excludes.json` beside it. `d016-baseline-failures.json` is also there. Usage: `node tools/run-vitest-safe.mjs <label> <paths> --reporter=dot`.
- `relink.mjs`: recreates pnpm symlinks after a copy.
- `rename-paths.mjs`: the EOL-preserving path rewrite.

The originals of the runner and guard are in the 2026-10-06 earlier session scratchpad `a54c669a-e3f0-463a-b709-49d369a344a6\scratchpad\`.
