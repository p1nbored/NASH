import type { ScaffoldDatabase } from './scaffold-storage.ts';
import { createRemotePairing, type PairingContext, type PairingBinding } from './remote-pairing.ts';
import { createRemoteMailbox, type RemoteMailboxState } from './remote-mailbox.ts';
import { createRemoteStateStore } from './remote-state-store.ts';
import { manifest, remoteError, validateToolOutput, validateToolError, validateEndpointOutput, validateEndpointError, type RemoteResponse } from './remote-contracts.ts';

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isMailbox(value: unknown): value is RemoteMailboxState {
  return isRecord(value) && value.version === 1 && typeof value.ownerId === 'string' && typeof value.deviceId === 'string'
    && typeof value.generation === 'number' && typeof value.paired === 'boolean' && Array.isArray(value.items)
    && isRecord(value.requests) && isRecord(value.eventIds) && Array.isArray(value.workspaces) && Array.isArray(value.toolCalls);
}

export function createRemoteWorkflow(db: ScaffoldDatabase, options: {
  now?: () => number; pairingGenerate?: Parameters<typeof createRemotePairing>[0]['generate'];
} = {}) {
  const now = options.now ?? Date.now;
  const store = createRemoteStateStore(db);
  const clock = { now, itemId: () => crypto.randomUUID(), leaseNonce: () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  } };

  function prepare(state: Record<string, unknown>) {
    const pairing = createRemotePairing({ now, generate: options.pairingGenerate }, state.pairing);
    const boxes: RemoteMailboxState[] = [];
    if (state.mailboxes !== undefined) {
      if (!Array.isArray(state.mailboxes) || !state.mailboxes.every(isMailbox)) throw new Error('Invalid local mailbox state');
      boxes.push(...state.mailboxes);
    }
    function synchronize() {
      for (let index = 0; index < boxes.length; index++) {
        const box = boxes[index];
        const binding = pairing.getBinding(box.ownerId);
        if (box.paired && (!binding || binding.revokedAt || Date.parse(binding.lifetimeEndsAt) <= now()
          || binding.deviceId !== box.deviceId || binding.generation !== box.generation)) {
          const engine = createRemoteMailbox(box, clock, box);
          engine.revoke();
          const revoked = engine.exportState();
          revoked.generation = Math.max(revoked.generation, binding?.generation ?? revoked.generation);
          boxes[index] = revoked;
        }
      }
      state.pairing = pairing.exportState();
      state.mailboxes = boxes;
    }
    function mailbox(binding: PairingBinding) {
      let index = boxes.findIndex((box) => box.ownerId === binding.ownerId && box.deviceId === binding.deviceId);
      if (index < 0) {
        const fresh = createRemoteMailbox(binding, clock).exportState();
        fresh.paired = binding.revokedAt === null && Date.parse(binding.lifetimeEndsAt) > now();
        boxes.push(fresh); index = boxes.length - 1;
      }
      const engine = createRemoteMailbox(binding, clock, boxes[index]);
      return { engine, save: () => { boxes[index] = engine.exportState(); synchronize(); } };
    }
    synchronize();
    return { pairing, boxes, synchronize, mailbox };
  }

  function checkedTool(name: string, reply: RemoteResponse): RemoteResponse {
    if (reply.error ? !validateToolError(reply.error) : !validateToolOutput(name, reply.result)) throw new Error('Invalid local tool projection');
    return reply;
  }
  function checkedEndpoint(name: string, reply: RemoteResponse): RemoteResponse {
    if (reply.error ? !validateEndpointError(reply.error) : !validateEndpointOutput(name, reply.result)) throw new Error('Invalid local endpoint projection');
    return reply;
  }
  return {
    async ownerConnection(owner: string) {
      const runtime = prepare(await store.read());
      const binding = runtime.pairing.getBinding(owner);
      if (!binding) return { binding: null, status: null };
      const box = runtime.boxes.find((entry) => entry.ownerId === owner && entry.deviceId === binding.deviceId);
      const paired = binding.revokedAt === null && Date.parse(binding.lifetimeEndsAt) > now();
      const lastSeenAt = box?.heartbeat?.contractVersion === manifest.contractVersion ? box.heartbeat.lastSeenAt : null;
      return { binding, status: { paired, online: paired && lastSeenAt !== null
        && now() - Date.parse(lastSeenAt) < manifest.policy.limits.onlineWindowSeconds * 1000, lastSeenAt } };
    },
    async tool(owner: string, name: string, input: unknown): Promise<RemoteResponse> {
      if (!isRecord(input)) return { error: remoteError('payload_invalid') };
      return store.mutate((state) => {
        const runtime = prepare(state);
        const binding = runtime.pairing.getBinding(owner);
        if (!binding) {
          const timestamp = clock.now();
          const calls = Array.isArray(state.unpairedCalls) ? state.unpairedCalls : [];
          const liveCalls = calls.filter((entry) => isRecord(entry) && typeof entry.at === 'number' && entry.at > timestamp - 60_000);
          if (liveCalls.filter((entry) => isRecord(entry) && entry.ownerId === owner).length >= 30) {
            return checkedTool(name, { error: remoteError('rate_limited') });
          }
          state.unpairedCalls = [...liveCalls, { ownerId: owner, at: timestamp }];
          if (runtime.pairing.exportState().bindings.length > 0) return checkedTool(name, { error: remoteError('unauthorized') });
          const empty = createRemoteMailbox({ ownerId: owner, deviceId: 'dev_000000000000000000000000', generation: 1 }, clock);
          empty.revoke();
          return checkedTool(name, empty.tool(owner, name, input));
        }
        const active = runtime.mailbox(binding);
        const reply = active.engine.tool(owner, name, input);
        active.save();
        return checkedTool(name, reply);
      });
    },
    async endpoint(name: string, body: unknown, context: PairingContext, itemId?: string): Promise<RemoteResponse> {
      if (!isRecord(body)) return { error: remoteError('payload_invalid') };
      return store.mutate((state) => {
        const runtime = prepare(state);
        if (name.startsWith('pairing.')) {
          const reply = runtime.pairing.endpoint(name, body, context);
          runtime.synchronize();
          return checkedEndpoint(name, reply);
        }
        if (!context.platformAdmitted) return { error: remoteError('unauthorized') };
        const identity = runtime.pairing.authenticate(context.sessionToken);
        if ('code' in identity) return { error: identity };
        const binding = runtime.pairing.getBinding(identity.ownerId);
        if (!binding) return { error: remoteError('unauthorized') };
        const active = runtime.mailbox(binding);
        const reply = active.engine.endpoint(identity, name, body, itemId);
        active.save();
        return checkedEndpoint(name, reply);
      }, (reply) => reply.error?.code === 'device_credential_reused'
        || (!reply.error && (name === 'pairing.revoke' || name === 'pairing.owner.revoke')));
    },
  };
}
