import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteD1 } from './sqlite-d1.ts';
import { createRemoteStateStore } from '../lib/remote-state-store.ts';

test('ordinary writes preserve snapshot headroom for security revocation', async (t) => {
  const db = new SqliteD1(); t.after(() => db.close());
  const store = createRemoteStateStore(db);
  await assert.rejects(store.mutate((state) => { state.padding = 'x'.repeat(990_000); return 'write'; }), /capacity/);
  await store.mutate((state) => { state.padding = 'x'.repeat(990_000); state.revoked = true; return 'revoked'; }, (result) => result === 'revoked');
  assert.equal((await store.read()).revoked, true);
});

test('remote state survives adapter recreation and atomically serializes concurrent mutations', async (t) => {
  const db = new SqliteD1(); t.after(() => db.close());
  const store = createRemoteStateStore(db);
  await Promise.all(Array.from({ length: 20 }, () => store.mutate((state) => {
    state.counter = Number(state.counter ?? 0) + 1; return state.counter;
  })));
  const recreated = createRemoteStateStore(db);
  assert.equal((await recreated.read()).counter, 20);
});

test('a failed transition cannot persist partial state or leak an overlarge record', async (t) => {
  const db = new SqliteD1(); t.after(() => db.close());
  const store = createRemoteStateStore(db);
  await assert.rejects(store.mutate((state) => { state.partial = true; throw new Error('fixture'); }));
  assert.deepEqual(await store.read(), {});
  await assert.rejects(store.mutate((state) => { state.body = 'x'.repeat(1_100_000); }), /capacity/);
  assert.deepEqual(await store.read(), {});
});
