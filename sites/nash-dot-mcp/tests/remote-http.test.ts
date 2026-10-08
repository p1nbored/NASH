import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleRemoteEndpoint } from '../lib/remote-http.ts';
import { remoteError } from '../lib/remote-contracts.ts';
import { jsonRecord } from './json-record.ts';

function request(path: string, body = {}, headers = {}) {
  return new Request(`http://127.0.0.1:5178${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', 'OAI-Sites-Authorization': 'Bearer local-fixture-only', ...headers,
  }, body: JSON.stringify(body) });
}
function deps() {
  let calls = 0;
  return { localPreview: true, ownerId: 'local_seedy',
    consumeRequest: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    endpoint: async () => { calls++; return { error: remoteError('challenge_not_found') }; },
    get calls() { return calls; } };
}

test('production cannot issue sessions or admit the local service fixture', async () => {
  const dependencies = deps();
  const response = await handleRemoteEndpoint(request('/nash/v1/pairing/challenges', { appVersion: '1.4.0' }), { ...dependencies, localPreview: false });
  assert.equal(response.status, 503); assert.equal(dependencies.calls, 0);
});

test('private Sites dispatch admits service requests without forwarding its consumed bearer', async () => {
  const dependencies = deps();
  const hosted = new Request('https://nash-dot-mcp.white-bean-7669.chatgpt.site/nash/v1/pairing/challenges', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appVersion: '1.4.0' }),
  });
  const response = await handleRemoteEndpoint(hosted, { ...dependencies, localPreview: false, hostedPrivateSite: true });
  assert.equal(response.status, 404); assert.equal(dependencies.calls, 1);
});

test('private hosted owner revoke still requires verified owner identity and same-origin request', async () => {
  const make = (headers: Record<string, string>) => new Request('https://nash-dot-mcp.white-bean-7669.chatgpt.site/pairing/revoke', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ generation: 1 }),
  });
  const hosted = { ...deps(), localPreview: false, hostedPrivateSite: true };
  assert.equal((await handleRemoteEndpoint(make({}), hosted)).status, 403);
  assert.equal((await handleRemoteEndpoint(make({ origin: 'https://nash-dot-mcp.white-bean-7669.chatgpt.site' }), { ...hosted, ownerId: null })).status, 401);
});

test('device credentials are forwarded only from the header into pairing context', async () => {
  let credential: string | undefined;
  const response = await handleRemoteEndpoint(request('/nash/v1/session/refresh', { generation: 1 }, {
    'Nash-Device-Credential': 'ndc_000000000000000000000001.FIXTUREdeviceCredentialSecret00000000000000000001',
  }), { ...deps(), endpoint: async (_name, _body, context) => {
    credential = context.deviceCredential; return { error: remoteError('device_credential_invalid') };
  } });
  assert.equal(response.status, 401);
  assert.equal(credential, 'ndc_000000000000000000000001.FIXTUREdeviceCredentialSecret00000000000000000001');
  const invalid = await handleRemoteEndpoint(request('/nash/v1/session/refresh', { generation: 1, deviceCredential: credential }), deps());
  assert.equal(invalid.status, 400);
});
test('owner approval requires identity and Origin while service requests require local admission', async () => {
  assert.equal((await handleRemoteEndpoint(request('/pairing/approve', { userCode: 'BCDF-GHJK', decision: 'approve' }), deps())).status, 403);
  assert.equal((await handleRemoteEndpoint(request('/pairing/approve', { userCode: 'BCDF-GHJK', decision: 'approve' }, { origin: 'http://127.0.0.1:5178' }), { ...deps(), ownerId: null })).status, 401);
  assert.equal((await handleRemoteEndpoint(request('/nash/v1/pairing/challenges', { appVersion: '1.4.0' }, { 'OAI-Sites-Authorization': 'Bearer not-admitted' }), deps())).status, 401);
});
test('heartbeat accepts contract v4 and rejects older payloads before workflow storage', async () => {
  const dependencies = deps();
  const heartbeat = { generation: 1, appVersion: '1.4.0', contractVersion: 2, sentAt: '2026-10-05T12:00:00.000Z' };
  for (const contractVersion of [2, 3]) {
    const obsolete = await handleRemoteEndpoint(request('/nash/v1/heartbeat', { ...heartbeat, contractVersion }), dependencies);
    assert.equal(obsolete.status, 400); assert.equal(dependencies.calls, 0);
  }
  const current = await handleRemoteEndpoint(request('/nash/v1/heartbeat', { ...heartbeat, contractVersion: 4 }), dependencies);
  assert.equal(current.status, 404); assert.equal(dependencies.calls, 1);
});

test('generated endpoint request schemas run before workflow storage', async () => {
  const dependencies = deps();
  const response = await handleRemoteEndpoint(request('/nash/v1/pairing/challenges', { appVersion: '1.4.0', ownerId: 'forged' }), dependencies);
  assert.equal(response.status, 400); assert.equal(dependencies.calls, 0);
});
test('endpoint path and body item IDs must agree', async () => {
  const dependencies = deps();
  const response = await handleRemoteEndpoint(request('/nash/v1/inbox/10000000-0000-4000-8000-000000000001/renew', {
    itemId: '10000000-0000-4000-8000-000000000002', leaseNonce: 'FIXTURElease0nonce000000000001', generation: 1,
  }), dependencies);
  assert.equal(response.status, 400); assert.equal(dependencies.calls, 0);
});
test('endpoint errors retain generated messages and unknown storage errors are generic', async () => {
  const response = await handleRemoteEndpoint(request('/nash/v1/pairing/session', { challengeId: '10000000-0000-4000-8000-000000000001', deviceCode: 'a'.repeat(43) }), deps());
  assert.deepEqual(jsonRecord(await response.json()).error, remoteError('challenge_not_found'));
  const failed = await handleRemoteEndpoint(request('/nash/v1/pairing/challenges', { appVersion: '1.4.0' }), { ...deps(), endpoint: async () => { throw new Error('SECRET local path'); } });
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /SECRET|local path/);
});
