# Design harness

Renders the real renderer source (`src/renderer/src`) under a fixture-only preload API so design captures show actual Orca components without Electron, the runtime daemon, PTYs or user data. It exists for the Discover / Define / Deliver design process; it is not product code and is never built into `out/`.

## Boundaries

- `fixture-api.ts` composes the web client's local-storage APIs (settings, keybindings, onboarding, UI) with scenario fixtures. Every other preload method falls back to the web client's neutral defaults and is logged as `[harness-fallback]` in the browser console.
- `base-fixtures.ts` and `scenario-workspace.ts` hold synthetic `FIXTURE_ONLY` state: two projects, four worktrees, and two terminal tabs whose PTY replays a scripted, labeled transcript through real xterm.js. Paths are `C:/fixtures/...`; nothing reads the filesystem or a runtime.
- `scenario-workbench.ts` and `scenario-workbench-runs.ts` answer the Workbench RPCs (requests, runs, run messages, permission prompts) with `FIXTURE_ONLY` data. Pick a state set with `?workbench=overview` (default), `ended`, `errors` or `empty`. Stop, Allow, Deny and Send return fixed fixture outcomes so each result state can be captured.
- `scenario-workbench-tasks.ts` and `scenario-workbench-transcripts.ts` answer the task list and task window RPCs (D-024) for `fixture-run-006` in the `overview` set: a Codex task with a failed and a live attempt (the live one gains a line per read and never ends), agy plain lines, a truncated transcript in its own worktree, an empty transcript and a malformed line. All transcripts are synthetic section 1.1 records.
- The Vite server binds `127.0.0.1`, uses the renderer's own root so Tailwind scans the same sources, and runs in a fresh Playwright browser context per capture. No `~/.orca`, `%APPDATA%` profile or daemon is touched.
- A capture is renderer evidence with fixture data. It is not proof that a live terminal, agent, Clef route or integration works.

## Use

```powershell
node tests/tools/design-harness/capture.mjs --out ../../.local/define/<round>/captures `
  --themes light,dark --views terminal,settings --viewports 1440x900
node tests/tools/design-harness/probe.mjs <out.png> [width] [height] [waitMs] [?query]
```

Run from `desktop/orca`. Without `--tokens`, only the `baseline` direction (the shipped tokens) is captured, into the round folder that `scripts/design/critic-round.mjs` reads.

`capture.mjs` writes PNGs and `capture-manifest.json` (renderer-and-harness tree digest, token hash, Chromium version, observed viewport/DPR/scroll/fonts/effective settings, image hashes, page errors). It uses the locally cached Playwright Chromium (`DESIGN_HARNESS_CHROMIUM` overrides the path) and never downloads a browser.

Known noise: one page error per capture because the fixture PTY does not answer a size reassertion.
