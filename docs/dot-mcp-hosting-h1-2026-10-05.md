# Sites hosting H1: documentation verification

Date: 2026-10-05. Scope: the allowed-now H1 work in [the remote plan](dot-mcp-remote-plan.md), section 0. The documentation pass is complete; H1 is **not closed for deployment** because several platform guarantees and the desktop service-access lifecycle remain undocumented or require an authorized live check.

Only installed Sites references, helper source, native tool descriptions and official OpenAI documentation were inspected. No native Sites tool was called. No Site, credential, token, connection, pairing, deployment or live request was created. This report does not revise the generated contracts or authorize those operations.

## Findings

“Verified” below means supported by the cited documentation, not observed on a running Site. “Undocumented” means not established by the sources inspected; it does not prove the feature is absent.

| H1 topic | Verified answer and source | Remaining uncertainty / implementation consequence |
|---|---|---|
| MCP transport | Sites requires a stateless HTTP `POST /mcp` handling initialize, tool discovery and calls. `get_site` describes its connection URL as Streamable HTTP. [L2], [T1] | The actual dot client's MCP protocol version, negotiation and authenticated identity have not been observed. A local fake client cannot close this gate. |
| MCP authentication | Sites manages connection authentication and OAuth; the application must still authorize data-bearing calls using platform identity. Service access supplies no visitor identity. [L1], [L2] | Do not add the revision-2 static bearer/OAuth fallback for hop A. A caller name or supplied owner/device ID is not authenticated identity. |
| MCP installation | Publication provisions the Site plugin; installation and account connection are separate steps. OpenAI instructs testing a real tool and checking its result after connecting. [L2], [Hosting a plugin with ChatGPT Sites](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites) | Hosting success is not dot connection success. Dot's real read and write tool behavior remains a later gate. |
| Sites ingress timeout | No Sites dispatch/request deadline is specified in the inspected references or tool metadata. | Helper installation/command timeouts and Cloudflare Worker duration limits are not Sites ingress guarantees. Keep HTTP operations short and bounded. |
| Request body limit | No Sites-specific maximum inbound JSON/body size is documented in those sources. | Set bounded application limits and reject oversized bodies; select and validate final sizes before live use. Provider maximums cannot establish the effective Sites limit. |
| Concurrency / request quotas | The installed skill documents Worker execution with 128 MB per isolate. [L0] | It does not document Sites request concurrency, per-Site requests per second, CPU allowance or dispatch queue limits. Preview connector concurrency is unrelated. |
| Held 25-second request | HTTP, HTTPS and WebSockets are supported; raw TCP is not. [Sites guide](https://learn.chatgpt.com/docs/sites#understand-limits-and-unsupported-uses) | Protocol support does not prove dispatch will hold a 25-second request. Retain the plan's 5-second active / 30-second idle short polling until an authorized hosted test establishes long polling. |
| Structured persistence | Sites provisions D1 bindings and applies source migrations before Worker upload. Local and hosted databases are separate. [L3] | TTL filtering, cleanup, deduplication horizons and lease fencing are application responsibilities; no Sites row-TTL service was established. |
| Storage capacity / tier | The official Sites guide gives a 10 GB D1 storage limit per Site and no fixed R2 storage limit. [Sites guide](https://learn.chatgpt.com/docs/sites#understand-limits-and-unsupported-uses) | This does not identify the provisioned D1 billing tier, query quotas or recovery tier. Account-wide beta storage allowance can be a separate limit. |
| Recovery retention / restore | No Sites-specific backup window, point-in-time recovery guarantee or owner restore procedure is described in the inspected Sites sources or exposed tool surface. | Do not promise 7-day physical erasure or a restore window. Application visibility/purge and provider recovery copies are separate. A saved source version is not evidence of a live database backup. |
| Encryption at rest | The earlier [review](dot-mcp-remote-review-2026-10-05.md) records Cloudflare D1's provider documentation on automatic encryption. | This pass adds no Sites-specific encryption configuration/attestation. Retain the distinction between provider behavior and a Sites product guarantee. |
| HTTPS / origin | Sites exposes a generated origin and exact hosted MCP URL in `get_site`; the skill supports hosted HTTPS URLs. [L0], [T1] | Preserve the returned origin. A slug can be changed; durable desktop configuration needs an explicit origin-change/re-pairing policy. |
| App request logs | The Worker-log tool describes production invocation/error logs and bounded recent-log querying. [T3] | It offers no body/header exclusion control or retention guarantee. Application code can use an allowlist of request ID, operation, outcome, latency and size; it cannot make a guarantee about platform logs. |
| Log retention | `get_site_worker_logs` accepts a lookback of 1–10080 minutes and a result limit of 1–100. [T3] | A seven-day query range is not proof of seven-day retention, completeness or deletion. Dispatch/auth/analytics logs may be distinct. |
| Region / residency | OpenAI explicitly says Sites does not support data or inference residency at launch, including deployed Sites, source, D1/R2 storage, artifacts and logs. [Creating and using ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites#limits-and-unsupported-uses) | The actual storage/processing jurisdiction is not established. Do not infer a Sites region from a D1 location hint or the user's ChatGPT residency setting. |
| User cost model | During public beta, hosting usage is included up to plan-specific limits shared across all Sites on the account; current allowances are shown in Sites and may change. [Creating and using ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites#public-beta-limits) | The user's exact remaining allowance, any workspace-specific arrangement and behavior beyond that allowance were not inspected. Do not quote Cloudflare prices as the user's Sites bill or describe hosting as unlimited/free. |
| Private desktop ingress | Supported platform service access uses `OAI-Sites-Authorization: Bearer <token>` for that Site. Dispatch consumes this credential without establishing user identity or connected-app consent. [L1], [T1] | The desktop needs platform access **and** the mailbox's owner/device session authorization. Its pairing secret cannot alone pass the private Sites dispatch gate. |
| Durable unattended service access | `get_site` may expose an existing `siwc_bypass_bearer_token`. The explicit generation tool creates or rotates it; the new token works immediately and the old token may work for up to 60 seconds. [L1], [T1], [T2] | No documented desktop enrollment/refresh API, token expiry, refresh grant, automatic reacquisition, device scope or unattended renewal procedure was found. Do not build an assumed OAuth refresh flow or treat this token as the mailbox's 15-minute session. |
| Test isolation | Sites says every deployment URL is production. [L0], [T1], [Creating and using ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites#create-a-site) | A later test needs a separate private Site/database and the plan's explicit authorization. A “preview” URL does not establish a staging service. |

## Service-access boundary

Keep three mechanisms distinct in the implementation:

1. Sites-managed MCP connection/OAuth authenticates the dot-facing connection; operation-level ownership still belongs to the mailbox application.
2. Platform service access admits the desktop HTTP request through a private Site's dispatch boundary. It does not identify the owner or device.
3. The owner-approved mailbox pairing and scoped app session identify the device, authorized caller and pairing generation. Revocation must fence app sessions, leases, acknowledgements and events independently of platform token rotation.

The supported token-generation tool is a mutation, even if used as a probe. Its description requires an explicit user request for a bypass token. The installed unattended-work guidance also requires access acquisition to work without the authoring session and prohibits creating/rotating credentials merely to check availability. [L1], [L4], [T2] No token action was taken.

For now, inject a local-only fake platform-access adapter. Before enabling real desktop polling, document the supported acquisition and renewal/replacement path, secure local storage, revoked/rotated-token behavior and restart recovery; verify them in the authorized private test. An inability to renew should stop polling with a clear reconnect state, not fall back to public access or browser cookies.

## Exit evidence still needed

The remaining hosting facts are Sites-specific timeout/body/concurrency limits, platform log payload policy and retention, actual data location, managed-storage recovery guarantee/procedure, the user's displayed hosting allowance, and a supported durable desktop service-access path. Some need product documentation or provider confirmation; a successful test of one request cannot establish a retention or billing guarantee.

After approval for the separate private test and credentials, use harmless test records to verify authenticated MCP discovery/calls, owner/device isolation, desktop admission with both credentials, restart and rotation recovery, bounded body rejection and polling. Only then consider the 25-second held-request probe. These are future checks, not work performed by this report.

## Installed and native sources

Installed Sites plugin version: `1.0.0-a`; reference root: `C:/Users/Administrator/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-a/skills/sites/`. Source and tool descriptions were inspected on 2026-10-05.

- [L0: Sites skill](C:/Users/Administrator/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-a/skills/sites/SKILL.md), workflow, capabilities and runtime paragraph.
- [L1: Identity and secrets](C:/Users/Administrator/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-a/skills/sites/references/identity-and-secrets.md), Request Identity, Service Access and Secrets.
- [L2: Site MCP server](C:/Users/Administrator/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-a/skills/sites/references/site-mcp-server.md), Expose Tools and Publish and Connect.
- [L3: Storage](C:/Users/Administrator/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-a/skills/sites/references/storage.md), Bindings and Schema Changes.
- [L4: Recurring updates](C:/Users/Administrator/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-a/skills/sites/references/recurring-updates.md), Prepare the Update.
- T1: Native tool metadata for `mcp__codex_apps__sites_get_site`; inspected description and return schema, not invoked. In particular: `mcp_connection`, `siwc_bypass_bearer_token`, origin and access fields. No ingress quotas, storage tier, region, recovery retention or billing fields were found there.
- T2: Native tool metadata for `mcp__codex_apps__sites_generate_siwc_bypass_token`; inspected description and return schema, not invoked. No token expiry/refresh metadata is defined.
- T3: Native tool metadata for `mcp__codex_apps__sites_get_site_worker_logs`; inspected description and request/return schemas, not invoked.

Searches of the installed capability references and top-level helper scripts found local command/install and connector-preview timeout/concurrency settings, not hosted Sites ingress limits. The exposed Sites tool inventory contains log and database read tools but no backup/restore or quota/billing tool. This describes the inspected surface, not every platform capability.
