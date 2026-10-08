# dot remote write: handover (2026-10-06)

Status updated 2026-10-08 UTC: current-only Site update is published privately from source `6bb5cbf6fd384d06fc779c43e9376a128de17818`, saved version `appgver_3d12a2ee1c588191a9eb3a495fa78271`. Remote contract 4 / ingress 3; manifest `4065156f3037753862e7eaa2ed075b30e39d8bc225e3fda4255690f1f2ea89af`. The actual MCP status tool reports this hash, paired=true and online=false. Removed deliverable-language fields and old snapshot/protocol compatibility; task coordination remains English. Site tests: 145 passed, typecheck/build passed. The older version-5 publication evidence below is historical. Current desktop integration and completed old-profile reset and required re-pairing are recorded in [the checkpoint](nash-checkpoint-2026-10-06.md).

## 1. What and why

- The user set a workspace to "Workspace write" in NASH, but ChatGPT dot reported that the MCP had no write capability.
- Cause: the remote path had its own cap, `read_only` (`DOT_REMOTE_SUBMIT_ACCESS_CAP`, remote plan decision 3). It shaped the Site's tool schema (`requestedAccess` enum `["read_only"]`), the tool description ("Remote tasks may only read"), the Site's validator and a second desktop check. The per-workspace maximum applied to the local dot interface only and never reached the Site.
- The user chose "Up to workspace max" (D-034):
  - remote submissions may ask for `workspace_write`;
  - each workspace's maximum, set in NASH, stays the limit, and a request above it is refused with `dot_access_above_maximum`;
  - dot is told each workspace's maximum so it can ask for the right access.
- Unchanged: D-025 (Codex and agy write attempts run in their own task worktrees; the primary merges after validation) and RG7 (on a read-only run dot may allow only Read and Glob prompts; deny is always possible). A `workspace_write` run starts the primary session in `acceptEdits`, and its command and edit prompts show `dotMayAllow: true`, exactly as for a write run started from the local dot interface.
- Also fixed: the Site's MCP `initialize` answer still said `nash-local-scaffold` and "Local R2 conformance mailbox only. No real NASH device or task execution is connected", which misled ChatGPT. It now describes the real mailbox (section 3.4).

## 2. Who does what

| Part | Owner | State |
|---|---|---|
| A. NASH desktop: remote contract v4, presence with `maxAccess`, regenerated `shared/dot-remote/*` | NASH (package P6) | Done, tests pass |
| B. Site source `C:\Programs\NASH\sites\nash-dot-mcp`: pinned artifacts, validators, mailbox, `initialize` text, tests | NASH (package P6) | Done, tests pass |
| C. Sync the hosting checkout, check, redeploy, refresh the connector, record the deployment | The user's Codex | Next |
| D. Rebuild NASH, one write task from dot, one refused write task | The user with the NASH main session | After C |

## 3. Contract changes (final)

### 3.1 Why a new remote contract version (v4) and not a v3 addition

- The workspace entry and the status view are closed schemas on both sides (`additionalProperties: false`). The deployed v3 Site refuses a workspace list carrying `maxAccess` with `payload_invalid`, and a v4 Site cannot invent a maximum for a list from a v3 NASH. A widened `requestedAccess` enum on a v3 NASH would only produce refusals, because that NASH still applies its own `read_only` cap. Mixed versions would look online and still not work.
- The project already has a fence for this: the Site refuses a heartbeat of any other contract version, so NASH shows offline until both sides run the same contract. A v4 bump uses that fence.
- The local dot ingress contract does not change: v3 already accepts `workspace_write` and lists `maxAccess` per workspace. So the inbox payloads stay v3 params, `manifest.injected.contractVersion` stays **3**, and `contractGolden` is still the v3 golden (`531a90a8…510132`). Only the remote contract (`manifest.contractVersion`, heartbeat, status, presence, vectors) moves to **4**. Payloads queued on the Site before the upgrade stay valid and deliverable.

### 3.2 Remote contract v4 (Site and NASH)

- `DOT_REMOTE_CONTRACT_VERSION` 3 to **4**; new `DOT_REMOTE_PAYLOAD_CONTRACT_VERSION` = 3 (`desktop/src/shared/dot-remote/dot-remote-limits.ts`).
- Heartbeat `contractVersion` is the literal 4; `nash_status.status.contractVersion` is 4 or `null`.
- Workspace entry (presence family, `nash_list_workspaces` output, `workspaces.put` body): `{ workspaceRef, displayName, maxAccess }`, `maxAccess` required, `read_only` or `workspace_write`. NASH publishes the list again whenever a workspace or a maximum changes.
- `nash_submit_task` input: `requestedAccess` enum `["read_only", "workspace_write"]`, default `read_only`.
- Manifest `policy`: `submitAccessCap` left `policy.defaults` (still `status: awaiting_user_confirmation` for decisions 2, 4, 5 and 6) and moved to the new `policy.decided: { submitAccessCap: "workspace_write" }`.
- Rules rewritten: `contractVersion` (remote v4, injected v3, a pre-v4 workspace list is not shown) and `remoteAccess` (the Site never compares `requestedAccess` with `maxAccess`; NASH refuses above the maximum with `dot_access_above_maximum`; the admitted access also decides `dotMayAllow`, RG7).
- No new tool, route, item kind, event kind or error code. Endpoints: 13, unchanged.

### 3.3 Tool text dot now reads

- `nash_list_workspaces`: "List the workspaces the user enabled for dot, as opaque workspaceRef values with the user's display names and maxAccess, the most access a task there may ask for (read_only or workspace_write), as the user set it in NASH. Use a workspaceRef from this list in nash_submit_task. The list never contains paths."
- `nash_submit_task`: "… requestedAccess is read_only (the default) or workspace_write. Ask for workspace_write only when the task must change files and nash_list_workspaces shows maxAccess workspace_write for its workspace; NASH refuses a request above the workspace's maxAccess with dot_access_above_maximum. …" The sentence "Remote tasks may only read (requestedAccess read_only)" is gone.
- The refusal dot sees is NASH's fixed message, unchanged: "The requested access is above the maximum the user set for this workspace. Ask for less access, or ask the user to raise the maximum in the app." (retryable `yes`).

### 3.4 MCP `initialize` (Site only, `lib/mcp-scaffold.ts`)

With the generated tools wired (production and the local preview):
- `serverInfo`: `{ "name": "nash", "version": "contract-4" }`.
- `instructions`: "NASH runs tasks on the user's own PC. This server is NASH's mailbox: a task you submit waits here until NASH takes it, and expires if NASH does not take it within 30 minutes. Every status and result is what NASH last reported. Call nash_status first; NASH must be paired and online. nash_list_workspaces shows maxAccess for each workspace: ask for workspace_write only when the task must change files and maxAccess allows it, otherwise read_only."

The bare scaffold path (no tools wired, tests only) keeps its old text.

### 3.5 Desktop (NASH)

- The remote cap is now `workspace_write`, so the desktop's pre-dispatch check (`dot-remote-item-checks.ts`) no longer refuses write items. Every remote item still reaches the dot endpoint with the ingress token, where `admitDotIntake` applies the switch, the enabled workspace, **its maximum** and the requirement rules, exactly as for a local dot client. A test drives a remote write item through the real dot listener into a read-only workspace and gets `dot_access_above_maximum`, with nothing recorded.
- The presence publishes `maxAccess` from the dot settings store (`getWorkspaceMaxAccess`) and leaves out any entry without a valid maximum.

### 3.6 Site behaviour (`lib/remote-mailbox.ts`)

- Payloads get `manifest.injected.contractVersion` (3); the heartbeat stores `manifest.contractVersion` (4). Leasing delivers payloads of version 3, so items queued before the upgrade are delivered, and pre-v3 payloads stay excluded as before.
- On load, a stored heartbeat of another version is dropped (NASH offline until a v4 heartbeat), and a stored workspace list that no longer matches the v4 list view (no `maxAccess`) is dropped: `nash_list_workspaces` answers `{ workspaces: [], publishedAt: null }` until NASH publishes again. No new migration: the D1 snapshot layout is unchanged.

### 3.7 Generated artifacts and hashes

- Regenerated from code only (file snapshots of `dot-remote-manifest.test.ts`, `dot-remote-envelopes-freeze.test.ts`, `dot-remote-vectors.test.ts`), then pinned and compiled with the Site's own scripts. Never hand-edit a generated file.
- Counts: tools **12** (unchanged), endpoints **13** (unchanged), conformance vectors 37 to **38**: `error.remote_access_cap` was replaced by `error.access_above_workspace_maximum` (NASH publishes both maximums; dot asks for write in both; NASH accepts one and refuses the other with `dot_access_above_maximum`) and `error.tool_input_outside_contract` (`contractVersion` in input, or `requestedAccess: full_access`, is `payload_invalid`). Payload hash examples 5 to 6 (new: "submit asking for workspace write"). `accepted.nash_list_workspaces` now carries `maxAccess`.
- Manifest hash before: `94bbd6fc2964a3a8ef79fb4000dfafd3d14a8d5567f5d6f20269fc223bad4c19`. **After: `dc8ea10de514d86ff8058c47f9e29e524a4909e33dade15f0959dbb97aa79400`.**
- File sha256 (what the pin script records): `dot-mcp-tool-manifest.json` `f2bee0fef261c4e70ecb6a4b5a5e519164cc7450876aa1c8f5cf7880843a9b36`, `dot-remote-conformance-vectors.json` `3cdb53f7e18517ee840042b495ad2fd223ec94a311ffc026de24775a0eb1bc8d`, `dot-remote-presence.schema.json` `b96321f254e2528503a212dde610275970d85671fd9c1ee16166786bf60e4fa7`; unchanged: endpoints `5595fc79…b2d2bfec`, inbox `2b3735e2…b9d843bb`, ack `50bbad98…6f5f63`, receipt `dfe2d055…02926a`, events `65dd8a9d…0ae0b9`, pairing `0fee187f…af462f80`, v3 golden `531a90a8…510132`.
- Site bundle: `generated/remote-validator-pins.json` records `artifactBundleSha256` `c6dce8209de95f03781930768d22b3c6da17a5680ee35f74afa26c8f573f04dc` and `validatorSha256` `db310af6209c35e8750fdf165c690a94d589607e1dc3ff703b22f2413eef0beb` (ajv 8.20.0).

## 4. Part C: sync, check and redeploy (Codex)

### 4.1 Where the source is now

- **Source of truth:** `C:\Programs\NASH\sites\nash-dot-mcp`, in the NASH repository (`github.com/p1nbored/NASH`, branch `main`). Its pin script reads the desktop at `../../../desktop/src/shared/`.
- **Hosting checkout:** `C:\Programs\autopilot\sites\nash-dot-mcp` keeps its own git, which the Sites hosting workflow uses (HEAD `7884bcf` "Update Site source", branch `main`, the source of the live v3 deployment). It is owned by the Codex sandbox account. It must be synced from the NASH source before redeploying; do not edit it by hand.

### 4.2 Files to deploy

Changed by P6 (all under `sites/nash-dot-mcp/`):
- `generated/remote-artifacts.json`, `generated/remote-validators.mjs`, `generated/remote-validator-pins.json`
- `lib/remote-mailbox.ts`, `lib/mcp-scaffold.ts`
- `scripts/pin-remote-artifacts.mjs` (expects contract v4, payloads v3, 12 tools, 13 routes, 38 vectors), `scripts/remote-http-smoke.mjs` (v4 heartbeat; submits with `workspace_write`)
- `tests/remote-http.test.ts`, `tests/remote-mailbox.test.ts`, `tests/remote-mcp.test.ts`, `tests/remote-vectors.test.ts`, `tests/remote-workflow.test.ts`
- `README.md`

Already different before P6 (the repository move renamed `desktop/orca` to `desktop`): `scripts/pin-remote-artifacts.mjs`, `scripts/extract-scaffold-schema.mjs` and `generated/dot-hello-schema.json` (its `source` path). They come along with the sync. `package.json` and `package-lock.json` are unchanged, so no install is needed.

### 4.3 Sync steps

1. Make sure the P6 changes are committed in `C:\Programs\NASH` and note the commit.
2. Export the Site with LF line endings. The NASH working copy has CRLF in source files (`core.autocrlf=true`); the hosting checkout is LF. For example: `git -C C:\Programs\NASH -c core.autocrlf=false archive --format=tar <commit> sites/nash-dot-mcp` into a new empty folder.
3. Copy the exported files over the hosting checkout. Do not delete or overwrite its local-only paths: `.git`, `node_modules`, `.next`, `.vinext`, `.sites-runtime`, `dist`, `.wrangler`, `next-env.d.ts`, `tsconfig.tsbuildinfo`.
4. In the hosting checkout, `git status` must show only the files in section 4.2. Keep `generated/*.json` and `generated/*.mjs` LF (`.gitattributes`); the bundle checks compare their bytes.
5. Run there (Node entry points only; no `.cmd`, `.bat`, `.ps1` or PowerShell, because the antivirus flags script launchers):
   - `node --experimental-strip-types --test tests/*.test.ts` (149 tests in the NASH copy, including all 38 vectors)
   - `node node_modules/typescript/bin/tsc --noEmit`
   - `node scripts/verify-remote-bundle.mjs` and `node scripts/compile-remote-schemas.mjs --check`
   - the build as the README describes (its prebuild runs the two checks above)
   - optional: the local HTTP smoke against the dev preview, `node scripts/remote-http-smoke.mjs http://127.0.0.1:5178`
   - Do not run `scripts/pin-remote-artifacts.mjs` in the hosting checkout: it needs the desktop sources, which exist only in the NASH repository.
6. Commit in the hosting checkout as usual for the hosting workflow.

### 4.4 Redeploy

1. **Record the live saved version first.** Last recorded: `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e~appgver_6d01567e26888191a7cf2433de61597f`, deployment `appgdep_6ac4bfd7412c8191b2d280e353bb4d02` (docs/dot-mcp-sites-deployment-2026-10-06.md). Re-read it natively before publishing.
2. **Save and deploy natively to the same Site and project:** https://nash-dot-mcp.taojuguo.chatgpt.site, project `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e`. **Keep access owner-private**; no audience change, no new route, no new migration.
3. **Verify after deployment:**
   - native status `succeeded` with `has_mcp: true`; access still owner-only;
   - `initialize` returns `serverInfo` `{ name: "nash", version: "contract-4" }` and the mailbox instructions of section 3.4;
   - `tools/list` shows 12 tools; `nash_submit_task.inputSchema.properties.requestedAccess.enum` is `["read_only", "workspace_write"]`; the `nash_list_workspaces` output schema requires `maxAccess`;
   - `nash_status` returns `status.manifestSha256` = `dc8ea10de514d86ff8058c47f9e29e524a4909e33dade15f0959dbb97aa79400`, and `contractVersion` `null` (no v4 heartbeat yet) or `4`;
   - one read-only `nash_list_workspaces` call returns an empty list (the stored v3 list is dropped) or "no App paired", and creates nothing.
4. **Rollback:** if a check fails, republish the version recorded in step 1 and report it.
5. **Deployment record:** `C:\Programs\NASH\docs\dot-mcp-sites-deployment-<date>.md`: version, deployment id, source commit (NASH and hosting checkout), archive SHA-256, manifest hash, the checks run, and anything not verified.

**Secrets.** No token or credential in source, docs, logs or commits. Pass the platform service credential through hidden input only, as before.

### 4.5 Refresh the ChatGPT connector's tool catalog

The tool names do not change, but their schemas and descriptions do. A client that keeps the old descriptors still tells dot that remote tasks may only read. On 2026-10-06 a conversation kept the old catalog after a redeploy (deployment record, "Client catalog follow-up"). After part C:
1. In ChatGPT, open the NASH remote MCP connector in the connector settings and refresh its tools (if there is no refresh action, disconnect and reconnect the same connector URL).
2. Start a new conversation; an existing one may keep the descriptors it loaded.
3. Check that dot now reads `requestedAccess` with `workspace_write` and `maxAccess` in `nash_list_workspaces`, and that `nash_status` shows the hash above.

## 5. Part D: after deployment

1. Rebuild NASH with P6. Its heartbeat states `contractVersion: 4`, which only the v4 Site accepts. **Until the Site and NASH both run v4, dot shows NASH offline**: a v3 NASH is refused by the v4 Site, a v4 NASH by the v3 Site, and the v4 Site drops the last v3 heartbeat when it loads. A refused heartbeat (`payload_invalid`) makes NASH retry later before it leases anything. Only a v3 NASH already running at the redeploy may still take items until its next heartbeat (at most 30 seconds); it applies its own `read_only` cap to them. The pairing itself is kept; no re-pairing is needed unless it expired.
2. In NASH Settings, dot section, set the test workspace to "Workspace write" (one confirmation).
3. Ask dot for a small change there with `workspace_write`: expect `accepted`, a run that may edit, and dot able to allow its command and edit prompts.
4. Ask dot for a write task in a read-only workspace: expect the receipt `refused` with `dot_access_above_maximum` and NASH's message.
5. The desktop does not check the served manifest hash at run time; that check is part C's.

## 6. Checklist

- [x] A: desktop remote contract v4, presence with `maxAccess`, cap raised, regenerated artifacts, tests (2026-10-06; not tried in the running app)
- [x] B: Site source, pins, validators, `initialize` text, tests (2026-10-06; 149 Site tests and the Site typecheck pass; no build or HTTP smoke run here)
- [x] C source/deployment: sync hosting checkout, checks, owner-private redeploy and deployment record (2026-10-08 UTC)
- [ ] C client follow-up: refresh the existing connector tool catalog
- [ ] D: rebuild NASH, one accepted write task and one refused write task from dot

## 7. Publication verified on 2026-10-08 UTC

Published version **5** of the existing owner-private NASH Remote MCP Site. This completes source/build/publication from P6; cached connector schema refresh and an actual desktop write task remain separate.

- URL: https://nash-dot-mcp.taojuguo.chatgpt.site
- Project: appgprj_6ac3a8b0f2288191aa84fbc93a316f8e
- Saved version: appgprj_6ac3a8b0f2288191aa84fbc93a316f8e~appgver_b3940078dfc48191adeb0145365389f2
- Deployment: appgdep_6ac6e93610c081919f88609dc31bbcf1
- Native result: succeeded, has_mcp=true
- Hosting source commit: 3eb3c686cdf37df15069560f316580d63aa46105
- Archive SHA-256: a90e39d943bb349c8fb0889da241bc6d5e05a82a626f14479463040fbe83822d
- Served manifest SHA-256: dc8ea10de514d86ff8058c47f9e29e524a4909e33dade15f0959dbb97aa79400
- Contract: remote v4; mailbox task payload remains ingress v3. 12 tools, 13 routes, 38 conformance vectors.

## Verification

149 Site tests, Site TypeScript, bundle verification and static validator checks passed. Vinext Worker build passed. Source and generated Site artifacts match the canonical NASH checkout byte for byte. Official source workflow pushed the exact build input and packaged it; the native owner-private deployment operation verified its access scope.

Actual installed-connector nash_status returned the new manifest hash, paired=true, online=false and no last heartbeat. nash_list_workspaces returned an empty list. No task, permission approval or account operation was submitted. A separate service-only discovery probe received HTTP 401 because it supplies no visitor identity; that probe does not verify initialize/tools-list. The authenticated connector checks above succeeded.

This conversation still advertises the old submit schema, so refresh the existing NASH Remote MCP connection's tool catalog and start a new conversation. Do not create a second connector. Start rebuilt NASH with the v4 code before attempting the real accepted-write/refused-write checks from the handover. Pairing remains present.

## Rollback

Prior live version, re-read before publication:
- Version 4: appgprj_6ac3a8b0f2288191aa84fbc93a316f8e~appgver_6d01567e26888191a7cf2433de61597f
- Prior deployment: appgdep_6ac4bfd7412c8191b2d280e353bb4d02
- Source: 7884bcff9330ee21c5eceefedbb3f1334b885844

No rollback was needed. Audience and storage bindings were preserved. Source credentials and private service access were kept in memory and sent through hidden stdin only, never written to repository files.
