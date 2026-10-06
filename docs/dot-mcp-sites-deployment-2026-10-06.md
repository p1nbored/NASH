# NASH validation decisions: v3 Sites deployment

Date: 2026-10-06. Scope: Parts B and C of the final validation-decisions handover. The v3 Site is published; client refresh is pending before the new validation-list tool can be invoked from this conversation. No real App pairing, waive/reject or task execution occurred.

## Current publication

- Site: https://nash-dot-mcp.taojuguo.chatgpt.site
- Project: `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e`
- Saved version: `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e~appgver_6d01567e26888191a7cf2433de61597f`
- Deployment: `appgdep_6ac4bfd7412c8191b2d280e353bb4d02`
- Native status: `succeeded`, `has_mcp: true`
- Pushed source: `7884bcff9330ee21c5eceefedbb3f1334b885844`
- Upload archive SHA-256: `579fe3775285ea4e9f0b106c9dd863642a63c35d74ab2a081731ba8365bd8753`
- Served manifest SHA-256: `94bbd6fc2964a3a8ef79fb4000dfafd3d14a8d5567f5d6f20269fc223bad4c19`
- v3 golden SHA-256: `531a90a8fcaefff5cf6ee09fca71dc55bc9dc5f45e8d26bc53d75ac173510132`

The prior live rollback version was re-read natively before publication: `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e~appgver_f89ec05a1e088191812aa4af65beb886`, deployment `appgdep_6ac48c154f908191aa07318202bdd5ba`, source `b9834900da7906758b076ab601cb3b2132c74861`.

Owner-private access was checked before and after: owner only, no editors, groups or external visitors. The existing private plugin and connection were retained. No access change or new HTTP route was added.

## Implemented behavior

The authoritative v3 generated bundle exposes 12 tools, 13 routes and 37 conformance vectors. Raw artifact/golden hashes match the handover; frozen local v1/v2 goldens are unchanged. Generated files were produced through the pin/compiler scripts.

The new list and decide tools use the existing authenticated mailbox and device delivery paths. They return the desktop-masked title, fixed reason and summary unchanged. Pending decisions are paged oldest first, and only the oldest 50 per binding can be decided. Settlement permanently fences an ID; even a higher-revision pending event cannot reopen it. A decisionId replay returns its original receipt before open/expiry checks; another payload conflicts. Queued decisions depend on the accepted submit and expire thirty minutes after the decide call.

The request projection folds pending/settled validation events, with logical seven-day visibility and bounded cleanup. Event batches reject malformed cross-request links, extra fields, inconsistent withheld summaries and invalid closed timestamps atomically. The 1 MiB snapshot cap, 64 KiB security-revocation reserve and pairing reserve remain in force. No migration is needed for the existing JSON snapshot layout.

Old snapshots gain an empty validation fold. v2 heartbeats cannot show online on v3. Old queued v2 payloads keep their hash, remain readable/cancelable and expire at their original TTL; they are excluded from v3 delivery. This avoids rewriting an idempotency payload during the upgrade. Rebuild NASH for v3 before real pairing.

## Verification

- **144/144** aggregate tests passed, including all **37** generated vectors and five canonical payload-hash examples.
- TypeScript, standalone bundle, static validator and source-pin checks passed.
- Final Vinext Worker build passed.
- Actual local Worker HTTP smoke passed across all **12** tools and **13** routes, including validation pending/list/decide/dedup/lease/ack/settlement, session rotation and generation fences. It used fake local fixtures only.
- Fresh independent review found no material mailbox/workflow defect requiring repair.
- Native private deployment succeeded with MCP enabled.
- Actual installed-client `nash_status` returned `isError: false`, the exact new manifest hash above, `paired: false` and `online: false`.
- Post-deploy native access check confirmed owner-only access.
- The local preview was stopped; no listener remains on its port.

Development/build/source entry points ran through Node. Source credentials were kept in session memory and passed only to the official helper's stdin, never source/docs/commits/project logs. Generated files have LF attributes so restored source retains hash-stable bytes.

## Client catalog follow-up

This conversation still has the old ten-tool descriptors and cannot yet invoke `nash_list_validation_decisions`. The user was asked to refresh the same NASH Remote MCP connection/tool list. Server deployment and the actual served-hash call passed; the missing cached client tool is recorded as an outstanding check, not a server tool-call failure.

The new read-only list invocation and refreshed client catalog must still be verified. If an actual post-refresh server check fails, use the recorded prior private version for rollback and document the result. Do not mark Part C's complete verification until that call is observed.

## Remaining live gate

Part D is separate: rebuild NASH with v3, pair, then test one real dot waive and reject and the primary notice on a test run. This publication created no real device or task.
