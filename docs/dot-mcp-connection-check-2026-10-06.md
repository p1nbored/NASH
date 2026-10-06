# NASH MCP connection check and contract synchronization

Date: 2026-10-06, America/New_York.

## Verified connection

The user's updated NASH Remote MCP plugin is callable in this conversation. An actual read-only `nash_status` call succeeded both before and after the contract-only publication. It returned:

```json
{"status":{"paired":false,"online":false,"lastSeenAt":null,"appVersion":null,"contractVersion":null,"onlineWindowSeconds":90}}
```

The tool result had `isError: false`. This verifies the platform-managed MCP client connection and authenticated status projection. It does not verify a real App device, device credential/session forwarding, task admission or execution. No write tool, real pairing or billed App run was invoked.

## Contract synchronization

The only source delta was `dot-remote-endpoints.json` adding `ownerPages.pairingApproval: "/pairing"`, the browser page already implemented. Tools, routes, rules, schemas and vectors did not change: 10 tools, 13 routes, 29 vectors; manifest SHA-256 `fbfc682df32ad091fdb6834b8f98a9327ef4281cfaf7b80a49b16507650516db`.

Endpoint byte SHA-256: `5595fc7913f71326d246e2c38f866c6155d0441e415621182a549eb0b9d2bfec`. The bundled artifact was regenerated from the reviewed source; validator metadata was regenerated. The validator code itself is unchanged.

Verification passed: 123 tests including all 29 vectors, TypeScript, final Vinext build, source pin, standalone bundle and static validator checks. No executable behavior or App source was changed. The Site source checkout is clean after publication.

## Current publication

- Live Site: https://nash-dot-mcp.taojuguo.chatgpt.site
- Source commit: `b9834900da7906758b076ab601cb3b2132c74861`
- Project: `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e`
- Saved version: `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e~appgver_f89ec05a1e088191812aa4af65beb886`
- Deployment: `appgdep_6ac48c154f908191aa07318202bdd5ba`
- Native result: `succeeded`, MCP enabled.

Owner-only access was rechecked and preserved. Source credentials were passed only through hidden stdin, not written into source or logs. The existing working plugin connection was reused.

## Claude handover

The user identified `docs/dot-validation-decisions-handover-2026-10-06.md`. At this check the file was absent from the shared workspace and the targeted Programs-directory filename search. Its content has not been read, and no new validation decision is inferred from its name. The user was asked to provide the absolute path or synchronize the file. Further work dependent on those decisions awaits that content.

Later follow-up on 2026-10-06: both handover documents are now present and read. They are specifications; Part A has not landed. The v3 golden is absent and the generated manifest remains v2 with 10 tools. See `dot-validation-decisions-sites-readiness-2026-10-06.md` for the prerequisite audit and hosted integration checks.

