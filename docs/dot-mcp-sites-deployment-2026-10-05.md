# NASH Remote MCP: private Sites deployment

Follow-up, 2026-10-06: the installed NASH Remote MCP plugin's actual `nash_status` call succeeded and returned `paired: false`, `online: false`, with null contact/app/contract values and a 90-second online window. The platform-managed client connection is now verified for that read-only call. Real App pairing and device header forwarding are still unverified. See `dot-mcp-connection-check-2026-10-06.md` for the follow-up.

Date: 2026-10-05. The user explicitly authorized Sites deployment. Outcome: the owner-private Site is published; a signed-in browser visit verified the hosted page. No real NASH App pairing or MCP client connection was performed.

## Published version

- Site: https://nash-dot-mcp.taojuguo.chatgpt.site
- MCP endpoint: https://nash-dot-mcp.taojuguo.chatgpt.site/mcp
- Project ID: `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e`
- Saved version: `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e~appgver_8bb4fc115f9081918861207a2f7b92aa`
- Deployment ID: `appgdep_6ac3af0cae288191b4d2c2cade8feba0`
- Native deployment status: `succeeded`, `has_mcp: true`
- Pushed source commit: `46ee63717eec4a7248bf8f7fd3a0ac1c7ec0d808`
- Deployment archive SHA-256: `a5222d6573ea51fc3bc9dc95d0c74a1b25e9696bf46c540728831fe3c9045e0e`

Sites access was confirmed owner-only: custom access with the owner alone, no other viewers, editors, groups or external visitors. No audience change was made. Sites provisioned its private MCP plugin; installation was offered, not completed or claimed.

The initially returned expected origin differed from the final publication origin. A second published version corrects the production origin check to the actual URL above. Both versions belong to the same Site; the current version is the corrected one.

## Source and protocol changes

The upstream App contract changed during preparation. The hosted bundle was reviewed and regenerated from the current R2 output: 10 tools, 13 routes and 29 conformance vectors. Current canonical manifest hash: `fbfc682df32ad091fdb6834b8f98a9327ef4281cfaf7b80a49b16507650516db`. No generated upstream contract was hand-edited.

New support includes rotating device credentials, credential-reuse revocation, absolute pairing lifetime and owner revocation. Device credentials are stored only as credential ID, random salt and SHA-256 secret hash; comparison is constant-time. Normal session renewal and credential refresh remain separate operations. The browser approves the signed-in owner and never reports a real App connection solely from approval.

Hosted admission relies on owner-private Sites dispatch, which validates and consumes its service access credential. The Worker does not infer hosted identity from a client bearer. MCP owner data, approval and owner revocation require verified ChatGPT identity; device operations separately require Nash-Session or Nash-Device-Credential. The development admission literal and legacy simulation write routes cannot enable hosted access. Production hides the simulation UI.

Persistence remains the private-test aggregate: 1 MiB maximum, with 64 KiB reserved for revocation; pairing allocations have their own reserve. Ordinary allocations fail before consuming that security headroom. Expired pairing metadata is cleaned in bounded batches. This is a capacity-limited test deployment, not a production scale or physical backup deletion certification.

## Verification

- Final local suite: **123/123 passed**, including all **29** contract vectors and the payload-hash examples.
- TypeScript checking and final Vinext build passed.
- Source pin, standalone bundle and static validator checks passed.
- Actual local Worker HTTP smoke passed: all 10 tools and all 13 routes, including refresh, device revocation and owner revocation.
- Native save/deploy finished with **succeeded**, returned the live URL and confirmed MCP capability.
- After the user opened the Site, browser inspection verified the production title, signed-in identity, disconnected/no-App-paired status, last contact and pairing entry. The local simulation controls are absent. Screenshot: `.local/dot-mcp-scaffold/sites-deployed.png`.
- A direct online HTTP probe from the command runtime could not complete: the sandbox initially denied socket access, and the authorized retry timed out connecting. This is recorded as an unverified HTTP check, not as an application success or failure. No real pairing/task was created by the probe.

The Windows source workflow required per-command Git OpenSSL, Git Bash on PATH and GNU tar force-local mode. Certificate validation stayed enabled and no global settings changed. Source repository credentials were passed through hidden stdin only. The existing platform service credential was kept in session memory for the scoped verification attempt; no service credential was created, rotated, written to source or displayed.

## Remaining connection checks

Install/connect the provisioned NASH Remote MCP plugin and verify a read-only tool call. Then separately complete App polling configuration, supported durable platform service-access provisioning and owner-approved real device pairing. The current browser correctly shows no App paired. Actual Nash-Session/Nash-Device-Credential forwarding and real client identity must still be verified through that live connection.

The earlier local-only reports remain historical records; this report supersedes their statement that no Site was deployed.
