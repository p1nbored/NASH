import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostedPrivateSite, SITE_ORIGIN } from '../lib/site-deployment.ts';

test('hosted admission is limited to the registered production origin', (t) => {
  const original = process.env.NODE_ENV;
  t.after(() => { if (original === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV'); else Reflect.set(process.env, 'NODE_ENV', original); });
  Reflect.set(process.env, 'NODE_ENV', 'production');
  assert.equal(hostedPrivateSite(new Request(`${SITE_ORIGIN}/nash/v1/pairing/challenges`)), true);
  for (const origin of ['http://127.0.0.1:5178', 'http://nash-dot-mcp.white-bean-7669.chatgpt.site', 'https://other.chatgpt.site']) {
    assert.equal(hostedPrivateSite(new Request(`${origin}/mcp`, { headers: { 'OAI-Sites-Authorization': 'Bearer local-fixture-only' } })), false);
  }
  Reflect.set(process.env, 'NODE_ENV', 'development');
  assert.equal(hostedPrivateSite(new Request(`${SITE_ORIGIN}/mcp`)), false);
});
