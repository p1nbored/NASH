import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleScaffoldMcp } from '../lib/mcp-scaffold.ts';
import { publicTools, remoteError } from '../lib/remote-contracts.ts';
import { jsonRecord } from './json-record.ts';

function request(method: string, params = {}) {
  return new Request('http://127.0.0.1:5178/mcp', { method: 'POST', headers: {
    'content-type': 'application/json', accept: 'application/json, text/event-stream',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
}
const deps = { ownerUserId: 'local_seedy', consumeCall: async () => { throw new Error('Engine owns the rate counter'); },
  toolCatalog: publicTools(), invokeTool: async () => ({ error: remoteError('rate_limited') }) };

test('MCP exposes all generated tools without the private routing block', async () => {
  const body = jsonRecord(await (await handleScaffoldMcp(request('tools/list'), deps)).json());
  const tools = jsonRecord(body.result).tools;
  assert.ok(Array.isArray(tools)); assert.equal(tools.length, 12);
  assert.ok(tools.some((tool) => jsonRecord(tool).name === 'nash_list_validation_decisions'));
  assert.ok(tools.some((tool) => jsonRecord(tool).name === 'nash_decide_validation'));
  assert.ok(tools.every((tool) => !Object.hasOwn(tool, 'nash')));
  assert.equal(jsonRecord(jsonRecord(tools[2]).inputSchema).properties !== undefined, true);
});
test('generated tool refusals use MCP isError and structuredContent instead of an RPC error', async () => {
  const response = await handleScaffoldMcp(request('tools/call', { name: 'nash_submit_task', arguments: {} }), deps);
  const body = jsonRecord(await response.json());
  assert.equal(response.status, 200);
  const result = jsonRecord(body.result);
  assert.equal(result.isError, true);
  assert.deepEqual(jsonRecord(result.structuredContent).error, remoteError('rate_limited'));
});
test('generated tool results retain structured output and require identity', async () => {
  const invocation = { ...deps, invokeTool: async () => ({ result: { receipt: { state: 'queued' } } }) };
  const body = jsonRecord(await (await handleScaffoldMcp(request('tools/call', { name: 'nash_submit_task', arguments: {} }), invocation)).json());
  assert.deepEqual(jsonRecord(body.result).structuredContent, { receipt: { state: 'queued' } });
  assert.equal((await handleScaffoldMcp(request('tools/call', { name: 'nash_status' }), { ...invocation, ownerUserId: null })).status, 401);
});
