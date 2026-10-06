import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { validateEndpointOutput } from '../lib/remote-contracts.ts';

const T0 = Date.parse('2026-10-05T12:00:00.000Z');
const service = { platformAdmitted: true };
const owner = { platformAdmitted: true, ownerId: 'owner-fixture-alice' };

type Reply = { result?: unknown; error?: { code: string } };
type Challenge = { challengeId: string; userCode: string; deviceCode: string; expiresAt: string; pollIntervalSeconds: number };
type Session = { sessionToken: string; deviceId: string; generation: number; expiresAt: string; renewAfter: string };
type Grant = { credential: string; expiresAt: string };

function result<T>(reply: Reply): T {
  assert.equal(reply.error, undefined, 'The local endpoint should succeed');
  assert.notEqual(reply.result, undefined);
  return reply.result as T;
}

async function fixture() {
  const pairingModule = await import('../lib/remote-pairing.ts');
  let now = T0;
  let sequence = 0;
  const options = {
    now: () => now,
    // Deterministic synthetic bytes only; no Site or real App credentials exist.
    randomBytes: () => new Uint8Array(createHash('sha256').update(`fixture-pairing:${++sequence}`).digest()),
  };
  const engine = pairingModule.createRemotePairing(options);
  function challenge() {
    return result<Challenge>(engine.endpoint('pairing.challenge.create', { appVersion: 'fixture-1.0' }, service));
  }
  function issue(account = owner) {
    const created = challenge();
    result(engine.endpoint('pairing.approve', { userCode: created.userCode, decision: 'approve' }, account));
    const issued = result<{ state: 'issued'; session: Session; deviceCredential: Grant }>(engine.endpoint('pairing.session.issue', {
      challengeId: created.challengeId, deviceCode: created.deviceCode,
    }, service));
    assert.equal(issued.state, 'issued');
    return { created, session: issued.session, deviceCredential: issued.deviceCredential };
  }
  return { engine, options, challenge, issue, advance: (milliseconds: number) => { now += milliseconds; },
    restore: () => pairingModule.createRemotePairing(options, engine.exportState()) };
}

test('pairing requires admitted platform service and owner approval takes verified identity only', async () => {
  const { engine, challenge } = await fixture();
  assert.equal(engine.endpoint('pairing.challenge.create', { appVersion: 'fixture-1.0' }, {
    platformAdmitted: false, ownerId: owner.ownerId,
  }).error?.code, 'unauthorized');
  const created = challenge();
  assert.equal(engine.endpoint('pairing.approve', { userCode: created.userCode, decision: 'approve' }, service).error?.code, 'unauthorized');
  assert.equal(engine.endpoint('pairing.approve', { userCode: created.userCode, decision: 'approve' }, {
    ...service, ownerId: 'bad\nidentity',
  }).error?.code, 'unauthorized');
  assert.equal(engine.endpoint('pairing.session.issue', { challengeId: created.challengeId, deviceCode: created.deviceCode }, {
    platformAdmitted: false,
  }).error?.code, 'unauthorized');
  assert.equal(engine.getBinding(owner.ownerId), null);
});

test('generated endpoint validation rejects unknown fields and identity claims without state changes', async () => {
  const { engine } = await fixture();
  const before = JSON.stringify(engine.exportState());
  assert.equal(engine.endpoint('pairing.challenge.create', { appVersion: 'fixture-1.0', ownerId: 'spoofed' }, service).error?.code, 'payload_invalid');
  assert.equal(engine.endpoint('pairing.session.renew', { generation: 0 }, service).error?.code, 'payload_invalid');
  assert.equal(engine.endpoint('pairing.unknown', {}, service).error?.code, 'payload_invalid');
  assert.equal(JSON.stringify(engine.exportState()), before);
});

test('challenge has bounded safe codes and persists only hashed approval and device codes', async () => {
  const { engine, challenge } = await fixture();
  const created = challenge();
  assert.match(created.challengeId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(created.deviceCode, /^[A-Za-z0-9_-]{43}$/);
  assert.match(created.userCode, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  assert.equal(created.expiresAt, '2026-10-05T12:10:00.000Z');
  assert.equal(created.pollIntervalSeconds, 5);
  const persisted = JSON.stringify(engine.exportState());
  assert.equal(persisted.includes(created.deviceCode), false);
  assert.equal(persisted.includes(created.userCode), false);
});

test('unapproved device polls pending and possession of a challenge id alone cannot issue a session', async () => {
  const { engine, challenge } = await fixture();
  const created = challenge();
  const request = { challengeId: created.challengeId, deviceCode: created.deviceCode };
  assert.deepEqual(result(engine.endpoint('pairing.session.issue', request, service)), { state: 'pending', pollIntervalSeconds: 5 });
  assert.equal(engine.endpoint('pairing.session.issue', { ...request, deviceCode: 'x'.repeat(43) }, service).error?.code, 'challenge_not_found');
  assert.equal(engine.getBinding(owner.ownerId), null);
});

test('owner approval binds one device and one generated session; approval and issue cannot be replayed', async () => {
  const { engine, issue } = await fixture();
  const { created, session } = issue();
  assert.match(session.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(session.deviceId, /^dev_[a-f0-9]{24}$/);
  assert.equal(session.generation, 1);
  assert.equal(session.expiresAt, '2026-10-05T12:15:00.000Z');
  assert.equal(session.renewAfter, '2026-10-05T12:10:00.000Z');
  assert.deepEqual(engine.authenticate(session.sessionToken), { ownerId: owner.ownerId, deviceId: session.deviceId, generation: 1 });
  assert.deepEqual(engine.getBinding(owner.ownerId), {
    ownerId: owner.ownerId, deviceId: session.deviceId, generation: 1,
    dotIdentity: { source: 'sites_mcp_identity', subject: owner.ownerId },
    createdAt: '2026-10-05T12:00:00.000Z', revokedAt: null,
    lifetimeEndsAt: '2026-11-04T12:00:00.000Z',
  });
  assert.equal(engine.getBinding('owner-fixture-bob'), null);
  assert.equal(engine.endpoint('pairing.approve', { userCode: created.userCode, decision: 'approve' }, owner).error?.code, 'challenge_used');
  assert.equal(engine.endpoint('pairing.session.issue', { challengeId: created.challengeId, deviceCode: created.deviceCode }, service).error?.code, 'challenge_used');
  assert.equal(JSON.stringify(engine.exportState()).includes(session.sessionToken), false);
});

test('first owner decision is final and another owner cannot steal an approved challenge', async () => {
  const { engine, challenge } = await fixture();
  const created = challenge();
  result(engine.endpoint('pairing.approve', { userCode: created.userCode, decision: 'approve' }, owner));
  assert.equal(engine.endpoint('pairing.approve', { userCode: created.userCode, decision: 'approve' }, {
    ...owner, ownerId: 'owner-fixture-bob',
  }).error?.code, 'challenge_used');
  const session = result<{ session: Session }>(engine.endpoint('pairing.session.issue', {
    challengeId: created.challengeId, deviceCode: created.deviceCode,
  }, service)).session;
  assert.equal(engine.getBinding(owner.ownerId)?.deviceId, session.deviceId);
  assert.equal(engine.getBinding('owner-fixture-bob'), null);
});

test('owner denial prevents session issuance and later approval', async () => {
  const { engine, challenge } = await fixture();
  const created = challenge();
  assert.deepEqual(result(engine.endpoint('pairing.approve', { userCode: created.userCode, decision: 'deny' }, owner)), { outcome: 'denied' });
  assert.equal(engine.endpoint('pairing.session.issue', { challengeId: created.challengeId, deviceCode: created.deviceCode }, service).error?.code, 'challenge_denied');
  assert.equal(engine.endpoint('pairing.approve', { userCode: created.userCode, decision: 'approve' }, owner).error?.code, 'challenge_used');
  assert.equal(engine.getBinding(owner.ownerId), null);
});

test('challenge expires at ten minutes even when no purge job has run', async () => {
  const { engine, challenge, advance } = await fixture();
  const created = challenge();
  advance(599_999);
  assert.equal(engine.endpoint('pairing.session.issue', { challengeId: created.challengeId, deviceCode: created.deviceCode }, service).error, undefined);
  advance(1);
  assert.equal(engine.endpoint('pairing.session.issue', { challengeId: created.challengeId, deviceCode: created.deviceCode }, service).error?.code, 'challenge_expired');
  assert.equal(engine.endpoint('pairing.approve', { userCode: created.userCode, decision: 'approve' }, owner).error?.code, 'challenge_expired');
});

test('renewal rotates a valid session after ten minutes and enforces its generation', async () => {
  const { engine, issue, advance } = await fixture();
  const { session } = issue();
  assert.equal(engine.endpoint('pairing.session.renew', { generation: 1 }, service).error?.code, 'unauthorized');
  assert.equal(engine.endpoint('pairing.session.renew', { generation: 2 }, { ...service, sessionToken: session.sessionToken }).error?.code, 'generation_revoked');
  advance(600_000);
  const renewed = result<{ session: Session }>(engine.endpoint('pairing.session.renew', { generation: 1 }, {
    ...service, sessionToken: session.sessionToken,
  })).session;
  assert.notEqual(renewed.sessionToken, session.sessionToken);
  assert.equal(renewed.expiresAt, '2026-10-05T12:25:00.000Z');
  assert.equal(renewed.renewAfter, '2026-10-05T12:20:00.000Z');
  assert.equal(renewed.deviceId, session.deviceId);
  assert.equal(renewed.generation, 1);
  const retired = engine.authenticate(session.sessionToken);
  assert.equal('code' in retired ? retired.code : null, 'session_expired');
  assert.deepEqual(engine.authenticate(renewed.sessionToken), { ownerId: owner.ownerId, deviceId: session.deviceId, generation: 1 });
});

test('expired sessions cannot authenticate or renew at fifteen minutes', async () => {
  const { engine, issue, advance } = await fixture();
  const { session } = issue();
  advance(899_999);
  assert.equal('code' in engine.authenticate(session.sessionToken), false);
  advance(1);
  const auth = engine.authenticate(session.sessionToken);
  assert.equal('code' in auth ? auth.code : null, 'session_expired');
  assert.equal(engine.endpoint('pairing.session.renew', { generation: 1 }, { ...service, sessionToken: session.sessionToken }).error?.code, 'session_expired');
});

test('revocation fences every old session across restart and re-pairing', async () => {
  const f = await fixture();
  const { session } = f.issue();
  assert.equal(f.engine.endpoint('pairing.revoke', { generation: 1 }, { ...owner, sessionToken: 'z'.repeat(43) }).error?.code, 'unauthorized');
  assert.deepEqual(result(f.engine.endpoint('pairing.revoke', { generation: 1 }, { ...service, sessionToken: session.sessionToken })), { revokedGeneration: 1 });
  assert.equal(f.engine.getBinding(owner.ownerId)?.generation, 2);
  assert.equal(f.engine.getBinding(owner.ownerId)?.revokedAt, '2026-10-05T12:00:00.000Z');
  f.advance(900_000);
  const restored = f.restore();
  const revoked = restored.authenticate(session.sessionToken);
  assert.equal('code' in revoked ? revoked.code : null, 'generation_revoked');
  assert.equal(restored.endpoint('pairing.session.renew', { generation: 1 }, { ...service, sessionToken: session.sessionToken }).error?.code, 'generation_revoked');
  const repaired = f.issue().session;
  assert.equal(repaired.generation, 2);
  const old = f.engine.authenticate(session.sessionToken);
  assert.equal('code' in old ? old.code : null, 'generation_revoked');
});

test('replacing an active owner device fences the old device while other owners remain isolated', async () => {
  const { engine, issue } = await fixture();
  const alice = issue().session;
  const bob = issue({ ...owner, ownerId: 'owner-fixture-bob' }).session;
  const replacement = issue().session;
  assert.equal(replacement.generation, 2);
  assert.notEqual(replacement.deviceId, alice.deviceId);
  const retired = engine.authenticate(alice.sessionToken);
  assert.equal('code' in retired ? retired.code : null, 'generation_revoked');
  assert.deepEqual(engine.authenticate(bob.sessionToken), { ownerId: 'owner-fixture-bob', deviceId: bob.deviceId, generation: 1 });
});

test('state snapshots restore authentication but callers cannot mutate internal bindings or snapshots', async () => {
  const { engine, issue, restore } = await fixture();
  const { session } = issue();
  const binding = engine.getBinding(owner.ownerId);
  assert.ok(binding);
  binding.ownerId = 'spoofed';
  assert.equal(engine.getBinding(owner.ownerId)?.ownerId, owner.ownerId);
  const restored = restore();
  assert.deepEqual(restored.authenticate(session.sessionToken), { ownerId: owner.ownerId, deviceId: session.deviceId, generation: 1 });
  const snapshot = engine.exportState();
  assert.equal(JSON.stringify(snapshot).includes(session.sessionToken), false);
  const unknown = engine.authenticate('not-a-token');
  assert.equal('code' in unknown ? unknown.code : null, 'unauthorized');
});

test('revocation consumes owner-approved challenges that have not issued a session', async () => {
  const { engine, issue, challenge } = await fixture();
  const { session } = issue();
  const waiting = challenge();
  result(engine.endpoint('pairing.approve', { userCode: waiting.userCode, decision: 'approve' }, owner));
  result(engine.endpoint('pairing.revoke', { generation: 1 }, { ...service, sessionToken: session.sessionToken }));
  assert.equal(engine.endpoint('pairing.session.issue', {
    challengeId: waiting.challengeId, deviceCode: waiting.deviceCode,
  }, service).error?.code, 'challenge_used');
  assert.notEqual(engine.getBinding(owner.ownerId)?.revokedAt, null);
});

test('all successful endpoint outputs conform to the generated remote schemas', async () => {
  const { engine, advance } = await fixture();
  const challenge = result<Challenge>(engine.endpoint('pairing.challenge.create', { appVersion: 'fixture-1.0' }, service));
  assert.equal(validateEndpointOutput('pairing.challenge.create', challenge), true);
  const request = { challengeId: challenge.challengeId, deviceCode: challenge.deviceCode };
  assert.equal(validateEndpointOutput('pairing.session.issue', result(engine.endpoint('pairing.session.issue', request, service))), true);
  assert.equal(validateEndpointOutput('pairing.approve', result(engine.endpoint('pairing.approve', {
    userCode: challenge.userCode, decision: 'approve',
  }, owner))), true);
  const issued = result<{ session: Session }>(engine.endpoint('pairing.session.issue', request, service));
  assert.equal(validateEndpointOutput('pairing.session.issue', issued), true);
  advance(600_000);
  const renewed = result<{ session: Session }>(engine.endpoint('pairing.session.renew', { generation: 1 }, {
    ...service, sessionToken: issued.session.sessionToken,
  }));
  assert.equal(validateEndpointOutput('pairing.session.renew', renewed), true);
  assert.equal(validateEndpointOutput('pairing.revoke', result(engine.endpoint('pairing.revoke', { generation: 1 }, {
    ...service, sessionToken: renewed.session.sessionToken,
  }))), true);
});

test('issue stores a salted credential hash and refresh rotates it without extending the binding', async () => {
  const f = await fixture();
  const issued = f.issue();
  assert.match(issued.deviceCredential.credential, /^ndc_[a-f0-9]{24}\.[A-Za-z0-9_-]{43,86}$/);
  const persisted = f.engine.exportState();
  const [credentialId, secret] = issued.deviceCredential.credential.split('.');
  const record = persisted.deviceCredentials.find((entry) => entry.credentialId === credentialId)!;
  assert.ok(record);
  assert.equal(record.secretHash, createHash('sha256').update(`${record.salt}.${secret}`).digest('hex'));
  assert.equal(record.dotIdentity.subject, owner.ownerId);
  assert.equal(JSON.stringify(persisted).includes(secret), false);
  f.advance(1_000_000);
  const refreshed = result<{ session: Session; deviceCredential: Grant }>(f.restore().endpoint('pairing.session.refresh', {
    generation: 1,
  }, { ...service, deviceCredential: issued.deviceCredential.credential }));
  assert.notEqual(refreshed.deviceCredential.credential, issued.deviceCredential.credential);
  assert.equal(refreshed.deviceCredential.expiresAt, issued.deviceCredential.expiresAt);
  assert.equal(refreshed.session.deviceId, issued.session.deviceId);
  assert.equal(validateEndpointOutput('pairing.session.refresh', refreshed), true);
});

test('invalid credential secrets never mutate or revoke a pairing, including superseded credentials', async () => {
  const f = await fixture();
  const issued = f.issue();
  const invalid = `${issued.deviceCredential.credential.split('.')[0]}.${'z'.repeat(43)}`;
  const before = f.engine.exportState();
  for (const credential of [invalid, 'invalid', `ndc_${'f'.repeat(24)}.${'z'.repeat(43)}`]) {
    assert.equal(f.engine.endpoint('pairing.session.refresh', { generation: 1 }, {
      ...service, deviceCredential: credential,
    }).error?.code, 'device_credential_invalid');
    assert.deepEqual(f.engine.exportState(), before);
  }
  result(f.engine.endpoint('pairing.session.refresh', { generation: 1 }, {
    ...service, deviceCredential: issued.deviceCredential.credential,
  }));
  const rotated = f.engine.exportState();
  assert.equal(f.engine.endpoint('pairing.session.refresh', { generation: 1 }, {
    ...service, deviceCredential: invalid,
  }).error?.code, 'device_credential_invalid');
  assert.deepEqual(f.engine.exportState(), rotated);
});

test('verified credential reuse revokes all sessions and the newest credential across restart', async () => {
  const f = await fixture();
  const issued = f.issue();
  const refreshed = result<{ session: Session; deviceCredential: Grant }>(f.engine.endpoint('pairing.session.refresh', {
    generation: 1,
  }, { ...service, deviceCredential: issued.deviceCredential.credential }));
  const restored = f.restore();
  assert.equal(restored.endpoint('pairing.session.refresh', { generation: 1 }, {
    ...service, deviceCredential: issued.deviceCredential.credential,
  }).error?.code, 'device_credential_reused');
  assert.equal(restored.getBinding(owner.ownerId)?.generation, 2);
  assert.equal(restored.endpoint('pairing.session.refresh', { generation: 1 }, {
    ...service, deviceCredential: refreshed.deviceCredential.credential,
  }).error?.code, 'generation_revoked');
  const identity = restored.authenticate(refreshed.session.sessionToken);
  assert.equal('code' in identity ? identity.code : null, 'generation_revoked');
});

test('refresh body generation mismatch precedes reuse detection without mutation', async () => {
  const f = await fixture();
  const issued = f.issue();
  result(f.engine.endpoint('pairing.session.refresh', { generation: 1 }, {
    ...service, deviceCredential: issued.deviceCredential.credential,
  }));
  const before = f.engine.exportState();
  assert.equal(f.engine.endpoint('pairing.session.refresh', { generation: 2 }, {
    ...service, deviceCredential: issued.deviceCredential.credential,
  }).error?.code, 'generation_revoked');
  assert.deepEqual(f.engine.exportState(), before);
});

test('session expiry and renewAfter are capped at the absolute lifetime, which renew cannot extend', async () => {
  const f = await fixture();
  const issued = f.issue();
  f.advance(30 * 86_400_000 - 300_000);
  const refreshed = result<{ session: Session; deviceCredential: Grant }>(f.engine.endpoint('pairing.session.refresh', {
    generation: 1,
  }, { ...service, deviceCredential: issued.deviceCredential.credential }));
  assert.equal(refreshed.session.expiresAt, issued.deviceCredential.expiresAt);
  assert.equal(refreshed.session.renewAfter, issued.deviceCredential.expiresAt);
  f.advance(300_000);
  assert.equal(f.engine.endpoint('pairing.session.refresh', { generation: 1 }, {
    ...service, deviceCredential: refreshed.deviceCredential.credential,
  }).error?.code, 'pairing_expired');
  assert.equal(f.engine.endpoint('pairing.session.renew', { generation: 1 }, {
    ...service, sessionToken: refreshed.session.sessionToken,
  }).error?.code, 'pairing_expired');
});

test('owner revocation uses verified owner identity and does not need a live app session', async () => {
  const f = await fixture();
  const issued = f.issue();
  assert.equal(f.engine.endpoint('pairing.owner.revoke', { generation: 1 }, service).error?.code, 'unauthorized');
  assert.equal(f.engine.endpoint('pairing.owner.revoke', { generation: 1 }, {
    platformAdmitted: false, ownerId: 'another-owner',
  }).error?.code, 'unauthorized');
  assert.deepEqual(result(f.engine.endpoint('pairing.owner.revoke', { generation: 1 }, {
    platformAdmitted: false, ownerId: owner.ownerId,
  })), { revokedGeneration: 1 });
  assert.equal(f.engine.endpoint('pairing.session.refresh', { generation: 1 }, {
    ...service, deviceCredential: issued.deviceCredential.credential,
  }).error?.code, 'generation_revoked');
});

test('expired challenge and session metadata is purged in bounded batches after seven retained days', async () => {
  const f = await fixture();
  const issued = f.issue();
  f.engine.endpoint('pairing.owner.revoke', { generation: 1 }, owner);
  f.advance(7 * 86_400_000 + 900_000 - 1);
  const recent = f.restore();
  const revoked = recent.authenticate(issued.session.sessionToken);
  assert.equal('code' in revoked ? revoked.code : null, 'generation_revoked');
  assert.equal(recent.exportState().sessions.length, 1);
  f.advance(1);
  const stale = f.restore();
  assert.equal(stale.exportState().sessions.length, 0);
  assert.equal(stale.exportState().challenges.length, 0);
  const missing = stale.authenticate(issued.session.sessionToken);
  assert.equal('code' in missing ? missing.code : null, 'unauthorized');

  const pairingModule = await import('../lib/remote-pairing.ts');
  const state = f.engine.exportState();
  const oldExpiration = T0 - 8 * 86_400_000;
  const sample = f.issue();
  const freshState = f.engine.exportState();
  for (let n = 0; n < 250; n++) {
    state.challenges.push({ ...freshState.challenges[0], challengeId: `old-${n}`, expiresAt: oldExpiration });
    state.sessions.push({ ...freshState.sessions[0], tokenHash: createHash('sha256').update(`old-${n}`).digest('hex'),
      expiresAt: oldExpiration });
  }
  assert.ok(sample.session);
  const cleanup = pairingModule.createRemotePairing(f.options, state);
  assert.equal(cleanup.exportState().challenges.length, 150);
  assert.equal(cleanup.exportState().sessions.length, 50);
  const last = cleanup.exportState();
  assert.equal(last.challenges.length, 0);
  assert.equal(last.sessions.length, 0);
});

test('credential replay tombstones remain through the pairing lifetime and expire only seven days later', async () => {
  const f = await fixture();
  const issued = f.issue();
  result(f.engine.endpoint('pairing.session.refresh', { generation: 1 }, {
    ...service, deviceCredential: issued.deviceCredential.credential,
  }));
  f.advance(29 * 86_400_000);
  const live = f.restore();
  assert.equal(live.exportState().deviceCredentials.length, 2);
  assert.equal(live.endpoint('pairing.session.refresh', { generation: 1 }, {
    ...service, deviceCredential: issued.deviceCredential.credential,
  }).error?.code, 'device_credential_reused');
  f.advance(8 * 86_400_000);
  assert.equal(f.restore().exportState().deviceCredentials.length, 0);
});

test('pairing allocation stops before the snapshot limit while owner revocation still succeeds', async () => {
  const f = await fixture();
  const issued = f.issue();
  const pairingModule = await import('../lib/remote-pairing.ts');
  const state = f.engine.exportState();
  const sample = state.sessions[0];
  for (let n = 0; n < 2000; n++) state.sessions.push({ ...sample,
    tokenHash: createHash('sha256').update(`active-${n}`).digest('hex') });
  const full = pairingModule.createRemotePairing(f.options, state);
  const before = full.exportState();
  assert.equal(full.endpoint('pairing.challenge.create', { appVersion: 'fixture-1.0' }, service).error?.code, 'rate_limited');
  assert.equal(full.endpoint('pairing.session.refresh', { generation: 1 }, {
    ...service, deviceCredential: issued.deviceCredential.credential,
  }).error?.code, 'rate_limited');
  assert.equal(full.endpoint('pairing.session.renew', { generation: 1 }, {
    ...service, sessionToken: issued.session.sessionToken,
  }).error?.code, 'rate_limited');
  assert.deepEqual(full.exportState(), before);
  assert.deepEqual(result(full.endpoint('pairing.owner.revoke', { generation: 1 }, owner)), { revokedGeneration: 1 });
  assert.equal(full.getBinding(owner.ownerId)?.generation, 2);
});
