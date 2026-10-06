import assert from "node:assert/strict";
import { test } from "node:test";
import { createScaffoldStorage } from "../lib/scaffold-storage.ts";
import { SqliteD1 } from "./sqlite-d1.ts";

const alice = { userId: "local-fixture-alice" };
const bob = { userId: "local-fixture-bob" };

function fixture() {
  const db = new SqliteD1();
  let now = 1_800_000_000_000;
  return {
    db,
    storage: createScaffoldStorage(db, { now: () => now }),
    advance: (milliseconds: number) => { now += milliseconds; },
  };
}

test("workspaces default to none and remain opaque, owner-scoped fixture records", async (t) => {
  const { db, storage } = fixture();
  t.after(() => db.close());
  assert.deepEqual(await storage.listWorkspaces(alice), []);
  const created = await storage.createWorkspace(alice, "Example fixture");
  // Contract v2 workspace references contain exactly 12 random bytes (24 hex).
  assert.match(created.workspaceRef, /^dws_[a-f0-9]{24}$/);
  assert.equal(created.label, "Example fixture");
  assert.deepEqual(await storage.listWorkspaces(alice), [created]);
  assert.deepEqual(await storage.listWorkspaces(bob), []);
  assert.equal("path" in created, false);
});

test("owner and labels are validated before storage", async (t) => {
  const { db, storage } = fixture();
  t.after(() => db.close());
  await assert.rejects(storage.listWorkspaces({ userId: "" }), /authenticated owner/);
  for (const label of ["", " ", "a".repeat(81), "bad\nlabel", "C:\\private\\workspace", "/private/workspace"]) {
    await assert.rejects(storage.createWorkspace(alice, label), /label/);
  }
});

test("challenge uses 32 random bytes, stores only a hash, and associates the authenticated owner", async (t) => {
  const { db, storage } = fixture();
  t.after(() => db.close());
  const challenge = await storage.beginChallenge(alice, "dev_fixture_one");
  const another = await storage.beginChallenge(alice, "dev_fixture_one");
  assert.match(challenge.challengeId, /^dch_[a-f0-9]{64}$/);
  assert.notEqual(challenge.challengeId, another.challengeId);
  assert.equal(challenge.expiresAt, 1_800_000_300_000);
  const rows = db.database.prepare("SELECT * FROM scaffold_challenges").all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].owner_id, alice.userId);
  assert.match(String(rows[0].challenge_hash), /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(rows).includes(challenge.challengeId), false);
  assert.deepEqual(await storage.getChallenge(alice, challenge.challengeId), challenge);
  assert.equal(await storage.getChallenge(bob, challenge.challengeId), null);
});

test("approval requires both owner and challenge, consumes once, and issues no session", async (t) => {
  const { db, storage } = fixture();
  t.after(() => db.close());
  const challenge = await storage.beginChallenge(alice, "dev_fixture_one");
  assert.equal(await storage.approveChallenge(bob, challenge.challengeId), null);
  const approved = await storage.approveChallenge(alice, challenge.challengeId);
  assert.deepEqual(approved, { ...challenge, state: "approved" });
  assert.equal(await storage.approveChallenge(alice, challenge.challengeId), null);
  assert.equal(await storage.getChallenge(alice, challenge.challengeId), null);
  assert.equal("session" in approved!, false);
  assert.equal("token" in approved!, false);
});

test("concurrent approval of one challenge succeeds exactly once", async (t) => {
  const { db, storage } = fixture();
  t.after(() => db.close());
  const challenge = await storage.beginChallenge(alice, "dev_fixture_one");
  const approvals = await Promise.all(Array.from({ length: 20 }, () => storage.approveChallenge(alice, challenge.challengeId)));
  assert.equal(approvals.filter((approval) => approval !== null).length, 1);
});

test("expiry is enforced at the five-minute boundary before cleanup", async (t) => {
  const { db, storage, advance } = fixture();
  t.after(() => db.close());
  const challenge = await storage.beginChallenge(alice, "dev_fixture_one");
  advance(299_999);
  assert.notEqual(await storage.getChallenge(alice, challenge.challengeId), null);
  advance(1);
  assert.equal(await storage.getChallenge(alice, challenge.challengeId), null);
  assert.equal(await storage.approveChallenge(alice, challenge.challengeId), null);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM scaffold_challenges").get()?.count, 1);
});

test("challenge and device references reject unsafe or malformed input", async (t) => {
  const { db, storage } = fixture();
  t.after(() => db.close());
  for (const deviceRef of ["", "dev_", "../../device", "dev_bad/name", "dev_bad\nname", "dev_" + "a".repeat(65)]) {
    await assert.rejects(storage.beginChallenge(alice, deviceRef), /deviceRef/);
  }
  for (const challengeId of ["", "dch_short", "dch_" + "a".repeat(65), "../../challenge"]) {
    assert.equal(await storage.getChallenge(alice, challengeId), null);
    assert.equal(await storage.approveChallenge(alice, challengeId), null);
  }
});

test("atomic persistent limiter permits 30 calls per owner per minute", async (t) => {
  const { db, storage } = fixture();
  t.after(() => db.close());
  const calls = await Promise.all(Array.from({ length: 45 }, () => storage.consumeMcpCall(alice)));
  assert.equal(calls.filter((call) => call.allowed).length, 30);
  assert.equal(calls.filter((call) => !call.allowed).length, 15);
  assert.equal(calls[29].remaining, 0);
  assert.equal(calls[30].retryAfterSeconds, 60);
  const recreated = createScaffoldStorage(db, { now: () => 1_800_000_000_000 });
  assert.equal((await recreated.consumeMcpCall(alice)).allowed, false);
  assert.equal((await recreated.consumeMcpCall(bob)).allowed, true);
});

test("rate windows expire logically and atomically reset at the minute boundary", async (t) => {
  const { db, storage, advance } = fixture();
  t.after(() => db.close());
  for (let i = 0; i < 30; i += 1) await storage.consumeMcpCall(alice);
  advance(59_001);
  assert.deepEqual(await storage.consumeMcpCall(alice), {
    allowed: false, remaining: 0, retryAfterSeconds: 1, resetAt: 1_800_000_060_000,
  });
  advance(999);
  assert.deepEqual(await storage.consumeMcpCall(alice), {
    allowed: true, remaining: 29, retryAfterSeconds: 0, resetAt: 1_800_000_120_000,
  });
});

test("purge bounds total deleted rows and preserves live owner records", async (t) => {
  const { db, storage, advance } = fixture();
  t.after(() => db.close());
  for (let i = 0; i < 6; i += 1) await storage.beginChallenge(alice, `dev_fixture_${i}`);
  await storage.consumeMcpCall(alice);
  await storage.consumeMcpCall(bob);
  const workspace = await storage.createWorkspace(alice, "Live fixture");
  advance(300_000);
  const live = await storage.beginChallenge(bob, "dev_live_fixture");
  assert.deepEqual(await storage.purgeExpired(3), { challenges: 3, rateWindows: 0, total: 3 });
  assert.deepEqual(await storage.purgeExpired(3), { challenges: 3, rateWindows: 0, total: 3 });
  assert.deepEqual(await storage.purgeExpired(3), { challenges: 0, rateWindows: 2, total: 2 });
  assert.deepEqual(await storage.purgeExpired(3), { challenges: 0, rateWindows: 0, total: 0 });
  assert.deepEqual(await storage.getChallenge(bob, live.challengeId), live);
  assert.deepEqual(await storage.listWorkspaces(alice), [workspace]);
  for (const limit of [0, -1, 0.5, 1_001]) {
    await assert.rejects(storage.purgeExpired(limit), /limit/);
  }
});

test("an older captured request time cannot roll back a newer rate window", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.close());
  const current = createScaffoldStorage(db, { now: () => 60_000 });
  const delayed = createScaffoldStorage(db, { now: () => 0 });
  assert.equal((await current.consumeMcpCall(alice)).allowed, true);
  // Simulates the previous minute's captured timestamp reaching SQL after the new window.
  const delayedAllowance = await delayed.consumeMcpCall(alice);
  assert.equal(delayedAllowance.allowed, true);
  assert.equal(delayedAllowance.resetAt, 120_000);
  const row = db.database.prepare("SELECT window_start, expires_at, calls FROM scaffold_rate_windows").get();
  assert.equal(row?.window_start, 60_000);
  assert.equal(row?.expires_at, 120_000);
  assert.equal(row?.calls, 2);
  const remaining = await Promise.all(Array.from({ length: 40 }, () => current.consumeMcpCall(alice)));
  assert.equal(remaining.filter((call) => call.allowed).length, 28);
});
