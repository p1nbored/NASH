import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleScaffoldMcp } from '../lib/mcp-scaffold.ts';
import { jsonRecord } from './json-record.ts';

const dependencies = {
  ownerUserId: 'owner-a',
  consumeCall: async () => ({ allowed: true, retryAfterSeconds: 0 }),
};
const headers = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-06-18',
};
function request(method: string, params: unknown = {}, extra = {}, id: unknown = 1) {
  return new Request('http://localhost:5173/mcp', {
    method: 'POST', headers: { ...headers, ...extra },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

test('initialization negotiates only supported protocol versions and creates no session', async () => {
  const response = await handleScaffoldMcp(request('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-agent', version: '1' },
  }), dependencies);
  const body = jsonRecord(await response.json());
  assert.equal(jsonRecord(body.result).protocolVersion, '2025-06-18');
  assert.equal(response.headers.get('mcp-session-id'), null);
  assert.deepEqual(jsonRecord(body.result).capabilities, { tools: { listChanged: false } });
});

test('tool discovery contains only scaffold status with the extracted v2 hello schema', async () => {
  const response = await handleScaffoldMcp(request('tools/list'), { ...dependencies, ownerUserId: null });
  const body = jsonRecord(await response.json());
  const tools = jsonRecord(body.result).tools;
  assert.ok(Array.isArray(tools));
  assert.deepEqual(tools.map((tool) => jsonRecord(tool).name), ['nash_status']);
  const schema = jsonRecord(jsonRecord(tools[0]).inputSchema);
  assert.equal(jsonRecord(jsonRecord(schema.properties).contractVersion).const, 2);
  assert.equal(schema.additionalProperties, false);
});

test('a status call is authenticated and never claims an App connection', async () => {
  const response = await handleScaffoldMcp(request('tools/call', {
    name: 'nash_status', arguments: { contractVersion: 2 },
  }), dependencies);
  const body = jsonRecord(await response.json());
  const result = jsonRecord(jsonRecord(body.result).structuredContent);
  assert.equal(result.scaffold, true);
  assert.equal(result.online, false);
  assert.equal(result.paired, false);
  assert.equal(result.remoteAccess, false);
});

test('identity-less service access never authorizes owner data', async () => {
  const response = await handleScaffoldMcp(request('tools/call', {
    name: 'nash_status', arguments: { contractVersion: 2 },
  }, { 'OAI-Sites-Authorization': 'Bearer fake-test-only' }), { ...dependencies, ownerUserId: null });
  assert.equal(response.status, 401);
});

test('cross-origin requests are rejected before any storage call', async () => {
  let calls = 0;
  const response = await handleScaffoldMcp(request('tools/list', {}, { origin: 'https://unrelated.example' }), {
    ...dependencies, consumeCall: async () => { calls++; return { allowed: true, retryAfterSeconds: 0 }; },
  });
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test('malformed RPC envelopes and batch requests are rejected', async () => {
  for (const body of ['[{}]', '{', JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'ping' }),
    JSON.stringify({ jsonrpc: '2.0', id: {}, method: 'ping' })]) {
    const response = await handleScaffoldMcp(new Request('http://localhost:5173/mcp', {
      method: 'POST', headers, body,
    }), dependencies);
    assert.equal(response.status, 400);
  }
});

test('unknown schema fields and wrong contract versions cannot call status', async () => {
  for (const args of [{ contractVersion: 1 }, { contractVersion: 2, approved: true },
    { contractVersion: 2, client: { name: 'C:\\private', version: '1' } }]) {
    const body = jsonRecord(await (await handleScaffoldMcp(request('tools/call', {
      name: 'nash_status', arguments: args,
    }), dependencies)).json());
    assert.equal(jsonRecord(body.error).code, -32602);
  }
});

test('write tools stay unavailable until the generated R2 manifest is integrated', async () => {
  const body = jsonRecord(await (await handleScaffoldMcp(request('tools/call', {
    name: 'nash_submit_task', arguments: { contractVersion: 2 },
  }), dependencies)).json());
  assert.equal(jsonRecord(body.error).code, -32602);
});

test('per-owner rate limit uses a bounded generic response and retry-after', async () => {
  const response = await handleScaffoldMcp(request('tools/call', {
    name: 'nash_status', arguments: { contractVersion: 2 },
  }), { ...dependencies, consumeCall: async () => ({ allowed: false, retryAfterSeconds: 12 }) });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '12');
});

test('notifications return 202 and GET does not offer an SSE stream', async () => {
  const notification = new Request('http://localhost:5173/mcp', {
    method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  const response = await handleScaffoldMcp(notification, dependencies);
  assert.equal(response.status, 202);
  assert.equal(await response.text(), '');
  assert.equal((await handleScaffoldMcp(new Request('http://localhost:5173/mcp'), dependencies)).status, 405);
});

test('unsupported protocol, unsuitable Accept and overlarge body are rejected', async () => {
  assert.equal((await handleScaffoldMcp(request('ping', {}, { 'mcp-protocol-version': 'unsupported' }), dependencies)).status, 400);
  assert.equal((await handleScaffoldMcp(request('ping', {}, { accept: 'text/html' }), dependencies)).status, 406);
  assert.equal((await handleScaffoldMcp(new Request('http://localhost:5173/mcp', {
    method: 'POST', headers, body: 'x'.repeat(70_000),
  }), dependencies)).status, 413);
});

test('storage failures do not disclose exception strings', async () => {
  const response = await handleScaffoldMcp(request('tools/call', {
    name: 'nash_status', arguments: { contractVersion: 2 },
  }), { ...dependencies, consumeCall: async () => { throw new Error('SECRET fixture C:\\private'); } });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /SECRET|private/);
});
