import { createHash } from 'node:crypto';
import { manifest, remoteError, validateEndpoint, validateTool } from './remote-contracts.ts';

export type RemoteBinding = {
  ownerId: string;
  deviceId: string;
  generation: number;
  dotIdentity?: { source: string; subject: string };
};
export type RemoteClock = { now(): number; itemId(): string; leaseNonce(): string };
type ObjectValue = Record<string, unknown>;
type Lease = { leaseNonce: string; generation: number; leaseExpiresAt: string };
type Receipt = {
  itemId: string; kind: string; state: string; payloadSha256: string | null;
  dependsOnItemId: string | null; dotRequestId: string | null;
  createdAt: string; expiresAt: string; updatedAt: string;
  duplicate?: boolean; refusal?: ObjectValue;
};
type InboxRecord = {
  receipt: Receipt; payload: ObjectValue | null; lease: Lease | null;
  tool: string; dedupKey: string; dedupHash: string | null;
  ack: ObjectValue | null;
};
type Event = {
  eventId: string; kind: string; dotRequestId: string; sourceRevision: number;
  at: string; data: ObjectValue;
};
type Projection = {
  dotRequestId: string; submitItemId: string; workspaceRef: string; requestedAccess: string;
  appliedRevision: number; status: Event | null; prompts: Event[]; messageOutcomes: Event[];
  validationResults: Event[]; deliverable: Event | null; validationDecisions: Event[];
};
export type RemoteMailboxState = {
  version: 1;
  ownerId: string; deviceId: string; generation: number; paired: boolean;
  items: InboxRecord[];
  requests: Record<string, Projection>;
  eventIds: Record<string, { hash: string; storedAt: string }>;
  heartbeat: { lastSeenAt: string; appVersion: string; contractVersion: 3 } | null;
  /** Pending facets evicted from the bounded per-request view still wait in the binding's open set. */
  validationDecisionOverflow: Event[];
  /** Settled ids stay fenced after their detailed event leaves the bounded projection. */
  settledValidationIds: { dotRequestId: string; validationId: string }[];
  workspaces: { workspaceRef: string; displayName: string }[];
  publishedAt: string | null;
  toolCalls: number[];
};
export type RemoteReply = { result: unknown; error?: never } | {
  error: ReturnType<typeof remoteError>; result?: never;
};

/** Canonicalization follows the R2 payloadHash rule, including UTF-16 key ordering. */
export function canonicalPayload(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalPayload(item ?? null)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as ObjectValue;
    return `{${Object.keys(object).sort().filter((key) => object[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalPayload(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
export function payloadSha256(value: unknown): string {
  return createHash('sha256').update(canonicalPayload(value), 'utf8').digest('hex');
}

const policy = manifest.policy;
const limits = policy.limits;
const defaults = policy.defaults;
const millis = (value: string) => Date.parse(value);
const iso = (value: number) => new Date(value).toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const fail = (code: string): RemoteReply => ({ error: remoteError(code) });
const ok = (result: unknown): RemoteReply => ({ result: clone(result) });
const waiting = (item: InboxRecord) => ['queued', 'claimed'].includes(item.receipt.state);
const refusal = (code: string) => ({ by: 'site', code, message: remoteError(code).message });

/**
 * Deterministic state machine. Authentication and persistence wrap this engine: the HTTP layer
 * resolves sessions into callers, then atomically persists exportState() with a version CAS.
 * Item IDs and lease nonces come from cryptographic generators in production and injected values
 * in replay tests. No expected vector output is consulted by the implementation.
 */
export function createRemoteMailbox(
  binding: RemoteBinding,
  clock: RemoteClock,
  persistedState?: RemoteMailboxState,
) {
  const state: RemoteMailboxState = persistedState ? clone(persistedState) : {
    version: 1, ownerId: binding.ownerId, deviceId: binding.deviceId,
    generation: binding.generation, paired: true, items: [], requests: {}, eventIds: {},
    heartbeat: null, workspaces: [], publishedAt: null, toolCalls: [],
    validationDecisionOverflow: [], settledValidationIds: [],
  };
  if (state.version !== 1 || state.ownerId !== binding.ownerId || state.deviceId !== binding.deviceId) {
    throw new Error('Mailbox state does not belong to this owner and device.');
  }

  state.validationDecisionOverflow ??= [];
  state.settledValidationIds ??= [];
  // An old heartbeat proves contact with a v2 App, never current v3 presence.
  if (state.heartbeat?.contractVersion !== manifest.contractVersion) state.heartbeat = null;
  for (const request of Object.values(state.requests)) {
    request.validationDecisions ??= [];
    for (const event of request.validationDecisions) {
      if (event.kind === 'validation_decision_settled'
        && !state.settledValidationIds.some((entry) => entry.validationId === event.data.validationId)) {
        state.settledValidationIds.push({ dotRequestId: event.dotRequestId, validationId: event.data.validationId as string });
      }
    }
  }

  const retained = (item: InboxRecord) => waiting(item)
    || millis(item.receipt.updatedAt) > clock.now() - defaults.retentionDays * 86_400_000;
  const itemAt = (itemId: string) => state.items.find((entry) => entry.receipt.itemId === itemId && retained(entry));
  const submitFor = (requestId: string) => state.items.find((entry) =>
    entry.receipt.kind === 'submit' && entry.receipt.state === 'accepted' && retained(entry)
      && entry.receipt.dotRequestId === requestId);

  function resolveCancelDependencies(target: InboxRecord) {
    for (const item of state.items) {
      if (item.receipt.kind !== 'cancel' || item.receipt.dependsOnItemId !== target.receipt.itemId
          || item.receipt.state !== 'queued') continue;
      if (target.receipt.state === 'accepted') {
        if (item.receipt.payloadSha256 !== null) continue;
        item.payload = { contractVersion: manifest.contractVersion, dotRequestId: target.receipt.dotRequestId };
        item.receipt.dotRequestId = target.receipt.dotRequestId;
        item.receipt.payloadSha256 = payloadSha256(item.payload);
        item.receipt.updatedAt = target.receipt.updatedAt;
      } else if (['refused', 'expired', 'canceled_before_claim'].includes(target.receipt.state)) {
        item.receipt.state = 'refused';
        item.receipt.refusal = refusal('cancel_target_not_admitted');
        item.receipt.updatedAt = target.receipt.updatedAt;
        item.payload = null;
      }
    }
  }

  function housekeeping() {
    const now = clock.now();
    for (const item of state.items) {
      const receipt = item.receipt;
      if (receipt.state === 'claimed' && item.lease && millis(item.lease.leaseExpiresAt) <= now) {
        const endedAt = item.lease.leaseExpiresAt;
        receipt.state = millis(receipt.expiresAt) <= millis(endedAt) ? 'expired' : 'queued';
        receipt.updatedAt = endedAt;
        item.lease = null;
      }
      if (receipt.state === 'queued' && millis(receipt.expiresAt) <= now) {
        receipt.state = 'expired';
        receipt.updatedAt = receipt.expiresAt;
      }
      if (!waiting(item)) item.payload = null;
      if (receipt.kind === 'submit') resolveCancelDependencies(item);
    }
    state.toolCalls = state.toolCalls.filter((time) => time > now - 60_000);
    // Limit each sweep, including dedup records and projections, to avoid an unbounded D1 write.
    const cutoff = now - defaults.retentionDays * 86_400_000;
    const removable = state.items.filter((item) => !waiting(item)
      && millis(item.receipt.updatedAt) <= cutoff).slice(0, 100);
    const removed = new Set(removable.map((item) => item.receipt.itemId));
    state.items = state.items.filter((item) => !removed.has(item.receipt.itemId));
    for (const [requestId, projection] of Object.entries(state.requests)) {
      if (removed.has(projection.submitItemId)) delete state.requests[requestId];
    }
    const oldEvents = Object.entries(state.eventIds).filter(([, event]) =>
      millis(event.storedAt) <= cutoff).slice(0, 100);
    for (const [eventId] of oldEvents) delete state.eventIds[eventId];
    const obsoleteFacets = new Set(state.validationDecisionOverflow.filter((event) =>
      !state.requests[event.dotRequestId] || millis(event.at) <= cutoff).slice(0, 100));
    state.validationDecisionOverflow = state.validationDecisionOverflow.filter((event) => !obsoleteFacets.has(event));
    const obsoleteSettlements = new Set(state.settledValidationIds.filter((entry) =>
      !state.requests[entry.dotRequestId]).slice(0, 100));
    state.settledValidationIds = state.settledValidationIds.filter((entry) => !obsoleteSettlements.has(entry));
  }

  function createItem(
    tool: string, kind: string, key: string, payload: ObjectValue | null,
    dependency: InboxRecord | null, deadline?: string,
  ): InboxRecord {
    const now = clock.now();
    const receipt: Receipt = {
      itemId: clock.itemId(), kind, state: 'queued',
      payloadSha256: payload === null ? null : payloadSha256(payload),
      dependsOnItemId: dependency?.receipt.itemId ?? null,
      dotRequestId: dependency?.receipt.dotRequestId ?? null,
      createdAt: iso(now), expiresAt: iso(Math.min(
        now + defaults.submitTtlMinutes * 60_000, deadline === undefined ? Infinity : millis(deadline),
      )), updatedAt: iso(now),
    };
    if (state.items.some((item) => item.receipt.itemId === receipt.itemId)
        || receipt.itemId === key) throw new Error('The generated item id is not unique.');
    const record: InboxRecord = {
      receipt, payload: clone(payload), lease: null, tool, dedupKey: key,
      dedupHash: payload === null ? null : receipt.payloadSha256, ack: null,
    };
    state.items.push(record);
    return record;
  }

  function existing(tool: string, key: string, payload: ObjectValue): InboxRecord | RemoteReply | null {
    const found = state.items.find((item) => item.tool === tool && item.dedupKey === key && retained(item));
    if (!found) return null;
    return found.dedupHash === payloadSha256(payload) ? found : fail('idempotency_conflict');
  }
  const full = () => state.items.filter(waiting).length >= limits.inboxWaitingMax;
  const isSettledValidation = (validationId: unknown) =>
    state.settledValidationIds.some((entry) => entry.validationId === validationId);
  function openValidationDecisions(): Event[] {
    return [...Object.values(state.requests).flatMap((request) => request.validationDecisions),
      ...state.validationDecisionOverflow]
      .filter((event) => event.kind === 'validation_decision_pending'
        && submitFor(event.dotRequestId) && !isSettledValidation(event.data.validationId)
        && millis(event.at) > clock.now() - defaults.retentionDays * 86_400_000)
      .sort((left, right) => {
        const chronological = millis(left.data.createdAt as string) - millis(right.data.createdAt as string);
        const leftId = left.data.validationId as string;
        const rightId = right.data.validationId as string;
        return chronological || (leftId < rightId ? -1 : leftId === rightId ? 0 : 1);
      }).slice(0, limits.validationDecisionsOpenMax);
  }
  const validationCursor = (event: Event, requestFilter: unknown) => payloadSha256({
    ownerId: state.ownerId, deviceId: state.deviceId, requestFilter: requestFilter ?? null,
    dotRequestId: event.dotRequestId, createdAt: event.data.createdAt, validationId: event.data.validationId,
  });

  function tool(ownerId: string, name: string, input: ObjectValue): RemoteReply {
    if (ownerId !== state.ownerId) return fail('unauthorized');
    const args = clone(input);
    if (!validateTool(name, args)) return fail('payload_invalid');
    housekeeping();
    if (state.toolCalls.length >= limits.toolCallsPerMinute) return fail('rate_limited');
    state.toolCalls.push(clock.now());
    const spec = manifest.tools.find((entry) => entry.name === name);
    if (!spec) return fail('payload_invalid');
    if (!spec.annotations.readOnlyHint && !state.paired) return fail('nash_never_paired');

    if (name === 'nash_status') return ok({ status: {
      paired: state.paired,
      online: state.paired && state.heartbeat !== null
        && clock.now() - millis(state.heartbeat.lastSeenAt) < limits.onlineWindowSeconds * 1000,
      lastSeenAt: state.heartbeat?.lastSeenAt ?? null,
      appVersion: state.heartbeat?.appVersion ?? null,
      contractVersion: state.heartbeat?.contractVersion ?? null,
      onlineWindowSeconds: limits.onlineWindowSeconds,
      manifestSha256: manifest.manifestSha256,
    } });
    if (name === 'nash_list_workspaces') return ok({
      workspaces: state.workspaces, publishedAt: state.publishedAt,
    });
    if (name === 'nash_get_receipt') {
      const item = itemAt(args.itemId as string);
      return item ? ok({ receipt: item.receipt }) : fail('receipt_not_found');
    }
    if (name === 'nash_get_request') {
      const request = state.requests[args.dotRequestId as string];
      return request && submitFor(request.dotRequestId) ? ok({ request }) : fail('request_not_found');
    }
    if (name === 'nash_list_requests') {
      const sorted = state.items.filter((item) => item.receipt.kind === 'submit' && retained(item)).reverse();
      let start = 0;
      if (args.cursor) {
        const index = sorted.findIndex((item) => item.receipt.itemId === args.cursor);
        if (index < 0) return fail('payload_invalid');
        start = index + 1;
      }
      const count = args.limit as number;
      const page = sorted.slice(start, start + count);
      return ok({ requests: page.map((item) => ({
        receipt: item.receipt,
        status: item.receipt.dotRequestId ? state.requests[item.receipt.dotRequestId]?.status ?? null : null,
      })), nextCursor: start + count < sorted.length ? page.at(-1)!.receipt.itemId : null });
    }
    if (name === 'nash_list_permission_prompts') {
      const decisions = Object.values(state.requests)
        .filter((request) => submitFor(request.dotRequestId))
        .filter((request) => !args.dotRequestId || request.dotRequestId === args.dotRequestId)
        .flatMap((request) => request.prompts)
        .filter((event) => event.kind === 'permission_prompt_opened'
          && event.data.status === 'pending' && millis(event.data.deadlineAt as string) > clock.now())
        .sort((a, b) => millis(b.data.createdAt as string) - millis(a.data.createdAt as string))
        .slice(0, args.limit as number).map((event) => event.data);
      return ok({ decisions });
    }
    if (name === 'nash_list_validation_decisions') {
      const open = openValidationDecisions().filter((event) =>
        !args.dotRequestId || event.dotRequestId === args.dotRequestId);
      let start = 0;
      if (args.cursor) {
        const index = open.findIndex((event) => validationCursor(event, args.dotRequestId) === args.cursor);
        if (index < 0) return fail('payload_invalid');
        start = index + 1;
      }
      const count = args.limit as number;
      const page = open.slice(start, start + count);
      return ok({ validations: page.map((event) => event.data),
        nextCursor: start + count < open.length ? validationCursor(page.at(-1)!, args.dotRequestId) : null });
    }
    if (name === 'nash_cancel_request') {
      const target = itemAt(args.submitItemId as string);
      if (!target || target.receipt.kind !== 'submit') return fail('receipt_not_found');
      let cancel = state.items.find((item) => item.tool === name && item.dedupKey === args.submitItemId);
      if (target.receipt.state === 'queued') {
        target.receipt.state = 'canceled_before_claim';
        target.receipt.updatedAt = iso(clock.now());
        target.payload = null;
        resolveCancelDependencies(target);
      }
      if (target.receipt.state === 'canceled_before_claim') return ok({
        outcome: 'canceled_before_claim', target: target.receipt, cancel: null,
      });
      if (cancel) return ok({ outcome: 'forwarded', target: target.receipt, cancel: cancel.receipt });
      if (['refused', 'expired'].includes(target.receipt.state)) return ok({
        outcome: 'nothing_to_cancel', target: target.receipt, cancel: null,
      });
      if (full()) return fail('inbox_full');
      const payload = target.receipt.dotRequestId ? {
        contractVersion: manifest.contractVersion, dotRequestId: target.receipt.dotRequestId,
      } : null;
      cancel = createItem(name, 'cancel', args.submitItemId as string, payload, target);
      return ok({ outcome: 'forwarded', target: target.receipt, cancel: cancel.receipt });
    }

    const payload: ObjectValue = { ...args, contractVersion: manifest.contractVersion };
    const kind = spec.nash.inboxKind;
    const key = args[spec.nash.dedupKey as string] as string;
    const repeated = existing(name, key, payload);
    if (repeated) return 'receipt' in repeated ? ok({ receipt: repeated.receipt }) : repeated;
    let dependency: InboxRecord | null = null;
    let deadline: string | undefined;
    if (kind === 'message') {
      dependency = submitFor(args.dotRequestId as string) ?? null;
      if (!dependency) return fail('request_not_found');
    } else if (kind === 'permission_answer') {
      const prompt = Object.values(state.requests).flatMap((request) => request.prompts)
        .find((event) => event.data.decisionId === args.decisionId);
      if (!prompt || prompt.kind !== 'permission_prompt_opened'
          || prompt.data.status !== 'pending' || millis(prompt.data.deadlineAt as string) <= clock.now()) {
        return fail('decision_not_open');
      }
      if (args.decision === 'allow' && prompt.data.dotMayAllow !== true) {
        return fail('decision_allow_not_permitted');
      }
      dependency = submitFor(prompt.dotRequestId) ?? null;
      if (!dependency) return fail('request_not_found');
      deadline = prompt.data.deadlineAt as string;
    }
    if (kind === 'validation_decision') {
      const pending = openValidationDecisions().find((event) => event.data.validationId === args.validationId);
      if (!pending) return fail('validation_decision_not_open');
      dependency = submitFor(pending.dotRequestId) ?? null;
      if (!dependency) return fail('validation_decision_not_open');
    }
    if (full()) return fail('inbox_full');
    if (!kind) return fail('payload_invalid');
    return ok({ receipt: createItem(name, kind, key, payload, dependency, deadline).receipt });
  }

  function revoke(generation = state.generation): RemoteReply {
    if (!state.paired || generation !== state.generation) return fail('generation_revoked');
    const revokedGeneration = state.generation;
    if (state.generation >= Number.MAX_SAFE_INTEGER) throw new Error('Pairing generation exhausted.');
    state.generation += 1;
    state.paired = false;
    for (const item of state.items) {
      if (!waiting(item)) continue;
      item.receipt.state = 'refused';
      item.receipt.refusal = refusal('pairing_revoked');
      item.receipt.updatedAt = iso(clock.now());
      item.lease = null;
      item.payload = null;
    }
    return ok({ revokedGeneration });
  }

  function foldValidationDecision(request: Projection, event: Event) {
    // NASH's cursor still advances for a higher-revision pending report, but a settled facet
    // stays closed, including after its detailed event was evicted from the public projection.
    if (event.kind === 'validation_decision_pending' && isSettledValidation(event.data.validationId)) return;
    if (event.kind === 'validation_decision_settled' && !isSettledValidation(event.data.validationId)) {
      state.settledValidationIds.push({ dotRequestId: event.dotRequestId, validationId: event.data.validationId as string });
    }
    const facets = [...request.validationDecisions,
      ...state.validationDecisionOverflow.filter((entry) => entry.dotRequestId === event.dotRequestId)]
      .filter((previous) => previous.data.validationId !== event.data.validationId);
    facets.push(event);
    facets.sort((left, right) => left.sourceRevision - right.sourceRevision);
    request.validationDecisions = facets.slice(-limits.projectionListMax);
    state.validationDecisionOverflow = [
      ...state.validationDecisionOverflow.filter((entry) => entry.dotRequestId !== event.dotRequestId),
      ...facets.slice(0, Math.max(0, facets.length - limits.projectionListMax))
        .filter((entry) => entry.kind === 'validation_decision_pending'),
    ];
  }

  function applyEvents(body: ObjectValue): RemoteReply {
    const results: { eventId: string; status: string }[] = [];
    const touched = new Set<string>();
    for (const event of body.events as Event[]) {
      const hash = payloadSha256(event);
      const stored = state.eventIds[event.eventId];
      const request = state.requests[event.dotRequestId];
      let status: string;
      if (stored) status = stored.hash === hash ? 'duplicate' : 'conflict';
      else if (!request || !submitFor(event.dotRequestId)) status = 'unknown_request';
      else {
        state.eventIds[event.eventId] = { hash, storedAt: iso(clock.now()) };
        if (event.sourceRevision <= request.appliedRevision) status = 'stale';
        else {
          status = 'applied';
          request.appliedRevision = event.sourceRevision;
          if (['validation_decision_pending', 'validation_decision_settled'].includes(event.kind)) {
            foldValidationDecision(request, event);
          } else if (event.kind === 'request_status') request.status = event;
          else if (event.kind === 'deliverable_summary') request.deliverable = event;
          else if (['permission_prompt_opened', 'permission_prompt_closed', 'validation_decision_pending'].includes(event.kind)) {
            request.prompts = request.prompts.filter((previous) =>
              previous.data.decisionId !== event.data.decisionId);
            request.prompts.push(event);
            request.prompts = request.prompts.slice(-limits.projectionListMax);
          } else if (event.kind === 'message_outcome') {
            request.messageOutcomes = request.messageOutcomes.filter((previous) =>
              previous.data.messageId !== event.data.messageId);
            request.messageOutcomes.push(event);
            request.messageOutcomes = request.messageOutcomes.slice(-limits.projectionListMax);
          } else if (event.kind === 'validation_result') {
            request.validationResults.push(event);
            request.validationResults = request.validationResults.slice(-limits.projectionListMax);
          }
        }
      }
      results.push({ eventId: event.eventId, status });
      if (request) touched.add(event.dotRequestId);
    }
    return ok({ results, cursors: [...touched].map((dotRequestId) => ({
      dotRequestId, appliedRevision: state.requests[dotRequestId].appliedRevision,
    })) });
  }

  function endpoint(
    caller: { deviceId: string; generation: number }, name: string, input: ObjectValue, itemId?: string,
  ): RemoteReply {
    if (caller.deviceId !== state.deviceId) return fail('unauthorized');
    if (!state.paired || caller.generation !== state.generation) return fail('generation_revoked');
    const body = clone(input);
    if (!validateEndpoint(name, body)) return fail('payload_invalid');
    if (body.generation !== state.generation) return fail('generation_revoked');
    if (itemId !== undefined && body.itemId !== itemId) return fail('payload_invalid');
    // The generated JSON schemas cannot express these Zod cross-field refinements.
    if (name === 'events.post' && (body.events as Event[]).some((event) =>
      (['permission_prompt_opened', 'permission_prompt_closed', 'validation_decision_pending'].includes(event.kind)
        && event.data.dotRequestId !== event.dotRequestId)
      || (event.kind === 'message_outcome' && event.data.outcome === 'refused'
        && event.data.reason === null)
      || (event.kind === 'validation_decision_pending' && event.data.summaryWithheld === true
        && event.data.summary !== null)
      || (event.kind === 'validation_decision_settled'
        && (event.data.outcome === 'closed') !== (event.data.decidedAt === null)))) return fail('payload_invalid');
    if (name === 'workspaces.put') {
      const refs = (body.workspaces as RemoteMailboxState['workspaces']).map((workspace) => workspace.workspaceRef);
      if (new Set(refs).size !== refs.length) return fail('payload_invalid');
    }
    housekeeping();
    if (name === 'pairing.revoke') return revoke(caller.generation);
    if (name === 'heartbeat.post') {
      state.heartbeat = {
        lastSeenAt: iso(clock.now()), appVersion: body.appVersion as string, contractVersion: 3,
      };
      return ok({ serverTime: iso(clock.now()) });
    }
    if (name === 'workspaces.put') {
      state.workspaces = body.workspaces as RemoteMailboxState['workspaces'];
      state.publishedAt = body.publishedAt as string;
      return ok({ storedAt: iso(clock.now()) });
    }
    if (name === 'events.post') return applyEvents(body);
    if (name === 'inbox.lease') {
      const eligible = state.items.filter((item) => item.receipt.state === 'queued'
        && item.payload !== null && item.payload.contractVersion === manifest.contractVersion
        && (item.receipt.dependsOnItemId === null
          || itemAt(item.receipt.dependsOnItemId)?.receipt.state === 'accepted'))
        .slice(0, body.maxItems as number);
      const items = eligible.map((item) => {
        item.lease = {
          leaseNonce: clock.leaseNonce(), generation: state.generation,
          leaseExpiresAt: iso(clock.now() + limits.leaseSeconds * 1000),
        };
        item.receipt.state = 'claimed';
        item.receipt.updatedAt = iso(clock.now());
        return {
          itemId: item.receipt.itemId, kind: item.receipt.kind, payload: item.payload,
          payloadSha256: item.receipt.payloadSha256,
          dependsOnItemId: item.receipt.dependsOnItemId, createdAt: item.receipt.createdAt,
          expiresAt: item.receipt.expiresAt, lease: item.lease,
        };
      });
      return ok({ generation: state.generation, serverTime: iso(clock.now()), items });
    }
    if (name !== 'inbox.ack' && name !== 'inbox.renew') return fail('payload_invalid');
    if (!itemId) return fail('payload_invalid');
    const item = itemAt(itemId);
    if (!item || !item.lease || item.lease.leaseNonce !== body.leaseNonce) return fail('lease_lost');
    if (item.lease.generation !== body.generation) return fail('generation_revoked');
    if (name === 'inbox.renew') {
      if (item.receipt.state !== 'claimed') return fail('lease_lost');
      item.lease.leaseExpiresAt = iso(clock.now() + limits.leaseSeconds * 1000);
      return ok({ itemId, leaseNonce: item.lease.leaseNonce, leaseExpiresAt: item.lease.leaseExpiresAt });
    }
    if (body.payloadSha256 !== item.receipt.payloadSha256) return fail('payload_invalid');
    const outcome: ObjectValue = { outcome: body.outcome };
    if ('dotRequestId' in body) outcome.dotRequestId = body.dotRequestId;
    if ('refusal' in body) outcome.refusal = body.refusal;
    if (item.ack !== null) {
      if (canonicalPayload(item.ack) !== canonicalPayload(outcome)) return fail('ack_conflict');
      return ok({ itemId, recorded: 'already_recorded', receiptState: item.receipt.state });
    }
    if (item.receipt.state !== 'claimed') return fail('lease_lost');
    if (['accepted', 'duplicate'].includes(body.outcome as string)) {
      if (millis(item.receipt.expiresAt) <= clock.now()) return fail('payload_invalid');
      if (item.receipt.kind !== 'submit' && body.dotRequestId !== item.receipt.dotRequestId) {
        return fail('payload_invalid');
      }
      if (item.receipt.kind === 'submit' && submitFor(body.dotRequestId as string)
          && submitFor(body.dotRequestId as string) !== item) return fail('payload_invalid');
      item.receipt.state = 'accepted';
      item.receipt.dotRequestId = body.dotRequestId as string;
      item.receipt.duplicate = body.outcome === 'duplicate';
      if (item.receipt.kind === 'submit') state.requests[body.dotRequestId as string] = {
        dotRequestId: body.dotRequestId as string, submitItemId: itemId,
        workspaceRef: item.payload!.workspaceRef as string,
        requestedAccess: item.payload!.requestedAccess as string,
        appliedRevision: 0, status: null, prompts: [], messageOutcomes: [],
        validationResults: [], deliverable: null, validationDecisions: [],
      };
    } else if (body.outcome === 'refused') {
      if (item.receipt.kind !== 'submit' && body.dotRequestId !== null && body.dotRequestId !== item.receipt.dotRequestId) {
        return fail('payload_invalid');
      }
      item.receipt.state = 'refused';
      item.receipt.refusal = body.refusal as ObjectValue;
    } else item.receipt.state = 'expired';
    item.receipt.updatedAt = iso(clock.now());
    item.ack = outcome;
    item.payload = null;
    if (item.receipt.kind === 'submit') resolveCancelDependencies(item);
    return ok({ itemId, recorded: 'applied', receiptState: item.receipt.state });
  }

  return { tool, endpoint, revoke, exportState: () => clone(state) };
}
