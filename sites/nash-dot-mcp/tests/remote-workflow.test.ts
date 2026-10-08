import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteD1 } from './sqlite-d1.ts';
import { jsonRecord } from './json-record.ts';
import { createRemoteWorkflow } from '../lib/remote-workflow.ts';
import { manifest } from '../lib/remote-contracts.ts';

const owner = 'local_seedy';
const context = { ownerId: owner, platformAdmitted: true };
const submit = { workspaceRef: 'dws_0123456789abcdef01234567', objective: 'Summarize the docs.', idempotencyKey: '20000000-0000-4000-8000-000000000001' };
function fixture() { const db = new SqliteD1(); return { db, workflow: createRemoteWorkflow(db, { now: () => Date.parse('2026-10-05T12:00:00Z') }) }; }
async function enroll(workflow: ReturnType<typeof createRemoteWorkflow>, ownerId = owner) {
  const enrollment = { ownerId, platformAdmitted: true };
  const challengeReply = await workflow.endpoint('pairing.challenge.create', { appVersion: '1.4.0' }, enrollment);
  const challenge = jsonRecord(challengeReply.result);
  assert.equal((await workflow.endpoint('pairing.approve', { userCode: challenge.userCode, decision: 'approve' }, enrollment)).error, undefined);
  const issued = await workflow.endpoint('pairing.session.issue', { challengeId: challenge.challengeId, deviceCode: challenge.deviceCode }, enrollment);
  return { challenge, session: jsonRecord(jsonRecord(issued.result).session) };
}

test('pairing and mailbox state persist together without plaintext codes or tokens', async (t) => {
  const { db, workflow } = fixture(); t.after(() => db.close());
  const { challenge, session } = await enroll(workflow);
  const status = await createRemoteWorkflow(db).tool(owner, 'nash_status', {});
  assert.equal(jsonRecord(jsonRecord(status.result).status).paired, true);
  const persisted = String(db.database.prepare('SELECT state_json FROM remote_scaffold_state').get()?.state_json);
  for (const secret of [challenge.userCode, challenge.deviceCode, session.sessionToken]) assert.equal(persisted.includes(String(secret)), false);
});

test('persisted submit retries return one receipt and wrong owners cannot read it', async (t) => {
  const { db, workflow } = fixture(); t.after(() => db.close()); await enroll(workflow);
  const first = jsonRecord(jsonRecord((await workflow.tool(owner, 'nash_submit_task', submit)).result).receipt);
  const retry = jsonRecord(jsonRecord((await createRemoteWorkflow(db).tool(owner, 'nash_submit_task', submit)).result).receipt);
  assert.equal(retry.itemId, first.itemId);
  assert.equal((await workflow.tool('unrelated-owner', 'nash_get_receipt', { itemId: first.itemId })).error?.code, 'unauthorized');
});

test('revocation invalidates old sessions and queued tasks in the same durable transition', async (t) => {
  const { db, workflow } = fixture(); t.after(() => db.close()); const { session } = await enroll(workflow);
  const receipt = jsonRecord(jsonRecord((await workflow.tool(owner, 'nash_submit_task', submit)).result).receipt);
  const sessionContext = { platformAdmitted: true, sessionToken: String(session.sessionToken) };
  assert.equal((await workflow.endpoint('pairing.revoke', { generation: session.generation }, sessionContext)).error, undefined);
  assert.equal((await workflow.endpoint('inbox.lease', { generation: session.generation, maxItems: 10 }, sessionContext)).error?.code, 'generation_revoked');
  const after = jsonRecord(jsonRecord((await workflow.tool(owner, 'nash_get_receipt', { itemId: receipt.itemId })).result).receipt);
  assert.equal(after.state, 'refused');
  assert.equal(jsonRecord(after.refusal).code, 'pairing_revoked');
});

test('service admission and signed owner approval are independent requirements', async (t) => {
  const { db, workflow } = fixture(); t.after(() => db.close());
  assert.equal((await workflow.endpoint('pairing.challenge.create', { appVersion: '1.4.0' }, { platformAdmitted: false })).error?.code, 'unauthorized');
  const challenge = jsonRecord((await workflow.endpoint('pairing.challenge.create', { appVersion: '1.4.0' }, context)).result);
  assert.equal((await workflow.endpoint('pairing.approve', { userCode: challenge.userCode, decision: 'approve' }, { platformAdmitted: true })).error?.code, 'unauthorized');
});

test('unpaired status calls retain the per-owner quota across workflow recreation', async (t) => {
  const { db } = fixture(); t.after(() => db.close());
  const replies = [];
  for (let call = 0; call < 40; call++) replies.push(await createRemoteWorkflow(db, { now: () => 60_000 }).tool(owner, 'nash_status', {}));
  assert.equal(replies.filter((reply) => !reply.error).length, 30);
  assert.equal(replies.filter((reply) => reply.error?.code === 'rate_limited').length, 10);
});

test('owner page connection reads are scoped and do not consume the tool quota', async (t) => {
  const { db, workflow } = fixture(); t.after(() => db.close()); await enroll(workflow);
  const before = String(db.database.prepare('SELECT state_json FROM remote_scaffold_state').get()?.state_json);
  for (let view = 0; view < 40; view++) assert.equal((await workflow.ownerConnection(owner)).status?.paired, true);
  assert.deepEqual(await workflow.ownerConnection('unrelated-owner'), { binding: null, status: null });
  assert.equal(String(db.database.prepare('SELECT state_json FROM remote_scaffold_state').get()?.state_json), before);
});

test('absolute pairing expiry fences queued tasks and new writes while retaining owner receipts', async (t) => {
  const db = new SqliteD1(); t.after(() => db.close());
  let at = Date.parse('2026-10-05T12:00:00Z');
  const workflow = createRemoteWorkflow(db, { now: () => at }); await enroll(workflow);
  const receipt = jsonRecord(jsonRecord((await workflow.tool(owner, 'nash_submit_task', submit)).result).receipt);
  at += 30 * 86_400_000;
  assert.equal((await workflow.ownerConnection(owner)).status?.paired, false);
  assert.equal((await workflow.tool(owner, 'nash_submit_task', { ...submit, idempotencyKey: '20000000-0000-4000-8000-000000000002' })).error?.code, 'nash_never_paired');
  const oldReceipt = jsonRecord(jsonRecord((await workflow.tool(owner, 'nash_get_receipt', { itemId: receipt.itemId })).result).receipt);
  assert.equal(oldReceipt.state, 'refused');
  assert.equal(jsonRecord(oldReceipt.refusal).code, 'pairing_revoked');
});


const FIXED_TIME = '2026-10-05T12:00:00.000Z';
const REQUEST_A = '30000000-0000-4000-8000-000000000001';
const REQUEST_B = '30000000-0000-4000-8000-000000000002';
const DECISION_A = '40000000-0000-4000-8000-000000000001';
const DECISION_B = '40000000-0000-4000-8000-000000000002';
type Workflow = ReturnType<typeof createRemoteWorkflow>;
function resultRecord(reply: { result?: unknown; error?: { code: string } }) {
  assert.equal(reply.error, undefined);
  return jsonRecord(reply.result);
}
function records(value: unknown) {
  assert.ok(Array.isArray(value));
  return value.map(jsonRecord);
}
function sessionContext(session: Record<string, unknown>) {
  return { platformAdmitted: true, sessionToken: String(session.sessionToken) };
}
async function acceptRequest(workflow: Workflow, session: Record<string, unknown>, ownerId = owner) {
  const receipt = jsonRecord(resultRecord(await workflow.tool(ownerId, 'nash_submit_task', submit)).receipt);
  const caller = sessionContext(session);
  const leased = resultRecord(await workflow.endpoint('inbox.lease', {
    generation: session.generation, maxItems: 10,
  }, caller));
  const item = records(leased.items)[0];
  const lease = jsonRecord(item.lease);
  assert.equal(jsonRecord(item.payload).contractVersion, 3);
  resultRecord(await workflow.endpoint('inbox.ack', {
    itemId: item.itemId, generation: session.generation, leaseNonce: lease.leaseNonce,
    payloadSha256: item.payloadSha256, ackedAt: FIXED_TIME, outcome: 'accepted', dotRequestId: REQUEST_A,
  }, caller, String(item.itemId)));
  return receipt;
}
function pendingDecision(validationId = 'validation_fixture_1', eventNumber = 1) {
  return {
    eventId: '60000000-0000-4000-8000-' + String(eventNumber).padStart(12, '0'),
    kind: 'validation_decision_pending', dotRequestId: REQUEST_A,
    sourceRevision: eventNumber, at: FIXED_TIME,
    data: { validationId, dotRequestId: REQUEST_A, title: 'Review [path]', reason: 'review_inconclusive',
      summary: null, summaryWithheld: true, createdAt: FIXED_TIME },
  };
}

test('older persisted state restores without stale facets or workspaces and stays offline until a v4 heartbeat', async (t) => {
  const { db, workflow } = fixture(); t.after(() => db.close());
  const { session } = await enroll(workflow);
  const receipt = await acceptRequest(workflow, session);
  const row = db.database.prepare('SELECT state_json FROM remote_scaffold_state').get();
  const snapshot = jsonRecord(JSON.parse(String(row?.state_json)));
  const box = records(snapshot.mailboxes)[0];
  for (const request of Object.values(jsonRecord(box.requests))) delete jsonRecord(request).validationDecisions;
  delete box.validationDecisionOverflow;
  delete box.settledValidationIds;
  box.heartbeat = { lastSeenAt: FIXED_TIME, appVersion: 'legacy-fixture-3', contractVersion: 3 };
  box.workspaces = [{ workspaceRef: submit.workspaceRef, displayName: 'Docs' }];
  box.publishedAt = FIXED_TIME;
  db.database.prepare('UPDATE remote_scaffold_state SET state_json = ?, revision = revision + 1')
    .run(JSON.stringify(snapshot));
  const restored = createRemoteWorkflow(db, { now: () => Date.parse(FIXED_TIME) });
  const pageStatus = await restored.ownerConnection(owner);
  assert.equal(pageStatus.status?.online, false);
  assert.equal(pageStatus.status?.lastSeenAt, null);
  const request = jsonRecord(resultRecord(await restored.tool(owner, 'nash_get_request', { dotRequestId: REQUEST_A })).request);
  assert.deepEqual(request.validationDecisions, []);
  assert.equal(jsonRecord(resultRecord(await restored.tool(owner, 'nash_get_receipt', { itemId: receipt.itemId })).receipt).state, 'accepted');
  assert.deepEqual(resultRecord(await restored.tool(owner, 'nash_list_validation_decisions', {})), { validations: [], nextCursor: null });
  const status = jsonRecord(resultRecord(await restored.tool(owner, 'nash_status', {})).status);
  assert.equal(status.paired, true);
  assert.equal(status.online, false);
  assert.equal(status.contractVersion, null);
  assert.equal(status.manifestSha256, manifest.manifestSha256);
  assert.deepEqual(resultRecord(await restored.tool(owner, 'nash_list_workspaces', {})), { workspaces: [], publishedAt: null });
  assert.equal((await restored.endpoint('heartbeat.post', {
    generation: session.generation, appVersion: 'legacy-fixture-3', contractVersion: 3, sentAt: FIXED_TIME,
  }, sessionContext(session))).error?.code, 'payload_invalid');
  resultRecord(await restored.endpoint('heartbeat.post', {
    generation: session.generation, appVersion: 'fixture-4', contractVersion: 4, sentAt: FIXED_TIME,
  }, sessionContext(session)));
  const current = jsonRecord(resultRecord(await restored.tool(owner, 'nash_status', {})).status);
  assert.equal(current.online, true);
  assert.equal(current.contractVersion, 4);
});

test('validation decisions persist with their binding, retain withheld views, and deduplicate before closure', async (t) => {
  const { db, workflow } = fixture(); t.after(() => db.close());
  const { session } = await enroll(workflow);
  const accepted = await acceptRequest(workflow, session);
  const pending = pendingDecision('__proto__');
  resultRecord(await workflow.endpoint('events.post', { generation: session.generation, events: [pending] }, sessionContext(session)));
  const restored = createRemoteWorkflow(db, { now: () => Date.parse(FIXED_TIME) });
  assert.deepEqual(resultRecord(await restored.tool(owner, 'nash_list_validation_decisions', {})), {
    validations: [pending.data], nextCursor: null,
  });
  assert.deepEqual(resultRecord(await restored.tool(owner, 'nash_list_validation_decisions', { dotRequestId: REQUEST_B })), {
    validations: [], nextCursor: null,
  });
  const secondOwner = 'owner-fixture-isolation';
  const { session: secondSession } = await enroll(restored, secondOwner);
  assert.deepEqual(resultRecord(await restored.tool(secondOwner, 'nash_list_validation_decisions', {})), {
    validations: [], nextCursor: null,
  });
  const args = { decisionId: DECISION_A, validationId: pending.data.validationId, decision: 'waive' };
  assert.equal((await restored.tool(secondOwner, 'nash_decide_validation', args)).error?.code, 'validation_decision_not_open');
  assert.equal((await restored.tool('unrelated-owner', 'nash_list_validation_decisions', {})).error?.code, 'unauthorized');
  const wrongBinding = resultRecord(await restored.endpoint('events.post', {
    generation: secondSession.generation, events: [pending],
  }, sessionContext(secondSession)));
  assert.equal(records(wrongBinding.results)[0].status, 'unknown_request');
  const receipt = jsonRecord(resultRecord(await restored.tool(owner, 'nash_decide_validation', args)).receipt);
  assert.equal(receipt.dependsOnItemId, accepted.itemId);
  assert.equal(receipt.dotRequestId, REQUEST_A);
  assert.equal(receipt.kind, 'validation_decision');
  const settled = { ...pending, eventId: '60000000-0000-4000-8000-000000000002', sourceRevision: 2,
    kind: 'validation_decision_settled', data: { validationId: pending.data.validationId, outcome: 'waived', decidedAt: FIXED_TIME } };
  resultRecord(await restored.endpoint('events.post', { generation: session.generation, events: [settled] }, sessionContext(session)));
  const after = createRemoteWorkflow(db, { now: () => Date.parse(FIXED_TIME) });
  assert.deepEqual(resultRecord(await after.tool(owner, 'nash_list_validation_decisions', {})), { validations: [], nextCursor: null });
  assert.equal(jsonRecord(resultRecord(await after.tool(owner, 'nash_decide_validation', args)).receipt).itemId, receipt.itemId);
  assert.equal((await after.tool(owner, 'nash_decide_validation', { ...args, decision: 'reject' })).error?.code, 'idempotency_conflict');
  assert.equal((await after.tool(owner, 'nash_decide_validation', { ...args, decisionId: DECISION_B })).error?.code, 'validation_decision_not_open');
  const projected = jsonRecord(resultRecord(await after.tool(owner, 'nash_get_request', { dotRequestId: REQUEST_A })).request);
  assert.deepEqual(projected.validationDecisions, [settled]);
});

test('validation event refinements and the strict exposure boundary reject invalid batches atomically', async (t) => {
  const { db, workflow } = fixture(); t.after(() => db.close());
  const { session } = await enroll(workflow); await acceptRequest(workflow, session);
  const pending = pendingDecision();
  const cases = [
    { ...pending, data: { ...pending.data, dotRequestId: REQUEST_B } },
    { ...pending, data: { ...pending.data, summary: 'This must be withheld.', summaryWithheld: true } },
    { ...pending, data: { ...pending.data, title: 'Unsafe\u202e title' } },
    { ...pending, data: { ...pending.data, path: 'forbidden-field' } },
    { ...pending, kind: 'validation_decision_settled', data: { validationId: pending.data.validationId, outcome: 'closed', decidedAt: FIXED_TIME } },
  ];
  for (const invalid of cases) assert.equal((await workflow.endpoint('events.post', {
    generation: session.generation, events: [pending, invalid],
  }, sessionContext(session))).error?.code, 'payload_invalid');
  assert.deepEqual(resultRecord(await workflow.tool(owner, 'nash_list_validation_decisions', {})), { validations: [], nextCursor: null });
  const projected = jsonRecord(resultRecord(await workflow.tool(owner, 'nash_get_request', { dotRequestId: REQUEST_A })).request);
  assert.equal(projected.appliedRevision, 0);
  assert.deepEqual(projected.validationDecisions, []);
});
