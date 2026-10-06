# NASH checkpoint, 2026-10-05 11:40 (EDT)

All work is stopped at the user's request: "stop all tasks first, record the current status to establish a checkpoint, and I will come back to resume the tasks later". Nothing is committed. No agent, test run, build or browser started by this work is still running.

Read with: `docs/decision-log.md` (D-016 to D-025 are the current direction), `docs/architecture.md`, `docs/nash-operations.md`, `docs/dot-mcp-remote-plan.md`.

## Code state

- Type checks pass for the node, web and cli configurations (11:38, exit 0 each).
- No package is half-applied. The removal job (X2) was stopped before its first source edit: all 61 files it snapshotted still match. An earlier attempt (X1) had restored its edits byte for byte.
- Last broad test results:
  - Main process (10:40): 559 files, 6,166 tests; 6,062 pass, 88 fail, all in 16 files listed in the D-016 baseline, each at or below its baseline count.
  - Renderer, full suite (10:47, taken before the rename job fixed its stale tests): 187 of 4,258 files failed (965 of 36,373 tests). There is no renderer baseline, so the number of pre-existing failures is unknown. The rerun after the fixes was interrupted by the stop.
- NASH has never been built as a desktop app (`desktop/orca/out/main` does not exist) or launched, and has never run against a real Claude Code, Codex, agy, Clef or dot session.

## Done, tested with fakes only

Reports are in the scratchpad copy (see "Working files" below), named `wp-<package>-result.md`.

- Execution core: Orca runs, tasks and attempts as the single authority (B1-B5, A1-A7); Clef classification and the versioned Routing Table (A1, K1 removed the Clef caps per D-022, V1 route availability); executors for Codex (`codex exec`, read-only), agy (`--print`) and in-session Claude (C1-C4); validation by checks or a different-model review (C5); permission prompts relayed to dot or the desktop (D2); one visible Claude primary session per run, with mid-run messages (D1, D3, D-019).
- dot: local interface with its own pipe and token, contract v1 frozen and v2 (D4, A6); recovery admission fix (D4 recovery).
- Remote mailbox: sync agent with pairing, short polling, leases, outbox and a rotating device credential stored sealed (R1, R1 follow-up); generated contract, tool manifest and conformance vectors (R2, R2 follow-up; manifest SHA-256 `fbfc682d...`).
- Startup wiring with no live action at startup (E1); docs annotations (E2); NASH identity and folder names `.nash`, `.nash-relay`, `.nash-remote` (ID, ID2).
- Screens: Workbench runs, stop, messages and permission prompts (UI-A); Routing Table and Clef verification settings (UI-B); dot settings (UI-C); Remote access card with pairing (UI-7); executor trust card (P1, to be removed by X2).

## Stopped mid-way

1. **UI-6, visible "Orca" text to "NASH".**
   - Done: the source rename, the runtime-required catalog regenerated, stale tests updated, type checks clean at 11:07.
   - Repaired: it broke three terminal files at 09:50 (escaped `\r\n` turned into raw line breaks inside string literals), then repaired them at 10:22. The strings still need a check that they say what they did before: `hidden-output-restore-limits.ts`, `startup-cwd-fallback-notice.ts`, `pane-terminal-output-queue-registry.ts`.
   - Not done: triage of the renderer suite after its fixes, the code review of its logic changes, and its report.
   - Working lists: `ui6/renamed-files.txt`, `ui6/touched-code.txt`, `ui6/touched-tests.txt`.
2. **X2, carrying out D-023 as amended.**
   - Scope: remove the executor trust package (P1), executable pins and the pre-spawn re-hash (C4, C5), the binary hashing in `collectExecutableEvidence`, and the refusals that stop a CLI whose installed launcher is a script. Codex goes back to its own launcher: `resolveCodexExecutable: () => resolveCodexExecutable({ kind: 'installed' })`.
   - State: snapshots only (`x2/pre-edit`, `x2/files.txt`), no edits. Archive: `C:/Programs/autopilot-archive/2026-10-05/x1-executable-pin-removal/`, whose README still says the removal is not applied.
   - The permission check refused two earlier attempts. The third launch, after the user's "continue to remove, I agree that", was accepted. The same brief can be relaunched.
3. **T1 scout (task window, D-024):** a read-only design scan, stopped before it reported. Rerun it.
4. **W1 (D-025: write mode, a worktree per writing task, merge):** not started; the design is proposed in D-025.

## Next steps when resuming (proposed order)

1. Finish UI-6: rerun the renderer suite through the safe runner, fix the tests its copy changes broke, check the three terminal files, review its logic changes, report.
2. Relaunch X2.
3. Rerun the T1 scout, then design T1 (task window) and W1 (write mode with worktrees) together and build them.
4. First desktop build; the user launches NASH and pairs it with the Site (Settings > Integrations > Tasks from dot > Remote access: Site address and the Sites service access token, pasted only there; then approve the code on the Site's `/pairing` page).
5. Cleanup (the F1 list below), then a security review and a TypeScript review.
6. Design critic, Define round: screenshot-only and isolated, then up to 2 revision rounds; then the Deliver audits.
7. Live gates G4-G9 and G-remote with the user. Rotate the Cloudflare token before any Clef use, keep Clef testing within the free tier plus US$5 (D-022), and re-check the flags of agy 1.2.16 (the G2 probe saw 1.2.14).
8. Packaging (Windows installer), only with the user's approval.
9. Then plan the RSI step (GEPA and Recuris optional and evidence-driven; Dream-RSI a placeholder).

## Remote mailbox (GPT Sites)

- Deployed owner-private by Codex: https://nash-dot-mcp.taojuguo.chatgpt.site, MCP at `/mcp`. It pins manifest `fbfc682d...`; 10 tools; 123/123 local tests. Details: `docs/dot-mcp-sites-deployment-2026-10-05.md`.
- Not yet verified: an online request outside the browser (Codex's probe timed out), the ChatGPT plugin connection (provisioned, not installed), pairing, and whether NASH's session headers pass Sites dispatch.
- User-side steps: connect the NASH Remote MCP plugin in ChatGPT and have dot call `nash_status` (expected: not paired, offline); have Codex generate the Sites service access token when NASH is ready to pair.
- Sites has no documented renewal for that token: when it is rotated, NASH stops polling and shows "reconnect" until the new token is pasted.

## Waiting on the user

- Authorization for the live gates G4-G9 and G-remote, and for the first desktop launch and pairing.
- D-025 merge policy: proposed, the primary Claude session merges a task's branch in its terminal and resolves conflicts there; the alternative is that NASH merges automatically and asks Claude only on a conflict.
- Open defaults:
  - remote submit access cap (currently read-only; the Remote access card's wording depends on it);
  - device credential lifetime (30 days);
  - at least one acceptance criterion required per TaskSpec;
  - the `coordinator_reasoning` row;
  - reviewer order;
  - benchmark source names and snapshot date;
  - D3 force-end;
  - recovered dot tasks;
  - Clef cut-offs and the 13 texts.
- Before any commit:
  - `sites/nash-dot-mcp` has its own `.git` (owned by the CodexSandboxOffline account), so the outer repository would record it as an embedded repository.
  - The Site URL and project IDs appear in docs of the public repository.
  - The two-commit provenance plan for the Orca snapshot.

## Cleanup list (F1)

1. TaskSpec limits (objective 8,000, 32 x 2,000) exceed the Clef state caps (2,000, 16 x 500): align D1's propose limits with a clear refusal.
2. Repoint the B1 clef-source-hygiene test and add the task-classification scope.
3. Fix the bundled-skill-guides "coordinator loop" wording.
4. Vitest real-home guard: add `.nash-relay` and `.nash-remote`. Test runs earlier wrote `~/.orca-relay` and `~/.orca-remote`; those folders are now archived.
5. Anti-slop renames: `hasSecretShape`, `maskSecretShapes`, `secretShaped`.
6. A2 per-decision expire.
7. A shared `resolveAppRunPrimary` (D1 and D2 duplicate it).
8. Move `route-rate-limit-refresh` and `route-provider-headroom` into `routing-table/`.
9. Decide on the dead `coordinator-escalation-triage` and decision-gates files.
10. Pass `workbench_*` data through for `stopCode`.
11. Validation backlog "check now".
12. An account-change invalidate hook.
13. Document the 64 pre-existing out-of-baseline failures.
14. Security review (relay, ingress, executors, table store, data boundary, remote sync) and a TypeScript review.
15. `DotWorkspaceLabelSchema` must refuse invisible characters (`\p{Cf}\p{Co}\p{Cn}\p{Cs}`).

Also:
- Remove the cast at `autopilot-runtime-install-order.test.ts:136`.
- Prune the 7 stale max-lines entries.
- Add the `/pairing` page path to the R2 endpoint contract.
- Optionally move `parseDotRemoteOrigin` into `src/shared`.
- Fix the focus LOWs in the remote card.
- `dot_remote_*` v1 schema: a development database created before the change needs its tables dropped.

## Working files and rules

- The session scratchpad is in the system temp folder. A copy of its reports (`wp-*.md`), the master tracker (`goal-plan.md`), the agent brief (`wp-brief.md`), tools, snapshots and screenshots is in `C:/Programs/autopilot-archive/2026-10-05/session-checkpoint/scratchpad/`. The tools resolve paths relative to their own folder.
- Tests run only through `run-vitest-safe.mjs` (spawn guard; `guard_blocked` must be 0). Never run vitest directly, call pnpm, npm or npx, or start cmd, `.cmd`/`.bat`/`.ps1` files or PowerShell during development runs: they tripped the user's antivirus. Run repo scripts with `node --import=<spawn-guard.mjs URL>`.
- Line endings: many `desktop/orca` files and `docs/decision-log.md` are CRLF. Edit them with the Edit tool or node scripts that count CR and LF; never `sed -i`. `wire-fmt-eol.mjs` must always get explicit file paths.
- Archive before deleting, under `C:/Programs/autopilot-archive/<date>/`, with a README and SHA-256 list.
- No commits, network calls, or live or billed runs without the user's authorization. Never read, copy or log vendor credentials.
