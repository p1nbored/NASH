import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:5178');
if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Loopback fixture only');
const artifacts = JSON.parse(readFileSync(new URL('../generated/remote-artifacts.json', import.meta.url)));
assert.equal(artifacts.manifest.contractVersion, 4, 'Run this smoke with the pinned v4 artifacts');
assert.equal(artifacts.vectors.contractVersion, 4);
assert.equal(artifacts.manifest.injected.contractVersion, 3);
assert.equal(artifacts.manifest.tools.length, 12);
assert.equal(artifacts.endpointTable.endpoints.length, 13);
const toolsUsed = new Set(); const endpointsUsed = new Set();
let cookie = ''; let session; let deviceCredential; let requestId = 0;
const now = () => new Date().toISOString();
async function endpoint(name, body, ownerAction = false, itemId) {
  const route = artifacts.endpointTable.endpoints.find((entry) => entry.name === name);
  assert.ok(route, 'Unknown generated endpoint'); endpointsUsed.add(name);
  const path = route.path.replace('{itemId}', itemId ?? '');
  const response = await fetch(new URL(path, origin), { method: route.method, headers: {
    'content-type': 'application/json', origin: origin.origin,
    ...(ownerAction ? { cookie } : { 'OAI-Sites-Authorization': 'Bearer local-fixture-only',
      ...(session ? { 'Nash-Session': session.sessionToken } : {}) }),
    ...(name === 'pairing.session.refresh' && deviceCredential ? { 'Nash-Device-Credential': deviceCredential.credential } : {}),
  }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function tool(name, args = {}) {
  toolsUsed.add(name);
  const response = await fetch(new URL('/mcp', origin), { method: 'POST', headers: {
    'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: origin.origin, cookie,
  }, body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: args } }) });
  assert.equal(response.status, 200, 'Local MCP HTTP call failed');
  const data = await response.json(); assert.ok(data.result, 'Missing MCP result');
  return data.result;
}
function good(response) { assert.equal(response.status, 200, 'Local endpoint failed'); assert.equal(response.body.error, undefined); return response.body; }
const signIn = await fetch(new URL('/signin-with-chatgpt?return_to=/', origin), { redirect: 'manual' });
cookie = signIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
assert.ok(cookie, 'Use the portable dev preview for the local demo account');
const discoveryResponse = await fetch(new URL('/mcp', origin), { method: 'POST', headers: {
  'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: origin.origin, cookie,
}, body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: 'tools/list' }) });
assert.equal(discoveryResponse.status, 200);
const discovery = await discoveryResponse.json();
assert.equal(discovery.result.tools.length, 12);
assert.deepEqual(discovery.result.tools.map((entry) => entry.name), artifacts.manifest.tools.map((entry) => entry.name));
const challenge = good(await endpoint('pairing.challenge.create', { appVersion: 'fake-nash-1.4.0' }));
assert.equal(good(await endpoint('pairing.session.issue', { challengeId: challenge.challengeId, deviceCode: challenge.deviceCode })).state, 'pending');
assert.equal(good(await endpoint('pairing.approve', { userCode: challenge.userCode, decision: 'approve' }, true)).outcome, 'approved');
const issued = good(await endpoint('pairing.session.issue', { challengeId: challenge.challengeId, deviceCode: challenge.deviceCode }));
assert.equal(issued.state, 'issued'); session = issued.session; deviceCredential = issued.deviceCredential;
const workspaceRef = 'dws_0123456789abcdef01234567';
const workspaceVector = artifacts.vectors.vectors.find((vector) => vector.id === 'accepted.nash_list_workspaces');
const workspaceBody = structuredClone(workspaceVector.steps.find((step) => step.endpoint === 'workspaces.put').body);
workspaceBody.generation = session.generation; if ('publishedAt' in workspaceBody) workspaceBody.publishedAt = now();
good(await endpoint('workspaces.put', workspaceBody));
good(await endpoint('heartbeat.post', { generation: session.generation, appVersion: 'fake-nash-1.4.0', contractVersion: artifacts.manifest.contractVersion, sentAt: now() }));
assert.equal((await tool('nash_status')).structuredContent.status.online, true);
const listed = (await tool('nash_list_workspaces')).structuredContent.workspaces;
assert.equal(listed.length, 2);
assert.equal(listed.find((entry) => entry.workspaceRef === workspaceRef).maxAccess, 'workspace_write');
const idempotencyKey = randomUUID();
const input = { workspaceRef, objective: 'Summarize the local fixture docs.', idempotencyKey, requestedAccess: 'workspace_write' };
const receipt = (await tool('nash_submit_task', input)).structuredContent.receipt;
assert.equal((await tool('nash_submit_task', input)).structuredContent.receipt.itemId, receipt.itemId);
assert.equal((await tool('nash_get_receipt', { itemId: receipt.itemId })).structuredContent.receipt.state, 'queued');
assert.ok((await tool('nash_list_requests')).structuredContent);
const lease = good(await endpoint('inbox.lease', { generation: session.generation, maxItems: 10 }));
assert.equal(lease.items.length, 1); const item = lease.items[0];
assert.equal(item.payload.idempotencyKey, idempotencyKey);
assert.equal(item.payload.requestedAccess, 'workspace_write');
assert.equal(item.payload.contractVersion, artifacts.manifest.injected.contractVersion);
const extended = good(await endpoint('inbox.renew', { itemId: item.itemId, leaseNonce: item.lease.leaseNonce,
  generation: session.generation }, false, item.itemId));
assert.equal(extended.leaseNonce, item.lease.leaseNonce);
const dotRequestId = randomUUID();
function ackBody(item, extra = {}) { return { itemId: item.itemId, leaseNonce: item.lease.leaseNonce,
  generation: session.generation, payloadSha256: item.payloadSha256, ackedAt: now(), outcome: 'accepted', dotRequestId, ...extra }; }
good(await endpoint('inbox.ack', ackBody(item), false, item.itemId));
const promptVector = artifacts.vectors.vectors.find((vector) => vector.id === 'accepted.nash_answer_permission_prompt');
const prompt = structuredClone(promptVector.steps.find((step) => step.endpoint === 'events.post').body.events.find((event) => event.kind === 'permission_prompt_opened'));
const decisionId = randomUUID(); const timestamp = now();
prompt.eventId = randomUUID(); prompt.dotRequestId = dotRequestId; prompt.sourceRevision = 1; prompt.at = timestamp;
prompt.data.dotRequestId = dotRequestId; prompt.data.decisionId = decisionId; prompt.data.createdAt = timestamp;
prompt.data.deadlineAt = new Date(Date.now() + 240_000).toISOString();
good(await endpoint('events.post', { generation: session.generation, events: [prompt] }));
assert.ok((await tool('nash_get_request', { dotRequestId })).structuredContent);
assert.equal((await tool('nash_list_permission_prompts', { dotRequestId })).structuredContent.decisions.length, 1);
assert.equal((await tool('nash_answer_permission_prompt', { decisionId, decision: 'deny' })).isError, undefined);
assert.equal((await tool('nash_send_message_to_run', { dotRequestId, messageId: randomUUID(), text: 'Summarize the fixture status.' })).isError, undefined);
assert.equal((await tool('nash_cancel_request', { submitItemId: receipt.itemId })).isError, undefined);
const controls = good(await endpoint('inbox.lease', { generation: session.generation, maxItems: 10 })).items;
assert.equal(controls.length, 3);
for (const control of controls) good(await endpoint('inbox.ack', ackBody(control), false, control.itemId));
const validationVector = artifacts.vectors.vectors.find((vector) => vector.id === 'accepted.nash_decide_validation');
assert.ok(validationVector, 'Missing final v3 validation vector');
const pending = structuredClone(validationVector.steps.find((step) => step.endpoint === 'events.post'
  && step.body.events.some((event) => event.kind === 'validation_decision_pending')).body.events.find((event) => event.kind === 'validation_decision_pending'));
const validationId = `validation_${randomUUID()}`; const validationAt = now();
pending.eventId = randomUUID(); pending.dotRequestId = dotRequestId; pending.sourceRevision = 2; pending.at = validationAt;
pending.data.validationId = validationId; pending.data.dotRequestId = dotRequestId; pending.data.createdAt = validationAt;
good(await endpoint('events.post', { generation: session.generation, events: [pending] }));
const validations = (await tool('nash_list_validation_decisions', { dotRequestId })).structuredContent.validations;
assert.equal(validations.length, 1); assert.equal(validations[0].validationId, validationId);
const validationInput = structuredClone(validationVector.steps.find((step) => step.tool === 'nash_decide_validation').arguments);
validationInput.decisionId = randomUUID(); validationInput.validationId = validationId;
const validationReceipt = (await tool('nash_decide_validation', validationInput)).structuredContent.receipt;
assert.equal(validationReceipt.kind, 'validation_decision'); assert.equal(validationReceipt.state, 'queued');
assert.equal(validationReceipt.dependsOnItemId, receipt.itemId);
assert.equal((await tool('nash_decide_validation', validationInput)).structuredContent.receipt.itemId, validationReceipt.itemId);
const validationLease = good(await endpoint('inbox.lease', { generation: session.generation, maxItems: 10 })).items;
assert.equal(validationLease.length, 1); assert.equal(validationLease[0].itemId, validationReceipt.itemId);
assert.equal(validationLease[0].payload.validationId, validationId);
good(await endpoint('inbox.ack', ackBody(validationLease[0]), false, validationLease[0].itemId));
const settled = structuredClone(validationVector.steps.find((step) => step.endpoint === 'events.post'
  && step.body.events.some((event) => event.kind === 'validation_decision_settled')).body.events.find((event) => event.kind === 'validation_decision_settled'));
settled.eventId = randomUUID(); settled.dotRequestId = dotRequestId; settled.sourceRevision = 3; settled.at = now();
settled.data.validationId = validationId; settled.data.decidedAt = settled.at;
good(await endpoint('events.post', { generation: session.generation, events: [settled] }));
assert.equal((await tool('nash_list_validation_decisions', { dotRequestId })).structuredContent.validations.length, 0);
assert.equal((await tool('nash_get_receipt', { itemId: validationReceipt.itemId })).structuredContent.receipt.state, 'accepted');
const renewed = good(await endpoint('pairing.session.renew', { generation: session.generation })); session = renewed.session;
const refreshed = good(await endpoint('pairing.session.refresh', { generation: session.generation }));
assert.notEqual(refreshed.deviceCredential.credential, deviceCredential.credential);
assert.equal(refreshed.deviceCredential.expiresAt, deviceCredential.expiresAt);
session = refreshed.session; deviceCredential = refreshed.deviceCredential;
good(await endpoint('pairing.revoke', { generation: session.generation }));
const revoked = await endpoint('inbox.lease', { generation: session.generation, maxItems: 10 });
assert.equal(revoked.body.error.code, 'generation_revoked');
assert.equal((await tool('nash_submit_task', { ...input, idempotencyKey: randomUUID() })).structuredContent.error.code, 'nash_never_paired');
const nextChallenge = good(await endpoint('pairing.challenge.create', { appVersion: 'fake-nash-1.4.0' }));
good(await endpoint('pairing.approve', { userCode: nextChallenge.userCode, decision: 'approve' }, true));
const nextIssued = good(await endpoint('pairing.session.issue', { challengeId: nextChallenge.challengeId, deviceCode: nextChallenge.deviceCode }));
session = nextIssued.session; deviceCredential = nextIssued.deviceCredential;
assert.equal(good(await endpoint('pairing.owner.revoke', { generation: session.generation }, true)).revokedGeneration, session.generation);
assert.equal((await endpoint('pairing.session.refresh', { generation: session.generation })).body.error.code, 'generation_revoked');
assert.deepEqual([...toolsUsed].sort(), artifacts.manifest.tools.map((entry) => entry.name).sort());
assert.deepEqual([...endpointsUsed].sort(), artifacts.endpointTable.endpoints.map((entry) => entry.name).sort());
process.stdout.write('v3 local HTTP smoke passed: all12 tools, all13 routes, pairing/pending/approval/issue/renew/refresh/owner and device revoke, workspace/v3 heartbeat, dedup, lease/renew/ack, prompts, validation pending/list/decide/ack/settled and generation fencing. No real NASH tasks or credentials.\n');
