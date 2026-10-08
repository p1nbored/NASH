# Dot integration

Updated 2026-10-08. This guide replaces the dated Dot plans, handovers and deployment checkpoints.

## Local and remote paths

Local Dot calls the authenticated NASH ingress interface. The owner-private Site exposes MCP tools and queues their operations; the paired desktop polls the mailbox and submits them through the same local ingress checks.

Current source contracts are **local ingress v3 / remote v4**, with 12 MCP tools, 13 device routes and 38 conformance vectors. Canonical schemas and the manifest live in [desktop/src/shared/dot-remote](../desktop/src/shared/dot-remote). Generated Site artifacts live in [sites/nash-dot-mcp/generated](../sites/nash-dot-mcp/generated).

NASH checks workspace identity and access again when admitting an operation. Remote `requestedAccess` defaults to `read_only` and can be `workspace_write` up to the configured workspace maximum.

## Existing coordinator attachment

Local `dotIngress.requests.attach` and `nash dot attach` take an explicit `coordinatorRunId`. On the remote side, `nash_submit_task` accepts that optional field; without it, it submits a new task.

Attachment keeps the coordinator's process, model, context and history. It atomically records the Dot receipt, control relationship and first message. Reusing the same request key does not create another coordinator; a different payload with that key conflicts.

The v3 hello method list stays unchanged for older strict clients. Updated clients call the extension directly. The existing published Site must be redeployed with the new bundle before remote attachment is available.

## Authorization and delivery

- Sites authenticates its service boundary; data-bearing MCP calls and browser approval require the verified owner. Device calls additionally require their own session or rotating device credential.
- The Site remains owner-private. Browser approval alone is not proof of a connected desktop; enrollment and a valid heartbeat must complete.
- Mailbox delivery is at least once. Idempotency keys, payload hashes, leases and generation checks prevent duplicate effects and stale authority.
- Only summaries and opaque artifact references leave the desktop through this protocol. Permission summaries omit file contents.
- Worker permissions go to their coordinator; ordinary coordinator permissions go to Dot. Critical requests are visible to Dot with an instruction to request user confirmation, but Dot cannot allow them.
- Inconclusive validation can be waived or rejected through the existing list/decide tools. Settled decisions cannot reopen.
- Switching Dot off, disabling a workspace or reducing its access prevents later actions and held-message delivery. It does not stop an already-running user CLI.

Current protocol defaults: queued item lifetime 30 minutes, visible receipt/event retention 7 days, absolute pairing lifetime 30 days. The generated policy still identifies these as configurable-policy defaults, not proof of a new user confirmation. Their source is [dot-remote-defaults.ts](../desktop/src/shared/dot-remote/dot-remote-defaults.ts).

The private test Site uses a bounded 1 MiB atomic state snapshot with reserved revocation space. This is not a production-scale storage claim. Never replay already applied migrations.

## Deployment record

The last recorded hosted deployment, before v1.4.215, is:

| Field | Recorded value |
|---|---|
| Site | [NASH Remote MCP](https://nash-dot-mcp.taojuguo.chatgpt.site) |
| MCP endpoint | `https://nash-dot-mcp.taojuguo.chatgpt.site/mcp` |
| Project | `appgprj_6ac3a8b0f2288191aa84fbc93a316f8e` |
| Saved version | `appgver_3d12a2ee1c588191a9eb3a495fa78271` |
| Source commit | `6bb5cbf6fd384d06fc779c43e9376a128de17818` |
| Manifest hash | `4065156f3037753862e7eaa2ed075b30e39d8bc225e3fda4255690f1f2ea89af` |
| Access | Owner-private |

This is a saved deployment record, not a live connection check. Desktop release v1.4.215 did not deploy the Site. Its new source bundle has manifest hash `b5233673f2f23b52d084a686a31b7a354671a8db709a10dd1e50831d0f3c4798`; hosted attachment requires that updated bundle.

Read-only connector checks were previously recorded, but real provider tasks, permission approval and takeover through the deployed Site remain unverified end to end.

## Development

See the [Site README](../sites/nash-dot-mcp/README.md) for local checks. Refresh reviewed contracts with `pin-remote-artifacts.mjs` and `compile-remote-schemas.mjs`; do not hand-edit generated files.

Keep service and device credentials out of source, logs and browser code. A desktop release does not authorize changing the Site audience or imply that the hosted application was updated.
