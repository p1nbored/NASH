Follow-up: Part A later landed with final v3 artifacts, and Part B is implemented and verified. The served-hash question was resolved through `nash_status.manifestSha256`. See `dot-mcp-sites-deployment-2026-10-06.md`; the review below is historical.

# Site readiness for dot validation decisions

Date: 2026-10-06. Scope: read-only prerequisite and integration review of the two new handover documents. No validation-decision feature, App change, test run, build or deployment was performed in this increment.

## Prerequisites

The handover is explicitly a specification. Part B depends on Part A landing, and a Codex-owned Part A additionally requires the NASH main session to confirm G4, G5 and G6 complete.

Current checked artifacts remain contract v2, 10 tools, 13 endpoints and 29 vectors; manifest `fbfc682df32ad091fdb6834b8f98a9327ef4281cfaf7b80a49b16507650516db`. `dot-ingress-contract-v3.schema.json` is absent. No generated list/decide validation tool or pending/settled validation-decision event is available to pin.

G6's shared decision service, desktop RPC and Workbench UI are present, including dot-origin checks and `by: 'dot'`. Saved logs show 56 and 12 tests passing with `guard_blocked=0`, and web/CLI type checks exiting 0. The service changed after those test logs, and the named scratchpad contains no final G4/G5/G6/G7 package reports or main-session completion marker. This evidence is useful progress, not confirmation of the handover's completion gate.

## Existing publication and rollback record

The handover's previously recorded rollback reference was older than the latest verified publication. It was corrected, preserving the document's CRLF line endings:

- Site/project: `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e`, https://nash-dot-mcp.taojuguo.chatgpt.site
- Saved version: `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e~appgver_f89ec05a1e088191812aa4af65beb886`
- Deployment: `appgdep_6ac48c154f908191aa07318202bdd5ba`
- Source: `b9834900da7906758b076ab601cb3b2132c74861`

This is the last verified record, not a new live access check. Before Part C, re-read the native current publication/access and retain the exact then-live saved version. Preserve owner-private access. The existing plugin's read-only status call is verified; real App pairing remains unverified.

## Part A acceptance points to inspect before Site implementation

The final generated contract must resolve these points. No proposed names or fields are being treated as final:

1. The list and decide tool inputs/outputs, pending and settled event schemas, receipt and ack mappings, and all fixed error codes. Specify how decided, already_decided, not_found and closed map to the mailbox outcome.
2. The decision TTL anchor and expiry rule. The proposed pending view has createdAt but no explicit deadline; reusing the original submit expiry versus starting a decision TTL produces different behavior for long runs.
3. Oldest-first pagination, per-owner pending capacity, overflow policy, logical expiry before bounded cleanup, and the visibility rule after settlement.
4. Idempotency: same decisionId/same payload returns the original receipt; different payload conflicts. Also define a second decisionId after another desktop or dot decision wins.
5. The narrow privacy exception: only validationId, dotRequestId, bounded title, fixed reason, bounded/withheld summary, summaryWithheld and createdAt reach dot. Resolve title path masking consistently with the no-paths rule. Desktop exposure owns content scanning; the Site should not invent a second sanitizer.
6. v1/v2 local compatibility, v3 heartbeat and existing persisted v2 snapshot handling, and the policy for a pending validation whose accepted-request mapping has aged out or whose device has been replaced.

## Served manifest hash gap

The handover requires verifying the served new manifest hash. The current Site exposes no such surface: initialization returns fixed serverInfo, tools/list returns the public catalog without the private nash blocks, status has no hash, and the generated endpoint table has no metadata/manifest route.

The full manifest hash cannot be reconstructed from the public tools because policy, rules, errors and server routing are absent. Build/archive pin verification is useful but does not satisfy a served-hash check.

Part A should define the final read-only metadata transport and schema, including caller/authentication, before Part B implements it. Expose pin metadata without owner data, creating no pairing or task. Do not invent a Site-only endpoint that the generated contract cannot describe.

## Hosted implementation map

- Pin the reviewed v3 golden and regenerated bundle; compile static validators. Keep upstream generated artifacts untouched.
- Extend the existing mailbox request projection with an initially empty validation-decision fold for old snapshots. Reuse eventId deduplication before sourceRevision ordering; stale events must not reopen settled decisions.
- Scope list and decide to accepted dot-owned requests of the authenticated owner/device binding. Apply idempotency lookup before pending/expiry checks so valid retries preserve their first outcome.
- Reuse existing inbox lease, renewal, ack, quota and revocation paths. Two new tools do not by themselves require two new HTTP routes; take the actual endpoint count from the regenerated table.
- Bound pending decisions across the owner and their total UTF-8 storage, including associated receipt/event metadata. Preserve the 1 MiB cap, 64 KiB security-revocation reserve and pairing reserve. Add a schema migration only if the final persistence change requires it.

## Verification matrix once Part A lands

Execute all regenerated vectors plus meaningful regressions for:

- oldest-first listing, cursor bounds, empty/unpaired state and withheld summaries;
- same-key replay and different-decision conflict, including a decision already won on desktop;
- another owner's or non-dot request, expired/closed decision, revoked generation and replacement device;
- duplicate/conflicting/late events, settlement removal and no stale reopening;
- bounded capacity, logical cleanup, revocation headroom and old snapshot restoration;
- exactly the authorized view fields, with forbidden extra event fields rejected;
- v3 tool catalog and static schemas, served pin metadata and no changes to frozen v1/v2 goldens.

Use Node entry points and the prescribed spawn guard/safe runner where applicable. Do not start PowerShell, cmd, script launchers, App/CLI sessions, real pairing or model runs.

After Site checks/build pass, publish to the same owner-private Site, verify the native result and 12-tool catalog, served hash and an actual read-only validation list call, then record exact IDs/source/archive hash. Part D remains a separate rebuild/pair/live gate.

## Current stopping point

Site preparation is complete as a review and test matrix. Actual v3 implementation and publication await the authoritative regenerated desktop contract. No placeholder tools or hand-written proposed schemas were shipped.
