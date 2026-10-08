import {
  DOT_REMOTE_CONTRACT_VERSION,
  DOT_REMOTE_PAYLOAD_CONTRACT_VERSION
} from './dot-remote-limits'
import { DOT_REMOTE_PAYLOAD_HASH_RULE } from './dot-remote-payload'
import { DOT_REMOTE_VALIDATION_DECISIONS_RULE } from './dot-remote-validation-rule'

// The behaviour the generated schemas cannot express, in English, for the hosted implementation. The
// manifest carries these lines; the conformance vectors exercise each of them.

export const DOT_REMOTE_RULES = {
  authority:
    'NASH is the single authority. The Site stores inbox items and a read-only copy of what NASH reported; it never decides a request status itself.',
  contractVersion: `This is remote contract version ${DOT_REMOTE_CONTRACT_VERSION}. The MCP layer adds contractVersion ${DOT_REMOTE_PAYLOAD_CONTRACT_VERSION} (injected.contractVersion, the dot ingress contract of the payloads) to every write payload and validates it against the v${DOT_REMOTE_PAYLOAD_CONTRACT_VERSION} params schema of the method. Tool inputs never carry contractVersion. A heartbeat states contractVersion ${DOT_REMOTE_CONTRACT_VERSION}; any other version fails its schema with payload_invalid, so NASH of another contract version never shows online.`,
  payloadHash: DOT_REMOTE_PAYLOAD_HASH_RULE,
  deduplication:
    'Before it enqueues anything, the Site checks in one transaction that the key named by the tool dedupKey is unique for the owner, device and tool. The same key with the same payloadSha256 returns the original receipt in its current state; the same key with another payloadSha256 is refused with idempotency_conflict. For nash_cancel_request the key is submitItemId, and a repeat returns the current cancel answer. A refused tool call stores nothing. The Site never derives idempotencyKey or messageId from its own itemId.',
  delivery:
    'Delivery is at least once. The Site leases items oldest first, only to the paired device, each lease with a new leaseNonce, the pairing generation and leaseExpiresAt 60 seconds after the lease. An item whose lease expires without an ack returns to queued. An item with dependsOnItemId is leased only after that submit was acknowledged as accepted or duplicate.',
  acks: 'An ack must name the current leaseNonce and generation of the item, else it is refused with lease_lost or generation_revoked, and the payloadSha256 of the item, else it is refused with payload_invalid. A repeated ack with the same outcome is already_recorded; with another outcome it is refused with ack_conflict. accepted and duplicate record the dotRequestId NASH assigned; refused records the NASH code with its fixed English message.',
  expiry:
    'Every read and every lease treats a queued item whose expiresAt has passed as expired, with updatedAt equal to expiresAt, and an expired item is never delivered. A claimed item keeps its state until NASH acknowledges it; if its lease ends without an ack after expiresAt, it becomes expired at leaseExpiresAt. expiresAt is createdAt plus submitTtlMinutes; for a permission answer it is no later than the deadlineAt of its prompt. NASH acknowledges an item whose expiresAt has passed as expired without acting on it. A validation decision has no deadline, so its expiresAt is createdAt plus submitTtlMinutes as well; after it expired, dot decides again with a new decisionId.',
  queuedCancel:
    'nash_cancel_request on a queued submit marks it canceled_before_claim in the same transaction, and nothing reaches NASH. On a claimed or accepted submit it creates one cancel item that depends on the submit; while the submit is claimed the cancel has no payload and no dotRequestId, and it is leased once the submit is accepted, with the dotRequestId from that ack. If the submit is refused or expires, the cancel is refused with cancel_target_not_admitted.',
  events:
    'Events of one dotRequestId apply in increasing sourceRevision, in batch order. The Site checks the eventId first: an event whose eventId was already stored with the same content is a duplicate; with other content it is a conflict. Otherwise, an event whose sourceRevision is not above the highest applied revision of its request is stale and ignored, so a closed prompt never reopens. An event for a request without an accepted submit of this binding is unknown_request. Each result names the appliedRevision per request, from which NASH resends after a restore.',
  remoteAccess:
    'A remote submission may ask for any access up to policy.decided.submitAccessCap, workspace_write; requestedAccess defaults to read_only. The real limit is the maximum the user set for each workspace in NASH, published as maxAccess in the workspace list. The Site never compares requestedAccess with maxAccess: it queues the submit, and NASH refuses one above the maximum with dot_access_above_maximum. The run keeps the access NASH admitted, which also decides dotMayAllow on its permission prompts (RG7).',
  permissionAnswers:
    'An answer is accepted only for a prompt the Site holds as open and before its deadline. allow is refused with decision_allow_not_permitted when the reported view has dotMayAllow false (RG7); deny is always possible. NASH checks again and may refuse with dot_decision_deny_only.',
  validationDecisions: DOT_REMOTE_VALIDATION_DECISIONS_RULE,
  identity:
    'Owner, device, dot identity and generation are derived on the server: the owner from the platform identity header, the device and generation from the pairing record, the dot identity from the verified identity on MCP calls. A tool call by any other owner, and an endpoint call by a session of any other device, is refused with unauthorized; a device credential resolves to its own binding only; no body field, client label or known id is authority.',
  deviceCredential:
    'When the owner has approved, the issued session response also carries deviceCredential: a credential of the form <credentialId>.<secret> and expiresAt, the absolute end of the pairing, deviceCredentialLifetimeDays after approval. It appears only in that response and in refresh responses. The Site stores per credential only credentialId, a random salt and secretHash, the lowercase hex SHA-256 of the UTF-8 bytes of salt + "." + secret, bound to owner, device, dot identity and generation, and compares hashes in constant time. POST /nash/v1/session/refresh takes the credential only in the Nash-Device-Credential header, next to OAI-Sites-Authorization, and answers a new session and a new credential with the same expiresAt; the presented credential is superseded at once. The Site checks in this order: an unknown credential or one whose secret does not verify is device_credential_invalid and changes nothing; a revoked binding or a body generation other than the binding generation is generation_revoked; a superseded credential that verifies is reuse, so the Site revokes the binding as a revocation does and answers device_credential_reused; a refresh at or after expiresAt is pairing_expired. No session outlives expiresAt: session expiresAt and renewAfter are capped at it, and renew after it answers pairing_expired.',
  revocation:
    'Revocation, by NASH (pairing.revoke) or by the owner on the Site (pairing.owner.revoke), increments the generation, ends every session, device credential and lease, refuses every waiting item with pairing_revoked, and refuses any later call that carries the old generation with generation_revoked. Requests NASH already accepted keep their real state; revocation does not cancel them. The owner can still read what was stored, while every write tool answers nash_never_paired until NASH is paired again.',
  retention:
    'Receipts, events and deduplication records stay visible for retentionDays and are then purged in bounded batches. A deduplication record keeps the key and payloadSha256 only, never the objective or message text.',
  tokens:
    'NASH sends the platform service token only in the OAI-Sites-Authorization header, its session token only in the Nash-Session header and its device credential only in the Nash-Device-Credential header. No request body carries any of them, and hosted logs keep no bodies or credential headers.'
} as const
