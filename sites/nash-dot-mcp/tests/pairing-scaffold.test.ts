import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handlePairingScaffold } from '../lib/pairing-scaffold.ts';
import { jsonRecord } from './json-record.ts';

function request(body: unknown, origin = 'http://localhost:5173') {
  return new Request('http://localhost:5173/api/scaffold/challenges', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
function deps(ownerUserId: string | null = 'owner-a') {
  let writes = 0;
  return {
    ownerUserId, get writes() { return writes; },
    storage: () => ({
      consumeMcpCall: async () => ({ allowed: true, retryAfterSeconds: 0 }),
      purgeExpired: async () => ({ total: 0 }),
      beginChallenge: async () => { writes++; return { challengeId: 'dch_' + 'a'.repeat(64), deviceRef: 'dev_fixture', expiresAt: 1000 }; },
      approveChallenge: async () => { writes++; return null; },
    }),
  };
}
test('demo challenge creation requires verified owner and same Origin', async () => {
  const anonymous = deps(null);
  assert.equal((await handlePairingScaffold(request({ deviceRef: 'dev_fixture' }), anonymous, 'begin')).status, 401);
  assert.equal(anonymous.writes, 0);
  const owner = deps();
  assert.equal((await handlePairingScaffold(request({ deviceRef: 'dev_fixture' }, 'https://outside.example'), owner, 'begin')).status, 403);
  assert.equal(owner.writes, 0);
});
test('challenge response explicitly identifies a fixture and never issues credentials', async () => {
  const response = await handlePairingScaffold(request({ deviceRef: 'dev_fixture' }), deps(), 'begin');
  const body = jsonRecord(await response.json());
  assert.equal(body.scaffold, true);
  assert.equal(body.paired, false);
  assert.ok(jsonRecord(body.challenge).challengeId);
  assert.doesNotMatch(JSON.stringify(body), /token|sessionToken|pairingSecret|credential/i);
});
test('expired, replayed or wrong-owner approval is a generic unavailable result', async () => {
  const response = await handlePairingScaffold(request({ challengeId: 'dch_' + 'b'.repeat(64) }), deps(), 'approve');
  assert.equal(response.status, 404);
  assert.equal(jsonRecord(await response.json()).code, 'challenge_unavailable');
});
test('unknown body fields and invalid refs are rejected without writes', async () => {
  for (const body of [{ deviceRef: '../local' }, { deviceRef: 'dev_fixture', ownerId: 'owner-b' },
    { deviceRef: 'dev_fixture', approved: true }]) {
    const dependencies = deps();
    assert.equal((await handlePairingScaffold(request(body), dependencies, 'begin')).status, 400);
    assert.equal(dependencies.writes, 0);
  }
});
test('storage failure is generic and request body is bounded', async () => {
  const dependencies = { ...deps(), storage: () => { throw new Error('SECRET fixture'); } };
  const response = await handlePairingScaffold(request({ deviceRef: 'dev_fixture' }), dependencies, 'begin');
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /SECRET/);
  assert.equal((await handlePairingScaffold(request({ deviceRef: 'x'.repeat(3000) }), deps(), 'begin')).status, 413);
});
