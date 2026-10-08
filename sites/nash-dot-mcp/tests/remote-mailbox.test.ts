import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRemoteMailbox, payloadSha256 } from '../lib/remote-mailbox.ts';
import type { RemoteMailboxState, RemoteReply } from '../lib/remote-mailbox.ts';
import { validateEndpointOutput, validateToolOutput, remoteError } from '../lib/remote-contracts.ts';

const id = (prefix: number, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = { ownerId: 'fixture-owner-only', deviceId: 'dev_0123456789abcdef01234567',
  generation: 1, dotIdentity: { source: 'sites_mcp_identity', subject: 'fixture-owner-only' } };
const workspaceRef = 'dws_0123456789abcdef01234567';
type Receipt = { itemId: string; state: string; payloadSha256: string; expiresAt: string;
  updatedAt: string; dotRequestId: string | null; refusal?: { code: string } };
type LeasedItem = { itemId: string; payloadSha256: string; payload: Record<string, unknown>;
  lease: { leaseNonce: string; generation: number; leaseExpiresAt: string } };
function result<T>(reply: RemoteReply): T {
  assert.ok('result' in reply, JSON.stringify(reply));
  return reply.result as T;
}
function fixture() {
  let time = Date.parse('2026-10-05T12:00:00.000Z');
  let itemCount = 0;
  let nonceCount = 0;
  const clock = { now: () => time, itemId: () => id(1, ++itemCount),
    leaseNonce: () => `FIXTUREnoncereplay${String(++nonceCount).padStart(12, '0')}` };
  let mailbox = createRemoteMailbox(binding, clock);
  const caller = { deviceId: binding.deviceId, generation: 1 };
  return {
    time: () => time,
    advance: (seconds: number) => { time += seconds * 1000; },
    state: () => mailbox.exportState(),
    restore: (state = mailbox.exportState()) => { mailbox = createRemoteMailbox(binding, clock, state); },
    tool: (name: string, args: Record<string, unknown> = {}, owner = binding.ownerId) => {
      const reply = mailbox.tool(owner, name, args);
      if ('result' in reply) assert.equal(validateToolOutput(name, reply.result), true, name);
      return reply;
    },
    endpoint: (name: string, args: Record<string, unknown>, itemId?: string,
      endpointCaller = caller) => {
      const reply = mailbox.endpoint(endpointCaller, name, args, itemId);
      if ('result' in reply) assert.equal(validateEndpointOutput(name, reply.result), true, name);
      return reply;
    },
    submit: (n: number, extra: Record<string, unknown> = {}) => result<{ receipt: Receipt }>(
      mailbox.tool(binding.ownerId, 'nash_submit_task', {
        workspaceRef, objective: 'Review the open issues in the "docs" folder.',
        idempotencyKey: id(2, n), ...extra,
      }),
    ).receipt,
    lease: () => result<{ items: LeasedItem[] }>(
      mailbox.endpoint(caller, 'inbox.lease', { generation: 1, maxItems: 10 }),
    ).items,
    ack: (item: LeasedItem, extra: Record<string, unknown> = {}) => mailbox.endpoint(caller, 'inbox.ack', {
      itemId: item.itemId, leaseNonce: item.lease.leaseNonce, generation: 1,
      payloadSha256: item.payloadSha256, ackedAt: new Date(time).toISOString(),
      outcome: 'accepted', dotRequestId: id(3, 1), ...extra,
    }, item.itemId),
  };
}
function admitted(f: ReturnType<typeof fixture>) {
  const receipt = f.submit(1);
  const item = f.lease()[0];
  assert.equal(result<{ receiptState: string }>(f.ack(item)).receiptState, 'accepted');
  return { receipt, item, dotRequestId: id(3, 1) };
}
function promptEvent(f: ReturnType<typeof fixture>, n: number, requestId = id(3, 1)) {
  return { eventId: id(6, n), kind: 'permission_prompt_opened', dotRequestId: requestId,
    sourceRevision: n, at: new Date(f.time()).toISOString(), data: {
      decisionId: id(4, n), dotRequestId: requestId, toolName: 'Read', agentId: null,
      summary: 'Read: docs/README.md', status: 'pending', decidedBy: null,
      createdAt: new Date(f.time()).toISOString(),
      deadlineAt: new Date(f.time() + 60_000).toISOString(), decidedAt: null, dotMayAllow: true,
    } };
}

test('refused control ack may omit a local request ID without accepting a wrong non-null ID', () => {
  const f = fixture(); admitted(f);
  const receipt = result<{ receipt: Receipt }>(f.tool('nash_send_message_to_run', {
    dotRequestId: id(3, 1), messageId: id(5, 1), text: 'Summarize the docs.',
  })).receipt;
  const item = f.lease()[0];
  const { code, message } = remoteError('dot_request_not_found');
  const refusal = { by: 'nash', code, message };
  assert.equal(f.ack(item, { outcome: 'refused', dotRequestId: id(3, 2), refusal }).error?.code, 'payload_invalid');
  assert.equal(result<{ receiptState: string }>(f.ack(item, { outcome: 'refused', dotRequestId: null, refusal })).receiptState, 'refused');
  assert.equal(result<{ receipt: Receipt }>(f.tool('nash_get_receipt', { itemId: receipt.itemId })).receipt.dotRequestId, id(3, 1));
});

test('retention hides old receipts and views even when a bounded purge leaves rows behind', () => {
  const f = fixture(); admitted(f);
  const history = f.state();
  const source = history.items[0];
  const projection = history.requests[id(3, 1)];
  history.items = Array.from({ length: 150 }, (_, index) => {
    const entry = structuredClone(source);
    entry.receipt.itemId = id(1, index + 1); entry.receipt.dotRequestId = id(3, index + 1);
    entry.dedupKey = id(2, index + 1);
    return entry;
  });
  history.requests = Object.fromEntries(history.items.map((item) => {
    const copy = structuredClone(projection); copy.dotRequestId = item.receipt.dotRequestId!; copy.submitItemId = item.receipt.itemId;
    return [copy.dotRequestId, copy];
  }));
  f.advance(8 * 86_400);
  f.restore(history);
  assert.equal(f.tool('nash_get_receipt', { itemId: id(1, 150) }).error?.code, 'receipt_not_found');
  f.restore(history);
  assert.equal(f.tool('nash_get_request', { dotRequestId: id(3, 150) }).error?.code, 'request_not_found');
  f.restore(history);
  assert.deepEqual(result<{ requests: unknown[] }>(f.tool('nash_list_requests')).requests, []);
});

test('defaults and dedup survive restoration and returned objects cannot modify state', () => {
  const f = fixture();
  const original = f.submit(1);
  f.restore();
  assert.equal(f.submit(1, { requestedAccess: 'read_only' }).itemId, original.itemId);
  assert.equal(f.tool('nash_submit_task', { workspaceRef, objective: 'Review another issue.',
    idempotencyKey: id(2, 1) }).error?.code, 'idempotency_conflict');
  original.state = 'accepted';
  assert.equal(result<{ receipt: Receipt }>(f.tool('nash_get_receipt', { itemId: original.itemId })).receipt.state, 'queued');
  const snapshot = f.state();
  f.restore(snapshot);
  snapshot.items[0].receipt.state = 'accepted';
  assert.equal(f.state().items[0].receipt.state, 'queued');
});

test('lease expiry fences old acks and renewal; exact repeated outcomes are idempotent', () => {
  const f = fixture();
  f.submit(1);
  const old = f.lease()[0];
  f.advance(60);
  assert.equal(f.ack(old).error?.code, 'lease_lost');
  const current = f.lease()[0];
  assert.notEqual(current.lease.leaseNonce, old.lease.leaseNonce);
  assert.equal(f.endpoint('inbox.renew', { itemId: old.itemId, generation: 1,
    leaseNonce: old.lease.leaseNonce }, old.itemId).error?.code, 'lease_lost');
  assert.equal(result<{ recorded: string }>(f.ack(current)).recorded, 'applied');
  f.advance(120);
  f.restore();
  assert.equal(result<{ recorded: string }>(f.ack(current)).recorded, 'already_recorded');
  assert.equal(f.ack(current, { outcome: 'duplicate' }).error?.code, 'ack_conflict');
  assert.equal(f.ack(current, { payloadSha256: 'f'.repeat(64) }).error?.code, 'payload_invalid');
});

test('renewal extends only a live held lease using server time', () => {
  const f = fixture();
  f.submit(1);
  const item = f.lease()[0];
  f.advance(50);
  const renewed = result<{ leaseExpiresAt: string }>(f.endpoint('inbox.renew', {
    itemId: item.itemId, generation: 1, leaseNonce: item.lease.leaseNonce,
  }, item.itemId));
  assert.equal(Date.parse(renewed.leaseExpiresAt), f.time() + 60_000);
  f.advance(15);
  assert.equal(result<{ receiptState: string }>(f.ack(item)).receiptState, 'accepted');
  assert.equal(f.endpoint('inbox.renew', { itemId: item.itemId, generation: 1,
    leaseNonce: item.lease.leaseNonce }, item.itemId).error?.code, 'lease_lost');
});

test('a claimed item past TTL stays claimed until the lease ends and cannot be admitted late', () => {
  const f = fixture();
  const receipt = f.submit(1);
  f.advance(1795);
  const item = f.lease()[0];
  f.advance(10);
  assert.equal(result<{ receipt: Receipt }>(f.tool('nash_get_receipt', { itemId: receipt.itemId })).receipt.state, 'claimed');
  assert.equal(f.ack(item).error?.code, 'payload_invalid');
  f.advance(50);
  const expired = result<{ receipt: Receipt }>(f.tool('nash_get_receipt', { itemId: receipt.itemId })).receipt;
  assert.equal(expired.state, 'expired');
  assert.equal(expired.updatedAt, item.lease.leaseExpiresAt);
  assert.deepEqual(f.lease(), []);
});

test('queue capacity includes claimed items, permits dedup retries, and errors create no items', () => {
  const f = fixture();
  const first = f.submit(1);
  for (let n = 2; n <= 50; n++) { f.advance(25); f.submit(n); }
  assert.equal(f.state().items.length, 50);
  assert.equal(f.tool('nash_submit_task', { workspaceRef, objective: 'Review the issue list.',
    idempotencyKey: id(2, 51) }).error?.code, 'inbox_full');
  assert.equal(f.submit(1).itemId, first.itemId);
  const leased = f.lease();
  assert.equal(leased.length, 10);
  assert.equal(f.tool('nash_submit_task', { workspaceRef, objective: 'Review the issue list.',
    idempotencyKey: id(2, 51) }).error?.code, 'inbox_full');
  assert.equal(f.state().items.length, 50);
});

test('per-binding tool rate limit is persisted and resets at sixty seconds', () => {
  const f = fixture();
  for (let n = 0; n < 30; n++) assert.ok(f.tool('nash_status').result);
  f.restore();
  assert.equal(f.tool('nash_status').error?.code, 'rate_limited');
  f.advance(60);
  assert.ok(f.tool('nash_status').result);
});

test('wrong owners/devices and a generation mismatch cannot read or mutate a mailbox', () => {
  const f = fixture();
  const receipt = f.submit(1);
  const before = f.state();
  assert.equal(f.tool('nash_get_receipt', { itemId: receipt.itemId }, 'other-owner').error?.code, 'unauthorized');
  assert.equal(f.endpoint('inbox.lease', { generation: 1, maxItems: 10 }, undefined,
    { deviceId: 'dev_89abcdef0123456789abcdef', generation: 1 }).error?.code, 'unauthorized');
  assert.equal(f.endpoint('inbox.lease', { generation: 2, maxItems: 10 }).error?.code, 'generation_revoked');
  assert.deepEqual(f.state(), before);
  assert.throws(() => createRemoteMailbox({ ...binding, ownerId: 'other-owner' }, {
    now: () => f.time(), itemId: () => id(1, 10), leaseNonce: () => 'FIXTUREnonce01234567890123456',
  }, before), /does not belong/);
});

test('revocation ends held leases while preserving accepted requests and owner reads', () => {
  const f = fixture();
  const accepted = admitted(f);
  f.submit(2);
  const waiting = f.lease()[0];
  f.endpoint('pairing.revoke', { generation: 1 });
  f.restore();
  assert.equal(f.ack(waiting).error?.code, 'generation_revoked');
  assert.equal(f.tool('nash_submit_task', { workspaceRef, objective: 'Review the issue list.',
    idempotencyKey: id(2, 3) }).error?.code, 'nash_never_paired');
  assert.equal(result<{ receipt: Receipt }>(f.tool('nash_get_receipt', { itemId: waiting.itemId })).receipt.refusal?.code, 'pairing_revoked');
  assert.equal(result<{ receipt: Receipt }>(f.tool('nash_get_receipt', { itemId: accepted.receipt.itemId })).receipt.state, 'accepted');
  assert.ok(f.tool('nash_get_request', { dotRequestId: accepted.dotRequestId }).result);
  assert.equal(f.state().generation, 2);
});

test('events cannot invent requests or attach another request to a permission prompt', () => {
  const f = fixture();
  const unknown = promptEvent(f, 1);
  assert.deepEqual(result<{ results: unknown[]; cursors: unknown[] }>(f.endpoint('events.post', {
    generation: 1, events: [unknown],
  })), { results: [{ eventId: unknown.eventId, status: 'unknown_request' }], cursors: [] });
  admitted(f);
  const mismatched = { ...promptEvent(f, 2), data: { ...promptEvent(f, 2).data, dotRequestId: id(3, 99) } };
  assert.equal(f.endpoint('events.post', { generation: 1, events: [mismatched] }).error?.code, 'payload_invalid');
  assert.equal(f.state().requests[id(3, 1)].appliedRevision, 0);
});

test('prompt deadlines forbid new answers, but dedup retries return the original receipt after closure', () => {
  const f = fixture();
  admitted(f);
  const event = promptEvent(f, 1);
  f.endpoint('events.post', { generation: 1, events: [event] });
  const args = { decisionId: event.data.decisionId, decision: 'deny' };
  const original = result<{ receipt: Receipt }>(f.tool('nash_answer_permission_prompt', args)).receipt;
  assert.equal(original.expiresAt, event.data.deadlineAt);
  f.advance(60);
  assert.equal(result<{ decisions: unknown[] }>(f.tool('nash_list_permission_prompts')).decisions.length, 0);
  const retry = result<{ receipt: Receipt }>(f.tool('nash_answer_permission_prompt', args)).receipt;
  assert.equal(retry.itemId, original.itemId);
  assert.equal(retry.state, 'expired');
  assert.equal(f.tool('nash_answer_permission_prompt', { ...args, decision: 'allow' }).error?.code, 'idempotency_conflict');
  const event2 = promptEvent(f, 2);
  event2.data.deadlineAt = event.data.deadlineAt;
  f.endpoint('events.post', { generation: 1, events: [event2] });
  assert.equal(f.tool('nash_answer_permission_prompt', { decisionId: event2.data.decisionId,
    decision: 'deny' }).error?.code, 'decision_not_open');
});

test('cancel after an expired lease cancels the requeued submit and does not leak a control item', () => {
  const f = fixture();
  const target = f.submit(1);
  f.lease();
  const pending = result<{ cancel: Receipt }>(f.tool('nash_cancel_request', { submitItemId: target.itemId })).cancel;
  f.advance(60);
  const canceled = result<{ outcome: string; cancel: unknown }>(f.tool('nash_cancel_request', { submitItemId: target.itemId }));
  assert.equal(canceled.outcome, 'canceled_before_claim');
  assert.equal(canceled.cancel, null);
  assert.equal(result<{ receipt: Receipt }>(f.tool('nash_get_receipt', { itemId: pending.itemId })).receipt.refusal?.code,
    'cancel_target_not_admitted');
  assert.deepEqual(f.lease(), []);
});

test('terminal payload text is discarded; retained receipts and dedup hashes expire after seven days', () => {
  const f = fixture();
  const receipt = admitted(f).receipt;
  const retained = f.state();
  assert.equal(retained.items[0].payload, null);
  assert.equal(retained.items[0].dedupHash, receipt.payloadSha256);
  assert.doesNotMatch(JSON.stringify(retained), /Review the open issues/);
  f.advance(7 * 86_400);
  assert.equal(f.tool('nash_get_receipt', { itemId: receipt.itemId }).error?.code, 'receipt_not_found');
  assert.equal(f.state().items.length, 0);
  assert.equal(f.state().requests[id(3, 1)], undefined);
  assert.notEqual(f.submit(1).itemId, receipt.itemId);
});

test('retention purges old receipts and event identities in bounded batches', () => {
  const f = fixture();
  const state = f.state();
  const old = new Date(f.time() - 8 * 86_400_000).toISOString();
  for (let n = 1; n <= 250; n++) {
    state.items.push({ receipt: { itemId: id(1, n), kind: 'submit', state: 'expired',
      payloadSha256: payloadSha256({ n }), dependsOnItemId: null, dotRequestId: null,
      createdAt: old, updatedAt: old, expiresAt: old }, payload: null, lease: null,
      tool: 'nash_submit_task', dedupKey: id(2, n), dedupHash: payloadSha256({ n }), ack: null });
    state.eventIds[id(6, n)] = { hash: payloadSha256({ n }), storedAt: old };
  }
  f.restore(state as RemoteMailboxState);
  f.tool('nash_status');
  assert.equal(f.state().items.length, 150);
  assert.equal(Object.keys(f.state().eventIds).length, 150);
  f.tool('nash_status');
  f.tool('nash_status');
  assert.equal(f.state().items.length, 0);
  assert.equal(Object.keys(f.state().eventIds).length, 0);
});

test('workspace snapshots reject duplicate refs and ack route ids must match body ids', () => {
  const f = fixture();
  const timestamp = new Date(f.time()).toISOString();
  const workspace = { workspaceRef, displayName: 'Docs', maxAccess: 'read_only' };
  assert.equal(f.endpoint('workspaces.put', { generation: 1, publishedAt: timestamp,
    workspaces: [workspace, workspace] }).error?.code, 'payload_invalid');
  f.submit(1);
  const item = f.lease()[0];
  assert.equal(f.endpoint('inbox.renew', { itemId: id(1, 99), generation: 1,
    leaseNonce: item.lease.leaseNonce }, item.itemId).error?.code, 'payload_invalid');
});

test('event identity dedup survives bounded projection eviction and precedes revision staleness', () => {
  const f = fixture();
  admitted(f);
  const events = Array.from({ length: 75 }, (_, index) => ({ eventId: id(6, index + 1),
    kind: 'validation_result', dotRequestId: id(3, 1), sourceRevision: index + 1,
    at: new Date(f.time()).toISOString(), data: { verdict: 'pass', line: 'The check passed.' } }));
  f.endpoint('events.post', { generation: 1, events: events.slice(0, 50) });
  f.endpoint('events.post', { generation: 1, events: events.slice(50) });
  f.restore();
  const request = result<{ request: { appliedRevision: number; validationResults: typeof events } }>(
    f.tool('nash_get_request', { dotRequestId: id(3, 1) }),
  ).request;
  assert.equal(request.appliedRevision, 75);
  assert.equal(request.validationResults.length, 50);
  assert.equal(request.validationResults[0].sourceRevision, 26);
  const repeated = result<{ results: { status: string }[] }>(f.endpoint('events.post', {
    generation: 1, events: [events[0], { ...events[0], data: { verdict: 'fail', line: 'The check failed.' } }],
  }));
  assert.deepEqual(repeated.results.map((entry) => entry.status), ['duplicate', 'conflict']);
});

test('request pagination is stable newest first and uses opaque cursors', () => {
  const f = fixture();
  const receipts = [f.submit(1), f.submit(2), f.submit(3)];
  const page = result<{ requests: { receipt: Receipt }[]; nextCursor: string }>(
    f.tool('nash_list_requests', { limit: 2 }),
  );
  assert.deepEqual(page.requests.map((entry) => entry.receipt.itemId), [receipts[2].itemId, receipts[1].itemId]);
  assert.equal(page.nextCursor, receipts[1].itemId);
  const remaining = result<{ requests: { receipt: Receipt }[]; nextCursor: string | null }>(
    f.tool('nash_list_requests', { limit: 2, cursor: page.nextCursor }),
  );
  assert.deepEqual(remaining.requests.map((entry) => entry.receipt.itemId), [receipts[0].itemId]);
  assert.equal(remaining.nextCursor, null);
  assert.equal(f.tool('nash_list_requests', { cursor: id(1, 99) }).error?.code, 'payload_invalid');
});

test('control mappings cannot accept another request and malformed message outcomes store nothing', () => {
  const f = fixture();
  admitted(f);
  f.advance(10);
  const cancel = result<{ cancel: Receipt }>(f.tool('nash_cancel_request', { submitItemId: id(1, 1) })).cancel;
  const observed = result<{ receipt: Receipt }>(f.tool('nash_get_receipt', { itemId: cancel.itemId })).receipt;
  assert.equal(observed.updatedAt, new Date(f.time()).toISOString(), 'mapping folds do not backdate ready controls');
  const item = f.lease()[0];
  assert.equal(f.ack(item, { dotRequestId: id(3, 2) }).error?.code, 'payload_invalid');
  const malformed = { eventId: id(6, 1), kind: 'message_outcome', dotRequestId: id(3, 1),
    sourceRevision: 1, at: new Date(f.time()).toISOString(),
    data: { messageId: id(5, 1), outcome: 'refused', reason: null } };
  assert.equal(f.endpoint('events.post', { generation: 1, events: [malformed] }).error?.code, 'payload_invalid');
  assert.equal(f.state().requests[id(3, 1)].appliedRevision, 0);
});


function validationPending(f: ReturnType<typeof fixture>, n: number, overrides: Record<string, unknown> = {}) {
  return { eventId: id(6, n), kind: 'validation_decision_pending', dotRequestId: id(3, 1),
    sourceRevision: n, at: new Date(f.time()).toISOString(), data: {
      validationId: `validation_${n}`, dotRequestId: id(3, 1), title: 'Review the issues',
      reason: 'review_unavailable', summary: null, summaryWithheld: true,
      createdAt: new Date(f.time()).toISOString(), ...overrides,
    } };
}
function validationSettled(f: ReturnType<typeof fixture>, n: number, validationId: string, outcome = 'waived') {
  return { eventId: id(6, n), kind: 'validation_decision_settled', dotRequestId: id(3, 1),
    sourceRevision: n, at: new Date(f.time()).toISOString(),
    data: { validationId, outcome, decidedAt: outcome === 'closed' ? null : new Date(f.time()).toISOString() } };
}
type ValidationPage = { validations: Record<string, unknown>[]; nextCursor: string | null };

test('validation listing preserves masked views and pages oldest first with validationId ties', () => {
  const f = fixture(); admitted(f);
  const first = validationPending(f, 1, { validationId: 'validation_b', title: '[quoted text]',
    summary: 'The report mentions [path] and [email].', summaryWithheld: false });
  const tied = validationPending(f, 2, { validationId: '__proto__' });
  const newest = validationPending(f, 3, { createdAt: new Date(f.time() + 1000).toISOString() });
  f.endpoint('events.post', { generation: 1, events: [first, tied, newest] });
  f.restore();
  const page = result<ValidationPage>(f.tool('nash_list_validation_decisions', { limit: 2 }));
  assert.deepEqual(page.validations, [tied.data, first.data]);
  assert.ok(page.nextCursor);
  const remainder = result<ValidationPage>(f.tool('nash_list_validation_decisions', { limit: 2, cursor: page.nextCursor }));
  assert.deepEqual(remainder, { validations: [newest.data], nextCursor: null });
  assert.equal(f.tool('nash_list_validation_decisions', { cursor: 'unknown' }).error?.code, 'payload_invalid');
  assert.deepEqual(result<ValidationPage>(f.tool('nash_list_validation_decisions', { dotRequestId: id(3, 2) })),
    { validations: [], nextCursor: null });
  assert.equal(f.tool('nash_list_validation_decisions', {}, 'another-owner').error?.code, 'unauthorized');
});

test('validation decisions deduplicate before open checks and expire thirty minutes after each call', () => {
  const f = fixture(); admitted(f);
  const pending = validationPending(f, 1);
  f.endpoint('events.post', { generation: 1, events: [pending] });
  f.advance(100);
  const args = { validationId: pending.data.validationId, decisionId: id(4, 1), decision: 'waive' };
  const receipt = result<{ receipt: Receipt }>(f.tool('nash_decide_validation', args)).receipt;
  assert.equal(receipt.dotRequestId, id(3, 1));
  assert.equal(receipt.expiresAt, new Date(f.time() + 1800_000).toISOString());
  assert.equal(f.state().items[1].receipt.dependsOnItemId, id(1, 1));
  assert.deepEqual(f.state().items[1].payload, { ...args, contractVersion: 3 });
  const second = result<{ receipt: Receipt }>(f.tool('nash_decide_validation', { ...args, decisionId: id(4, 2), decision: 'reject' })).receipt;
  assert.notEqual(second.itemId, receipt.itemId);
  const items = f.lease();
  assert.equal(items.length, 2);
  result(f.ack(items[0])); result(f.ack(items[1]));
  f.endpoint('events.post', { generation: 1, events: [validationSettled(f, 2, pending.data.validationId)] });
  f.restore();
  assert.equal(result<{ receipt: Receipt }>(f.tool('nash_decide_validation', args)).receipt.itemId, receipt.itemId);
  assert.equal(f.tool('nash_decide_validation', { ...args, decision: 'reject' }).error?.code, 'idempotency_conflict');
  assert.equal(f.tool('nash_decide_validation', { ...args, validationId: 'another_validation' }).error?.code, 'idempotency_conflict');
  assert.equal(f.tool('nash_decide_validation', { ...args, decisionId: id(4, 3) }).error?.code, 'validation_decision_not_open');
  const projection = result<{ request: { validationDecisions: unknown[] } }>(f.tool('nash_get_request', { dotRequestId: id(3, 1) }));
  assert.deepEqual(projection.request.validationDecisions, [validationSettled(f, 2, pending.data.validationId)]);
});

test('only the oldest fifty validations are open and overflow becomes available after settlement', () => {
  const f = fixture(); admitted(f);
  const events = Array.from({ length: 60 }, (_, index) => validationPending(f, index + 1,
    { createdAt: new Date(f.time() - (index + 1) * 1000).toISOString() }));
  f.endpoint('events.post', { generation: 1, events: events.slice(0, 50) });
  f.endpoint('events.post', { generation: 1, events: events.slice(50) });
  f.restore();
  const page = result<ValidationPage>(f.tool('nash_list_validation_decisions', { limit: 50 }));
  assert.equal(page.validations.length, 50);
  assert.equal(page.validations[0].validationId, 'validation_60');
  assert.equal(page.validations.at(-1)!.validationId, 'validation_11');
  assert.equal(page.nextCursor, null);
  assert.equal(f.tool('nash_decide_validation', { decisionId: id(4, 1), validationId: 'validation_10', decision: 'waive' }).error?.code,
    'validation_decision_not_open');
  f.endpoint('events.post', { generation: 1, events: [validationSettled(f, 61, 'validation_60')] });
  f.restore();
  const after = result<ValidationPage>(f.tool('nash_list_validation_decisions', { limit: 50 }));
  assert.equal(after.validations.length, 50);
  assert.equal(after.validations.at(-1)!.validationId, 'validation_10');
  assert.ok(f.tool('nash_decide_validation', { decisionId: id(4, 2), validationId: 'validation_10', decision: 'reject' }).result);
});

test('settled validations never reopen at higher revisions or after projection eviction', () => {
  const f = fixture(); admitted(f);
  f.endpoint('events.post', { generation: 1, events: [validationPending(f, 1), validationSettled(f, 2, 'validation_1')] });
  const events = Array.from({ length: 51 }, (_, index) => validationPending(f, index + 3));
  f.endpoint('events.post', { generation: 1, events: events.slice(0, 50) });
  f.endpoint('events.post', { generation: 1, events: events.slice(50) });
  f.restore();
  const late = validationPending(f, 54, { validationId: 'validation_1' });
  f.endpoint('events.post', { generation: 1, events: [late] });
  f.restore();
  const visible = result<ValidationPage>(f.tool('nash_list_validation_decisions', { limit: 50 }));
  assert.equal(visible.validations.some((view) => view.validationId === 'validation_1'), false);
  assert.equal(f.tool('nash_decide_validation', { validationId: 'validation_1', decisionId: id(4, 1), decision: 'waive' }).error?.code,
    'validation_decision_not_open');
});

test('pending event age expires logically before cleanup and accepted mapping remains required', () => {
  const f = fixture(); admitted(f);
  const now = f.time();
  const old = { ...validationPending(f, 1), at: new Date(now - 7 * 86_400_000).toISOString() };
  f.endpoint('events.post', { generation: 1, events: [old] });
  assert.deepEqual(result<ValidationPage>(f.tool('nash_list_validation_decisions')), { validations: [], nextCursor: null });
  assert.equal(f.tool('nash_decide_validation', { validationId: old.data.validationId, decisionId: id(4, 1), decision: 'waive' }).error?.code,
    'validation_decision_not_open');
  const unknown = { ...validationPending(f, 2), dotRequestId: id(3, 2),
    data: { ...validationPending(f, 2).data, dotRequestId: id(3, 2) } };
  assert.equal(result<{ results: { status: string }[] }>(f.endpoint('events.post', { generation: 1, events: [unknown] })).results[0].status,
    'unknown_request');
  assert.equal(f.state().items.length, 1, 'not-open decisions enqueue nothing');
});

test('validation view refinements reject mismatched requests and inconsistent withheld or settled fields', () => {
  const f = fixture(); admitted(f);
  const pending = validationPending(f, 1);
  const invalid = [
    { ...pending, data: { ...pending.data, dotRequestId: id(3, 2) } },
    { ...pending, data: { ...pending.data, summary: 'Must remain withheld.' } },
    { ...validationSettled(f, 1, 'validation_1'), data: { validationId: 'validation_1', outcome: 'waived', decidedAt: null } },
    { ...validationSettled(f, 1, 'validation_1'), data: { validationId: 'validation_1', outcome: 'closed', decidedAt: new Date(f.time()).toISOString() } },
    { ...pending, data: { ...pending.data, title: 'Hidden\u202Econtrol' } },
  ];
  for (const [index, event] of invalid.entries()) assert.equal(f.endpoint('events.post', { generation: 1, events: [event] }).error?.code, 'payload_invalid', `invalid refinement ${index}`);
  assert.equal(f.state().requests[id(3, 1)].appliedRevision, 0);
});

test('older request snapshots gain an empty validation fold and old heartbeats never appear online', () => {
  const f = fixture(); admitted(f);
  const old = f.state();
  delete (old.requests[id(3, 1)] as unknown as Record<string, unknown>).validationDecisions;
  old.heartbeat = { lastSeenAt: new Date(f.time()).toISOString(), appVersion: 'v3-fixture', contractVersion: 3 };
  f.restore(old);
  assert.deepEqual(result<ValidationPage>(f.tool('nash_list_validation_decisions')), { validations: [], nextCursor: null });
  assert.deepEqual(result<{ request: { validationDecisions: unknown[] } }>(f.tool('nash_get_request', { dotRequestId: id(3, 1) })).request.validationDecisions, []);
  const status = result<{ status: { online: boolean; contractVersion: number | null; manifestSha256: string } }>(f.tool('nash_status')).status;
  assert.equal(status.online, false);
  assert.equal(status.contractVersion, null);
  assert.match(status.manifestSha256, /^[a-f0-9]{64}$/);
  for (const contractVersion of [2, 3]) {
    assert.equal(f.endpoint('heartbeat.post', { generation: 1, appVersion: 'old-fixture', contractVersion,
      sentAt: new Date(f.time()).toISOString() }).error?.code, 'payload_invalid');
  }
  assert.ok(f.endpoint('heartbeat.post', { generation: 1, appVersion: 'v4-fixture', contractVersion: 4,
    sentAt: new Date(f.time()).toISOString() }).result);
  const current = result<{ status: { online: boolean; contractVersion: number } }>(f.tool('nash_status')).status;
  assert.equal(current.online, true);
  assert.equal(current.contractVersion, 4);
});

test('a workspace list stored before v4 is dropped until NASH publishes one with each maximum', () => {
  const f = fixture();
  const publishedAt = new Date(f.time()).toISOString();
  const old = f.state();
  old.workspaces = [{ workspaceRef, displayName: 'Docs' }] as unknown as RemoteMailboxState['workspaces'];
  old.publishedAt = publishedAt;
  f.restore(old);
  assert.deepEqual(result(f.tool('nash_list_workspaces')), { workspaces: [], publishedAt: null });
  assert.equal(f.endpoint('workspaces.put', { generation: 1, publishedAt,
    workspaces: [{ workspaceRef, displayName: 'Docs' }] }).error?.code, 'payload_invalid');
  const workspaces = [{ workspaceRef, displayName: 'Docs', maxAccess: 'workspace_write' },
    { workspaceRef: 'dws_89abcdef0123456789abcdef', displayName: 'Notes', maxAccess: 'read_only' }];
  assert.ok(f.endpoint('workspaces.put', { generation: 1, publishedAt, workspaces }).result);
  f.restore();
  assert.deepEqual(result(f.tool('nash_list_workspaces')), { workspaces, publishedAt });
});

test('dot may ask for workspace write; the Site queues it unchanged and records the refusal of NASH', () => {
  const f = fixture();
  const write = f.submit(1, { requestedAccess: 'workspace_write' });
  const above = f.submit(2, { requestedAccess: 'workspace_write' });
  assert.equal(f.tool('nash_submit_task', { workspaceRef, objective: 'Review the docs.',
    idempotencyKey: id(2, 3), requestedAccess: 'full_access' }).error?.code, 'payload_invalid');
  const [first, second] = f.lease();
  assert.equal(first.payload.requestedAccess, 'workspace_write');
  assert.equal(first.payload.contractVersion, 3);
  assert.ok(f.ack(first).result);
  const refusal = { by: 'nash', code: 'dot_access_above_maximum',
    message: 'The requested access is above the maximum the user set for this workspace. Ask for less access, or ask the user to raise the maximum in the app.' };
  assert.ok(f.ack(second, { outcome: 'refused', dotRequestId: null, refusal }).result);
  const request = result<{ request: { requestedAccess: string } }>(f.tool('nash_get_request', { dotRequestId: id(3, 1) })).request;
  assert.equal(request.requestedAccess, 'workspace_write');
  assert.equal(result<{ receipt: Receipt }>(f.tool('nash_get_receipt', { itemId: write.itemId })).receipt.state, 'accepted');
  const refused = result<{ receipt: Receipt }>(f.tool('nash_get_receipt', { itemId: above.itemId })).receipt;
  assert.equal(refused.state, 'refused');
  assert.deepEqual(refused.refusal, refusal);
});

test('unpaired validation reads are empty and validation writes refuse before storing', () => {
  const f = fixture();
  f.endpoint('pairing.revoke', { generation: 1 });
  assert.deepEqual(result<ValidationPage>(f.tool('nash_list_validation_decisions')), { validations: [], nextCursor: null });
  assert.equal(f.tool('nash_decide_validation', { decisionId: id(4, 1), validationId: '__proto__', decision: 'reject' }).error?.code,
    'nash_never_paired');
  assert.equal(f.state().items.length, 0);
});


test('restored queued v2 payloads keep their hashes and expire without being delivered as v3', () => {
  const f = fixture();
  const legacy = f.submit(1);
  const old = f.state();
  old.items[0].payload!.contractVersion = 2;
  const originalHash = payloadSha256(old.items[0].payload);
  old.items[0].receipt.payloadSha256 = originalHash;
  old.items[0].dedupHash = originalHash;
  f.restore(old);
  const current = f.submit(2);
  const delivered = f.lease();
  assert.deepEqual(delivered.map((item) => item.itemId), [current.itemId]);
  assert.equal(delivered[0].payload.contractVersion, 3);
  const retained = result<{ receipt: Receipt }>(f.tool('nash_get_receipt', { itemId: legacy.itemId })).receipt;
  assert.equal(retained.state, 'queued');
  assert.equal(retained.payloadSha256, originalHash);
  assert.equal(f.state().items[0].payload!.contractVersion, 2);
  f.advance(1800);
  const expired = result<{ receipt: Receipt }>(f.tool('nash_get_receipt', { itemId: legacy.itemId })).receipt;
  assert.equal(expired.state, 'expired');
  assert.equal(expired.payloadSha256, originalHash);
});
