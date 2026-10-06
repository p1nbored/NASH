import { Buffer } from 'node:buffer';
import { createHash, timingSafeEqual } from 'node:crypto';
import { manifest, remoteError, validateEndpoint, type RemoteError, type RemoteResponse } from './remote-contracts.ts';

export type PairingContext = { ownerId?: string; platformAdmitted: boolean; sessionToken?: string; deviceCredential?: string };
export type PairingIdentity = { ownerId: string; deviceId: string; generation: number };
export type PairingBinding = PairingIdentity & {
  dotIdentity: { source: 'sites_mcp_identity'; subject: string };
  createdAt: string;
  lifetimeEndsAt: string;
  revokedAt: string | null;
};

type ChallengeRecord = {
  challengeId: string;
  userCodeHash: string;
  deviceCodeHash: string;
  deviceId: string;
  expiresAt: number;
  state: 'pending' | 'approved' | 'denied' | 'used';
  ownerId: string | null;
};
type SessionRecord = PairingIdentity & { tokenHash: string; expiresAt: number; retired: boolean };
type DeviceCredentialRecord = PairingIdentity & {
  credentialId: string; salt: string; secretHash: string;
  dotIdentity: PairingBinding['dotIdentity']; issuedAt: string;
  lifetimeEndsAt: string; supersededAt: string | null;
};
export type RemotePairingState = {
  version: 1;
  challenges: ChallengeRecord[];
  sessions: SessionRecord[];
  bindings: PairingBinding[];
  deviceCredentials: DeviceCredentialRecord[];
};

const SAFE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
const CHALLENGE_MS = 10 * 60_000;
const SESSION_MS = 15 * 60_000;
const RENEW_AFTER_MS = 10 * 60_000;
const POLL_SECONDS = 5;
const LIFETIME_MS = manifest.policy.defaults.deviceCredentialLifetimeDays * 86_400_000;
const RETENTION_MS = manifest.policy.defaults.retentionDays * 86_400_000;
const PURGE_BATCH = 100;
// The aggregate adapter has a 1 MiB snapshot budget. Pairing allocations leave room for mailboxes
// and reserve space for a revocation even when valid, retained metadata cannot yet be purged.
const PAIRING_ALLOCATION_BYTES = 384 * 1024 - 8 * 1024;

export type PairingGenerators = {
  challengeId?(): string; userCode?(): string; deviceCode?(): string; deviceId?(): string;
  sessionToken?(): string; deviceCredential?(): string;
};

function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function verifiedOwner(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 256
    && Array.from(value).every((character) => character.charCodeAt(0) >= 0x21 && character.charCodeAt(0) <= 0x7e);
}
function fail(code: string): RemoteResponse { return { error: remoteError(code) }; }
function ok(result: unknown): RemoteResponse { return { result }; }

/**
 * Pure local R2 state machine. The local aggregate adapter is responsible for
 * committing a whole operation with CAS and synchronizing mailbox generations.
 * No endpoint admits a real NASH device or validates a real platform credential.
 * The adapter supplies verified identity and the platform admission result.
 */
export function createRemotePairing(options: { now: () => number; randomBytes?: () => Uint8Array;
  generate?: PairingGenerators }, persistedState?: unknown) {
  const state = persistedState === undefined
    ? { version: 1 as const, challenges: [], sessions: [], bindings: [], deviceCredentials: [] }
    : structuredClone(persistedState) as RemotePairingState;
  if (!state || state.version !== 1 || !Array.isArray(state.challenges)
    || !Array.isArray(state.sessions) || !Array.isArray(state.bindings)) {
    throw new Error('Invalid local pairing state');
  }
  // Old local snapshots predate refresh credentials. They receive the original creation-based
  // deadline, never a new lifetime, and can issue no refresh credential without owner pairing.
  state.deviceCredentials ??= [];
  if (!Array.isArray(state.deviceCredentials)) throw new Error('Invalid local pairing credentials');
  for (const binding of state.bindings) {
    binding.lifetimeEndsAt ??= new Date(Date.parse(binding.createdAt) + LIFETIME_MS).toISOString();
  }

  function now(): number {
    const value = options.now();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000 - LIFETIME_MS) {
      throw new Error('Invalid local pairing clock');
    }
    return value;
  }
  function random32(): Uint8Array {
    const bytes = options.randomBytes?.() ?? crypto.getRandomValues(new Uint8Array(32));
    if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error('Invalid local pairing entropy source');
    return bytes.slice();
  }
  function opaqueCode(): string { return Buffer.from(random32()).toString('base64url'); }
  function uuid(): string {
    const bytes = random32().slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Buffer.from(bytes).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function current(ownerId: string): PairingBinding | undefined { return state.bindings.find((binding) => binding.ownerId === ownerId); }

  function cleanup() {
    const cutoff = now() - RETENTION_MS;
    let challenges = 0;
    let sessions = 0;
    let credentials = 0;
    state.challenges = state.challenges.filter((record) =>
      !(record.expiresAt <= cutoff && challenges++ < PURGE_BATCH));
    state.sessions = state.sessions.filter((record) =>
      !(record.expiresAt <= cutoff && sessions++ < PURGE_BATCH));
    // A superseded credential must remain recognizable throughout the absolute pairing lifetime.
    // Otherwise stealing an earlier credential would stop triggering reuse revocation after purge.
    state.deviceCredentials = state.deviceCredentials.filter((record) =>
      !(Date.parse(record.lifetimeEndsAt) <= cutoff && credentials++ < PURGE_BATCH));
  }

  function canAllocate(additions: {
    challenge?: ChallengeRecord; session?: SessionRecord; credential?: DeviceCredentialRecord;
    binding?: PairingBinding;
  }): boolean {
    cleanup();
    const proposed: RemotePairingState = {
      ...state,
      challenges: additions.challenge ? [...state.challenges, additions.challenge] : state.challenges,
      sessions: additions.session ? [...state.sessions, additions.session] : state.sessions,
      deviceCredentials: additions.credential ? [...state.deviceCredentials, additions.credential] : state.deviceCredentials,
      bindings: additions.binding ? [...state.bindings.filter((record) => record.ownerId !== additions.binding!.ownerId), additions.binding] : state.bindings,
    };
    return Buffer.byteLength(JSON.stringify(proposed), 'utf8') <= PAIRING_ALLOCATION_BYTES;
  }

  function authenticateSession(sessionToken: string | undefined, renewing = false): PairingIdentity | RemoteError {
    if (typeof sessionToken !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(sessionToken)) return remoteError('unauthorized');
    const session = state.sessions.find((entry) => entry.tokenHash === hash(sessionToken));
    if (!session) return remoteError('unauthorized');
    const binding = current(session.ownerId);
    // Known old sessions remain hash-only tombstones, so revocation survives
    // expiry and restart without turning an old credential into a generic miss.
    if (!binding || binding.revokedAt !== null || binding.generation !== session.generation
      || binding.deviceId !== session.deviceId) return remoteError('generation_revoked');
    if (renewing && Date.parse(binding.lifetimeEndsAt) <= now()) return remoteError('pairing_expired');
    if (session.retired || session.expiresAt <= now()) return remoteError('session_expired');
    return { ownerId: session.ownerId, deviceId: session.deviceId, generation: session.generation };
  }

  function prepareSession(binding: PairingBinding, timestamp: number) {
    let sessionToken = '';
    let tokenHash = '';
    for (let attempt = 0; attempt < 8; attempt++) {
      sessionToken = options.generate?.sessionToken?.() ?? opaqueCode();
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(sessionToken)) throw new Error('Invalid generated session token');
      tokenHash = hash(sessionToken);
      if (!state.sessions.some((session) => session.tokenHash === tokenHash)) break;
      if (attempt === 7) throw new Error('Local pairing entropy collision');
    }
    const expiresAt = Math.min(timestamp + SESSION_MS, Date.parse(binding.lifetimeEndsAt));
    return {
      record: { tokenHash, ownerId: binding.ownerId, deviceId: binding.deviceId,
        generation: binding.generation, expiresAt, retired: false },
      grant: { sessionToken, deviceId: binding.deviceId, generation: binding.generation,
        expiresAt: new Date(expiresAt).toISOString(),
        renewAfter: new Date(Math.min(timestamp + RENEW_AFTER_MS, expiresAt)).toISOString() },
    };
  }

  function prepareCredential(binding: PairingBinding, timestamp: number) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const credential = options.generate?.deviceCredential?.()
        ?? `ndc_${Buffer.from(random32().slice(0, 12)).toString('hex')}.${opaqueCode()}`;
      if (!/^ndc_[0-9a-f]{24}\.[A-Za-z0-9_-]{43,86}$/.test(credential)) {
        throw new Error('Invalid generated device credential');
      }
      const [credentialId, secret] = credential.split('.');
      if (state.deviceCredentials.some((entry) => entry.credentialId === credentialId)) continue;
      const salt = opaqueCode();
      const record: DeviceCredentialRecord = {
        credentialId, salt, secretHash: hash(`${salt}.${secret}`), ownerId: binding.ownerId,
        deviceId: binding.deviceId, generation: binding.generation, dotIdentity: structuredClone(binding.dotIdentity),
        issuedAt: new Date(timestamp).toISOString(), lifetimeEndsAt: binding.lifetimeEndsAt, supersededAt: null,
      };
      return { record, grant: { credential, expiresAt: binding.lifetimeEndsAt } };
    }
    throw new Error('Local pairing entropy collision');
  }

  function revokeBinding(binding: PairingBinding, timestamp: number) {
    if (!Number.isSafeInteger(binding.generation + 1)) throw new Error('Local pairing generation exhausted');
    const revokedGeneration = binding.generation;
    binding.revokedAt = new Date(timestamp).toISOString();
    binding.generation++;
    for (const challenge of state.challenges) {
      if (challenge.ownerId === binding.ownerId && challenge.state === 'approved') challenge.state = 'used';
    }
    return ok({ revokedGeneration });
  }

  function endpoint(name: string, body: unknown, context: PairingContext): RemoteResponse {
    if (!validateEndpoint(name, body)) return fail('payload_invalid');
    const input = body as Record<string, unknown>;
    if (name !== 'pairing.approve' && name !== 'pairing.owner.revoke' && !context.platformAdmitted) return fail('unauthorized');
    const timestamp = now();

    if (name === 'pairing.challenge.create') {
      for (let attempt = 0; attempt < 8; attempt++) {
        const challengeId = options.generate?.challengeId?.() ?? uuid();
        const letters = Array.from(random32().slice(0, 8), (byte) => SAFE_LETTERS[byte % SAFE_LETTERS.length]).join('');
        const userCode = options.generate?.userCode?.() ?? `${letters.slice(0, 4)}-${letters.slice(4)}`;
        const deviceCode = options.generate?.deviceCode?.() ?? opaqueCode();
        const deviceId = options.generate?.deviceId?.() ?? `dev_${Buffer.from(random32().slice(0, 12)).toString('hex')}`;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(challengeId)
          || !/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(userCode)
          || !/^[A-Za-z0-9_-]{43,86}$/.test(deviceCode) || !/^dev_[0-9a-f]{24}$/.test(deviceId)) {
          throw new Error('Invalid generated pairing challenge');
        }
        const userCodeHash = hash(userCode);
        const deviceCodeHash = hash(deviceCode);
        if (state.challenges.some((entry) => entry.challengeId === challengeId || entry.userCodeHash === userCodeHash
          || entry.deviceCodeHash === deviceCodeHash || entry.deviceId === deviceId)) continue;
        const record: ChallengeRecord = { challengeId, userCodeHash, deviceCodeHash, deviceId,
          expiresAt: timestamp + CHALLENGE_MS, state: 'pending', ownerId: null };
        if (!canAllocate({ challenge: record })) return fail('rate_limited');
        state.challenges.push(record);
        return ok({ challengeId, userCode, deviceCode, expiresAt: new Date(timestamp + CHALLENGE_MS).toISOString(),
          pollIntervalSeconds: POLL_SECONDS });
      }
      throw new Error('Local pairing entropy collision');
    }

    if (name === 'pairing.approve') {
      if (!verifiedOwner(context.ownerId)) return fail('unauthorized');
      const challenge = state.challenges.find((entry) => entry.userCodeHash === hash(input.userCode as string));
      if (!challenge) return fail('challenge_not_found');
      if (challenge.expiresAt <= timestamp) return fail('challenge_expired');
      if (challenge.state !== 'pending') return fail('challenge_used');
      challenge.ownerId = context.ownerId;
      challenge.state = input.decision === 'approve' ? 'approved' : 'denied';
      return ok({ outcome: challenge.state });
    }

    if (name === 'pairing.session.issue') {
      const challenge = state.challenges.find((entry) => entry.challengeId === input.challengeId
        && entry.deviceCodeHash === hash(input.deviceCode as string));
      if (!challenge) return fail('challenge_not_found');
      if (challenge.expiresAt <= timestamp) return fail('challenge_expired');
      if (challenge.state === 'used') return fail('challenge_used');
      if (challenge.state === 'denied') return fail('challenge_denied');
      if (challenge.state === 'pending') return ok({ state: 'pending', pollIntervalSeconds: POLL_SECONDS });
      if (!verifiedOwner(challenge.ownerId)) return fail('unauthorized');
      const previous = current(challenge.ownerId);
      const generation = previous ? previous.generation + (previous.revokedAt === null ? 1 : 0) : 1;
      if (!Number.isSafeInteger(generation)) throw new Error('Local pairing generation exhausted');
      const binding: PairingBinding = { ownerId: challenge.ownerId, deviceId: challenge.deviceId, generation,
        dotIdentity: { source: 'sites_mcp_identity', subject: challenge.ownerId },
        createdAt: new Date(timestamp).toISOString(), lifetimeEndsAt: new Date(timestamp + LIFETIME_MS).toISOString(), revokedAt: null };
      // Prepare all fallible session entropy before consuming the challenge.
      const session = prepareSession(binding, timestamp);
      const credential = prepareCredential(binding, timestamp);
      if (!canAllocate({ session: session.record, credential: credential.record, binding })) return fail('rate_limited');
      state.sessions.push(session.record);
      state.deviceCredentials.push(credential.record);
      if (previous) state.bindings[state.bindings.indexOf(previous)] = binding;
      else state.bindings.push(binding);
      challenge.state = 'used';
      return ok({ state: 'issued', session: session.grant, deviceCredential: credential.grant });
    }

    if (name === 'pairing.session.refresh') {
      const credential = context.deviceCredential;
      if (typeof credential !== 'string' || !/^ndc_[0-9a-f]{24}\.[A-Za-z0-9_-]{43,86}$/.test(credential)) {
        return fail('device_credential_invalid');
      }
      const [credentialId, secret] = credential.split('.');
      const record = state.deviceCredentials.find((entry) => entry.credentialId === credentialId);
      if (!record || !timingSafeEqual(Buffer.from(hash(`${record.salt}.${secret}`), 'hex'),
        Buffer.from(record.secretHash, 'hex'))) return fail('device_credential_invalid');
      const binding = current(record.ownerId);
      if (!binding || binding.revokedAt !== null || binding.generation !== record.generation
        || binding.deviceId !== record.deviceId || input.generation !== binding.generation) {
        return fail('generation_revoked');
      }
      if (record.supersededAt !== null) {
        revokeBinding(binding, timestamp);
        return fail('device_credential_reused');
      }
      if (Date.parse(record.lifetimeEndsAt) <= timestamp) return fail('pairing_expired');
      const session = prepareSession(binding, timestamp);
      const replacement = prepareCredential(binding, timestamp);
      if (!canAllocate({ session: session.record, credential: replacement.record })) return fail('rate_limited');
      state.sessions.push(session.record);
      state.deviceCredentials.push(replacement.record);
      record.supersededAt = new Date(timestamp).toISOString();
      return ok({ session: session.grant, deviceCredential: replacement.grant });
    }

    if (name === 'pairing.owner.revoke') {
      if (!verifiedOwner(context.ownerId)) return fail('unauthorized');
      const binding = current(context.ownerId);
      if (!binding) return fail('unauthorized');
      if (binding.revokedAt !== null || input.generation !== binding.generation) return fail('generation_revoked');
      return revokeBinding(binding, timestamp);
    }

    if (name === 'pairing.session.renew' || name === 'pairing.revoke') {
      const identity = authenticateSession(context.sessionToken, name === 'pairing.session.renew');
      if ('code' in identity) return { error: identity };
      if (identity.generation !== input.generation) return fail('generation_revoked');
      const binding = current(identity.ownerId)!;
      if (name === 'pairing.revoke') {
        return revokeBinding(binding, timestamp);
      }
      const session = prepareSession(binding, timestamp);
      if (!canAllocate({ session: session.record })) return fail('rate_limited');
      state.sessions.push(session.record);
      state.sessions.find((entry) => entry.tokenHash === hash(context.sessionToken!))!.retired = true;
      return ok({ session: session.grant });
    }
    return fail('payload_invalid');
  }

  return {
    endpoint,
    authenticate: (sessionToken: string | undefined) => authenticateSession(sessionToken),
    getBinding(ownerId: string): PairingBinding | null { return structuredClone(current(ownerId) ?? null); },
    exportState(): RemotePairingState { cleanup(); return structuredClone(state); },
  };
}
