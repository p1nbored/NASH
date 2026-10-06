# R2 hosted protocol integration: local verification

Date: 2026-10-05. Scope: the R2-ready local work authorized by `docs/dot-mcp-remote-plan.md`. Outcome: local protocol integration and conformance passed. No Site was created/published, no real platform credential was accessed/rotated, and no real NASH or dot connection was made. Fixture session tokens exist only in the local test realm; their stored representation is hash-only.

## App fix and prerequisites

The independently delegated App checks passed 486 tests across 24 files, exit 0: preserved recovery regressions 3/3; current intake/admission, closed RPC surface, both ingress contracts and R2 415/415; E1 startup/RPC checks 68/68. The previously reported recovery defect is fixed. Already accepted Workbench requests are reconciled without launching another run or falsely canceling an existing active run. E1 production installation is present. These are offline tests, not live CLI execution evidence.

## Pinned artifacts

The hosted checkout copies the generated R2 output into `sites/nash-dot-mcp/generated/remote-artifacts.json`. `scripts/pin-remote-artifacts.mjs --check` verifies it against the App checkout; standalone builds verify the bundled hashes without requiring that parent checkout. No upstream contract or generated R2 file was hand-edited.

| Artifact | SHA-256 of original file bytes |
|---|---|
| dot-mcp-tool-manifest.json | 192dc7c0cec672288b1f997312f718689b8f0302c15ce26593435bc32bc94ece |
| dot-remote-endpoints.json | c63f19febd0a1127150ab8af7d2cb60bce56e129b5ab33f8fb59361ff930e99d |
| dot-remote-conformance-vectors.json | bb57edc73efb5a75b4f9400316b5e2a5076153323d6ad770d294bbd17c5947b8 |
| dot-remote-ack.schema.json | e2e53b743b18bc305ed61faac096a66408b20618bc6c065eccf4b6897074a4ae |
| dot-remote-inbox.schema.json | c334ad54fa9f86184c89093d1d22a7506a9f427e34f80f745f9c26d01007cdf7 |
| dot-remote-receipt.schema.json | 430146a8f1f44a08aa48ced3cf7ae684d104a3b221059880a181556605026cc0 |
| dot-remote-events.schema.json | 097a2ebc7b2febb0f941843082b609e09a5716e5fb0ac3d9401b5c364f2d0e5c |
| dot-remote-presence.schema.json | b65fcdb54f54154d84d43274f4e35e86c28d3eb06ce4c28b420b422a034a2d93 |
| dot-remote-pairing.schema.json | 4b0016a5c64b44cb7ea51ba5ff63929b95ad727965fd65ae4bc0df36e99d189f |
| dot-ingress-contract-v2.schema.json | 76e69b2957cda67ee843e4aecb25fe75cd82bd1f999ea9b141c7c84e59f157a0 |

Canonical manifest SHA-256: `21cfe38c9383594e640d3a2e6bdab450a2afbda96ed69e62804c1e2689494bde`.

## Implemented local behavior

- All 10 generated MCP tools are exposed. The private per-tool `nash` routing block is removed from discovery. Inputs/defaults, outputs, endpoint bodies and fixed error messages come from pinned artifacts.
- All 10 NASH-facing routes and the signed-owner approval POST are implemented from the generated endpoint table. The browser approval page is `/pairing`; its POST is the specified `/pairing/approve`.
- Pairing, pending approval, deny, single-use issue, 15-minute sessions, renewal and generation revocation are modeled in the fixture realm. Device/user codes and session tokens are stored as hashes; knowledge of a code alone does not provide owner authority.
- Mailbox receipts, deduplication, queued and dependent cancellation, 60-second leases/renewal, ack replay/conflict, request projections, prompt decisions, message delivery receipts, heartbeat/workspace snapshots, source revisions and event deduplication are implemented.
- Terminal payload bodies are discarded while correlation/hash metadata remains. Logical expiry and retention filtering apply before bounded cleanup. Neither an old event nor a wrong owner/device/generation can update the projection.
- Pairing and mailbox transitions commit atomically to local D1 using a version CAS. Failed transitions and losing retries create no external effects. Twenty concurrent mutations preserve every update, and reopening the adapter restores state.
- The aggregate is a deliberately bounded local-test persistence layout with a 1 MiB snapshot cap. Capacity fails before commit. Production storage sizing/normalization is not established by these tests; this is not a production scale or retention certification.

## Verification and repairs

Final local unit/storage run: **102/102 passed**, exit 0. It includes all **24 R2 conformance vectors** and all four payload-hash examples. Every vector step executes the real state machine, validates generated outputs and restores exported state before the next step; expected outputs are not used to implement transitions. Additional tests cover SQLite persistence/concurrency, identity, expiry, schema bounds, revocation, payload pruning and transport guards.

Fresh review repairs were reproduced with failing regressions before fixes:

1. Unpaired status quota was initially discarded with an ephemeral mailbox. Owner call timestamps now persist in the same CAS state; 40 calls admit exactly 30.
2. A legitimate refused control ack with `dotRequestId: null` was rejected. Null is now accepted on refusal while a non-null wrong request ID remains rejected, and the original receipt correlation is retained.
3. Bounded cleanup could leave old receipts readable past retention. Reads/lists and dedup lookup now apply the logical retention cutoff even when physical cleanup has more rows left.

The first Worker HTTP probe failed with `Code generation from strings disallowed` because Ajv compiled schemas at runtime. Validators are now generated statically at build time and hash-checked, with no runtime eval or schema compiler. This uses Ajv's [standalone generation](https://ajv.js.org/standalone.html). The same vectors passed after the change.

TypeScript checking passed. The final Vinext build passed after bundled artifact/static-validator checks. Local D1 migration `0001_heavy_magdalene.sql` applied successfully; it adds only the prototype state table, preserving the prior fixture tables.

Actual local development Worker HTTP smoke passed for all 10 tools and all 11 routes: pending/approved pairing, issue/renew/revoke, workspace/heartbeat publication, duplicate submission, lease/renew/ack, events and prompt/message/cancel controls. Revoked sessions cannot lease and revoked bindings cannot submit. This used only a fake NASH client with an in-memory fixture session; it launched no App task.

The built production Worker also started locally: discovery returned HTTP 200 with 10 tools; the fixture challenge endpoint returned HTTP 503/unauthorized as intended. Production cannot use the development admission literal. Its real platform access adapter is intentionally disabled until H1/live authorization is resolved.

Browser verification passed: signed local demo account, code entry, explicit approval and the message that no real NASH App is connected. Screenshot: `.local/dot-mcp-scaffold/r2-approval-preview.jpg`. Both temporary preview servers are stopped at teardown.

## Commands and remaining live gates

From `sites/nash-dot-mcp`:

```powershell
node scripts/pin-remote-artifacts.mjs --check
node scripts/verify-remote-bundle.mjs
node scripts/compile-remote-schemas.mjs --check
node --experimental-strip-types --test tests/*.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' --prefix . --workspaces=false run build
```

With the local dev preview running, `node scripts/remote-http-smoke.mjs http://127.0.0.1:5178` exercises the whole HTTP fixture. The old fake-agent entrypoint forwards to this smoke. Preview/build instructions remain in the checkout README.

Still required: real Sites private-dispatch service access and durable desktop provisioning/renewal, verified MCP identity and protocol negotiation, whether `Nash-Session` survives dispatch, hosting/logging/allowance evidence, production persistence review, App R1/UI-7 integration and the authorized G-remote pass. Local custom-header delivery and fixture auth do not establish the hosted guarantees. No undocumented guarantee or live connection is claimed.
