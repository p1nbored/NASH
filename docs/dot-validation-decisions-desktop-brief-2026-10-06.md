# G7 brief: dot may waive or reject inconclusive validations

## Authorization (user, verbatim, 2026-10-06)
- "Add this capability to dot and prepare the handover documentation; I will have Codex handle the redeployment"
- The question was: "For each result waiting for a decision, what may dot see? (Rule U32 currently limits dot to the coarse run state.)" The user's answer: "Title, reason, summary". The option said: "Also sends the primary's short task report or the reviewer's one-line reason, after a content scan." This is a narrow exception to U32 (architecture §13.2: "dot gets the coarse run state only"). It applies to pending validation decisions only.

## Exposure per pending decision (nothing else)
- `validationId` (opaque) and `dotRequestId`.
- `title`: the TaskSpec title, or the objective's first line if there is no title. At most 200 code points. Credential-like text is masked and terminal controls neutralised.
- `reason`: a fixed code vocabulary mapped from the internal inconclusive reasons (for example `claim_only`, `primary_did_task`, `review_unavailable`, `checks_inconclusive`, `report_missing`). An unmapped reason becomes `other`.
- `summary`: at most 500 code points.
  - Source: the primary's `task-report` text for an in-session task, the reviewer's one-line reason for a model review, or the inconclusive reason line for a process check.
  - It passes a content scan first: NASH's secret masking plus Clef's name and path masking, if that can be reused cleanly. Otherwise use secret masking plus a path masker built on Clef's rules, and report which.
  - If the secret scan still flags it, send `summary: null` and `summaryWithheld: true`.
- `createdAt`.
- Never sent: paths, worktree, branch, base commit, model, route, effort, artifacts, deliverable contents or progress.

## Rails
- dot may list and decide only validations of runs dot started (same rule as cancel, message and answer).
- Writes count against the dot rate limits like other writes.
- `decisionId` (uuid) is the idempotency key: a replay returns the first outcome, and the same id with a different decision is refused.
- Outcomes mirror `decisions.answer`: decided, already decided, not found, closed.
- A waive or reject goes through G6's decision service with `by: 'dot'`, and it files the same notice to the primary: the merge notice for a waived write task in its own worktree, branch-left on reject, and folder wording.

## Layers
1. **Local dot contract v3.**
   - Methods `dotIngress.validations.list` and `dotIngress.validations.decide`, with the exact names chosen to fit the existing method naming.
   - A new byte-frozen golden `shared/dot-ingress/dot-ingress-contract-v3.schema.json`. The v1 and v2 goldens are not touched.
   - `hello` with `contractVersion: 3` lists the new methods, and v1 or v2 callers do not see them.
   - Error codes stay within the `dot_*` sanitizer rules.
   - The hidden local `dot` CLI gets matching commands, with text from a file or stdin only.
2. **dot remote.**
   - The R1 sync agent relays the new inbox item kinds to the local endpoint and posts new allowlisted event kinds back (decision pending, decision settled) with exactly the fields above.
   - Regenerate the R2 contract artifacts in `shared/dot-remote/` with their generator (find it; never hand-edit generated files): tool manifest, envelope schemas, endpoint table, conformance vectors and the new manifest hash.
   - Update the desktop's pinned manifest hash and anything that checks it.
3. **Site `sites/nash-dot-mcp`** (Codex wrote it; keep its style and read its README first).
   - `node scripts/pin-remote-artifacts.mjs`, then `node scripts/compile-remote-schemas.mjs`. Then implement the new MCP tools and routes, storing pending decisions in the existing bounded snapshot (keep the 1 MiB cap, the revocation headroom and the pairing reserve) and ingesting the new events.
   - Same identity rules as the other data-bearing tools.
   - Tests: `node --import=file:///<scratchpad>/spawn-guard.mjs --experimental-strip-types --test tests/*.test.ts` from the Site folder. Typecheck: `node node_modules/typescript/bin/tsc --noEmit`. Also run `node scripts/verify-remote-bundle.mjs` and `node scripts/compile-remote-schemas.mjs --check`.
   - Do NOT run npm, the build, wrangler or any deploy, and do not contact the Site or any network.
   - If the Site needs a new migration, add it as a new file. Never edit applied migrations.
4. **Handover doc** `C:/Programs/autopilot/docs/dot-validation-decisions-handover-2026-10-06.md`, for Codex:
   - what changed and why, with the user's U32 decision;
   - every changed file, on the desktop and the Site;
   - the old and new manifest hashes;
   - pre-deploy checks (tests, typecheck, verify and compile `--check`, build);
   - deploy steps consistent with `docs/dot-mcp-sites-deployment-2026-10-05.md` (same Site and project, owner-private access unchanged, migrations once only);
   - post-deploy verification (the tool list shows the new tools, manifest hash, owner-only access, a read-only list call);
   - rollback to the previous saved version (`appgprj_6ac3a8b0f2288191aa84fbc93a316f8e~appgver_8bb4fc115f9081918861207a2f7b92aa` or the current one, whichever is live);
   - that the desktop app must be rebuilt with the new pin before pairing;
   - secrets rules: no token in source or docs; the user rotates the Cloudflare token first.
5. **Docs:** architecture.md §13 (the v3 row, the U32 exception) and §14 (the new tools and events). Do not edit the decision log.

## TDD
Write failing tests first for:
- the v3 methods and the golden;
- the rails (other-origin run, replay, conflict);
- the exposure, including the masking and the withheld summary;
- the sync relay and events;
- the regenerated contract vectors;
- the Site tools.

## Standard rules
Same as the G6 brief:
- tests through the safe runner only, with guard_blocked 0;
- no pnpm, npm or npx; no cmd or PowerShell; repo scripts under the spawn guard;
- no git write commands;
- CRLF kept; locale JSON edited only with the Edit tool;
- archive to `C:/Programs/autopilot-archive/2026-10-06/g7-dot-validation-decisions/`;
- GateGuard facts before each first edit;
- stop on a permission refusal;
- no max-lines disables.

## Exit checks
As in wp-brief.md, plus the Site checks above.

## Report
Save it to scratchpad/wp-g7-result.md.
