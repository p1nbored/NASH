# Dot workspace-write deployment — 2026-10-08 UTC

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
