import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRemoteMailbox, canonicalPayload, payloadSha256 } from '../lib/remote-mailbox.ts';
import { createRemoteWorkflow } from '../lib/remote-workflow.ts';
import { vectors, validateEndpointOutput, validateToolOutput } from '../lib/remote-contracts.ts';
import { SqliteD1 } from './sqlite-d1.ts';

type Step = {
  actor: string; at: string; caller: { ownerId?: string; deviceId?: string; generation?: number;
    serviceOnly?: boolean; deviceCredential?: string };
  tool?: string; arguments?: Record<string, unknown>; endpoint?: string;
  itemId?: string; body?: Record<string, unknown>; expect: unknown;
};
type Vector = {
  id: string; binding: Parameters<typeof createRemoteMailbox>[0];
  generated: { itemIds: string[]; leaseNonces: string[]; pairing?: {
    challengeIds: string[]; userCodes: string[]; deviceCodes: string[]; deviceIds: string[];
    sessionTokens: string[]; deviceCredentials: string[];
  } }; steps: Step[];
};
const bundle = vectors as unknown as {
  vectors: Vector[];
  payloadHashExamples: { payload: Record<string, unknown>; canonicalJson: string; sha256: string }[];
};

test('canonical payload hashing matches every R2 hash golden', () => {
  for (const example of bundle.payloadHashExamples) {
    assert.equal(canonicalPayload(example.payload), example.canonicalJson);
    assert.equal(payloadSha256(example.payload), example.sha256);
  }
});

assert.equal(bundle.vectors.length, 37, 'the hosted implementation must replay all R2 vectors');
for (const vector of bundle.vectors) {
  if (vector.generated.pairing) {
    test(`R2 conformance: ${vector.id}`, async (t) => {
      const db = new SqliteD1();
      t.after(() => db.close());
      let currentTime = 0;
      const generated = structuredClone(vector.generated.pairing!);
      function next(values: string[]) {
        return () => { assert.ok(values.length, 'the engine uses only reserved fixture entropy'); return values.shift()!; };
      }
      const options = {
        now: () => currentTime,
        pairingGenerate: {
          challengeId: next(generated.challengeIds), userCode: next(generated.userCodes),
          deviceCode: next(generated.deviceCodes), deviceId: next(generated.deviceIds),
          sessionToken: next(generated.sessionTokens), deviceCredential: next(generated.deviceCredentials),
        },
      };
      for (const [index, step] of vector.steps.entries()) {
        currentTime = Date.parse(step.at);
        // A fresh workflow reads its pairing and mailbox together from the committed SQLite row.
        const workflow = createRemoteWorkflow(db, options);
        const actual = step.actor === 'dot'
          ? await workflow.tool(step.caller.ownerId!, step.tool!, structuredClone(step.arguments!))
          : await workflow.endpoint(step.endpoint!, structuredClone(step.body!), {
            platformAdmitted: step.actor !== 'owner', ownerId: step.caller.ownerId,
            deviceCredential: step.caller.deviceCredential,
          }, step.itemId);
        if ('result' in actual) assert.equal(step.actor === 'dot'
          ? validateToolOutput(step.tool!, actual.result)
          : validateEndpointOutput(step.endpoint!, actual.result), true,
        `${vector.id}, step ${index}: the result matches the generated output schema`);
        assert.deepEqual(actual, step.expect, `${vector.id}, step ${index}: ${step.tool ?? step.endpoint}`);
      }
      for (const values of Object.values(generated)) assert.equal(values.length, 0,
        'the pairing engine generated exactly the golden values');
    });
    continue;
  }
  test(`R2 conformance: ${vector.id}`, () => {
    let currentTime = 0;
    const itemIds = [...vector.generated.itemIds];
    const nonces = [...vector.generated.leaseNonces];
    let mailbox = createRemoteMailbox(vector.binding, {
      now: () => currentTime,
      itemId: () => { assert.ok(itemIds.length); return itemIds.shift()!; },
      leaseNonce: () => { assert.ok(nonces.length); return nonces.shift()!; },
    });
    for (const [index, step] of vector.steps.entries()) {
      currentTime = Date.parse(step.at);
      const actual = step.actor === 'dot'
        ? mailbox.tool(step.caller.ownerId!, step.tool!, structuredClone(step.arguments!))
        : mailbox.endpoint(
          { deviceId: step.caller.deviceId!, generation: step.caller.generation! },
          step.endpoint!, structuredClone(step.body!), step.itemId,
        );
      if ('result' in actual) assert.equal(step.actor === 'dot'
        ? validateToolOutput(step.tool!, actual.result)
        : validateEndpointOutput(step.endpoint!, actual.result), true,
      `${vector.id}, step ${index}: the result matches the generated output schema`);
      assert.deepEqual(actual, step.expect, `${vector.id}, step ${index}: ${step.tool ?? step.endpoint}`);
      // Every operation is independently persisted and restored, like a Worker invocation.
      mailbox = createRemoteMailbox(vector.binding, {
        now: () => currentTime,
        itemId: () => { assert.ok(itemIds.length); return itemIds.shift()!; },
        leaseNonce: () => { assert.ok(nonces.length); return nonces.shift()!; },
      }, JSON.parse(JSON.stringify(mailbox.exportState())));
    }
    assert.equal(itemIds.length, 0, 'the engine generated exactly the golden item ids');
    // Some vectors reserve a nonce for a branch they do not reach.
  });
}
