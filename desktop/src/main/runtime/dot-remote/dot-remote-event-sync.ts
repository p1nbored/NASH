import { createHash } from 'node:crypto'
import { canonicalJson } from '../../../shared/canonical-json'
import type { DotRemoteEventKind } from '../../../shared/dot-remote/dot-remote-events'
import {
  DOT_REMOTE_ARTIFACT_MAX,
  DOT_REMOTE_DELIVERABLE_SUMMARY_MAX_CHARS,
  DOT_REMOTE_VALIDATION_LINE_MAX_CHARS
} from '../../../shared/dot-remote/dot-remote-limits'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getDotRemoteArtifactRefs } from './dot-remote-artifact-refs'
import { dotRemoteErrorCode, isDotRemoteDataRefusal } from './dot-remote-error-code'
import type {
  DotRemoteEventSource,
  DotRemoteRequestSnapshot,
  DotRemoteValidationDecisionFact
} from './dot-remote-event-source'
import {
  DOT_REMOTE_DELIVERABLE_FALLBACK,
  DOT_REMOTE_VALIDATION_FALLBACKS,
  remoteEventLine
} from './dot-remote-event-texts'
import type { DotRemoteMessageOutcome } from './dot-remote-item-dispatch'
import { getDotRemoteOutboxStore } from './dot-remote-outbox-store'
import { getDotRemoteRequestStore } from './dot-remote-request-store'
import type { DotRemoteLog } from './dot-remote-timers'

// RG6: turns what the local readers say about each followed request into allowlisted events. One
// facet per reported aspect; an event is recorded only when its facet changed, with the next source
// revision, so a closed prompt or a superseded status can never be reported out of order.

type Facet = { facet: string; kind: DotRemoteEventKind; data: unknown }

const OPEN_REQUESTS_PER_SYNC = 200
const MESSAGE_FACET = 'message:'
const VALIDATION_DECISION_FACET = 'validation_decision:'
const BUSY_RUN_STATES: ReadonlySet<string> = new Set([
  'not_started',
  'launching',
  'active',
  'completing'
])
const ENDED_RUN_STATES: ReadonlySet<string> = new Set(['completed', 'failed', 'canceled'])

export type DotRemoteEventSyncDeps = {
  readonly owner: OrchestrationDb
  readonly source: DotRemoteEventSource
  readonly now: () => number
  readonly newEventId: () => string
  readonly log: DotRemoteLog
}

function signatureOf(facet: Facet): string {
  return createHash('sha256')
    .update(canonicalJson({ kind: facet.kind, data: facet.data }), 'utf8')
    .digest('hex')
}

function hasPendingPrompt(snapshot: DotRemoteRequestSnapshot): boolean {
  return snapshot.prompts.some((prompt) => prompt.status === 'pending')
}

/** A run is in progress, or a prompt waits: poll at the active cadence. */
function isBusy(snapshot: DotRemoteRequestSnapshot): boolean {
  const { status } = snapshot
  const running = status.run !== null && BUSY_RUN_STATES.has(status.run.state)
  return status.state === 'received' || running || hasPendingPrompt(snapshot)
}

/** A decision waits for the user, reported or not yet (beyond the open cap). */
function awaitsDecision(snapshot: DotRemoteRequestSnapshot): boolean {
  return (
    snapshot.awaitsValidationDecision ||
    snapshot.validationDecisions.some((fact) => fact.kind === 'pending')
  )
}

/** Nothing more can change: the request or its run ended and every last fact was read. */
function isFinished(snapshot: DotRemoteRequestSnapshot): boolean {
  const { status } = snapshot
  const ended =
    status.state === 'canceled' ||
    status.state === 'failed' ||
    (status.run !== null && ENDED_RUN_STATES.has(status.run.state))
  const awaitingSummary = status.run?.state === 'completed' && snapshot.deliverable === null
  const queued = snapshot.messages.some((message) => message.outcome === 'queued')
  return (
    ended && !awaitingSummary && !queued && !hasPendingPrompt(snapshot) && !awaitsDecision(snapshot)
  )
}

function validationDecisionFacet(fact: DotRemoteValidationDecisionFact): Facet {
  return fact.kind === 'pending'
    ? {
        facet: `${VALIDATION_DECISION_FACET}${fact.view.validationId}`,
        kind: 'validation_decision_pending',
        data: fact.view
      }
    : {
        facet: `${VALIDATION_DECISION_FACET}${fact.settled.validationId}`,
        kind: 'validation_decision_settled',
        data: fact.settled
      }
}

export function createDotRemoteEventSync(deps: DotRemoteEventSyncDeps) {
  const requests = getDotRemoteRequestStore(deps.owner)
  const outbox = getDotRemoteOutboxStore(deps.owner)
  const artifactRefs = getDotRemoteArtifactRefs(deps.owner)
  const iso = (): string => new Date(deps.now()).toISOString()

  function deliverableFacet(snapshot: DotRemoteRequestSnapshot): Facet[] {
    const { deliverable } = snapshot
    if (!deliverable) {
      return []
    }
    const artifacts = deliverable.artifacts.slice(0, DOT_REMOTE_ARTIFACT_MAX).map((artifact) => ({
      artifactId: artifactRefs.refFor(artifact.artifactId, iso()),
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256
    }))
    const summary = remoteEventLine(
      deliverable.summary,
      DOT_REMOTE_DELIVERABLE_SUMMARY_MAX_CHARS,
      DOT_REMOTE_DELIVERABLE_FALLBACK
    )
    return [{ facet: 'deliverable', kind: 'deliverable_summary', data: { summary, artifacts } }]
  }

  function facetsOf(snapshot: DotRemoteRequestSnapshot): Facet[] {
    const prompts = snapshot.prompts.map((prompt): Facet => ({
      facet: `prompt:${prompt.decisionId}`,
      kind: prompt.status === 'pending' ? 'permission_prompt_opened' : 'permission_prompt_closed',
      data: prompt
    }))
    const messages = snapshot.messages.map((message): Facet => messageFacet(message))
    const validations = snapshot.validations.map((validation): Facet => ({
      facet: `validation:${validation.validationId}`,
      kind: 'validation_result',
      data: {
        verdict: validation.verdict,
        line: remoteEventLine(
          validation.line,
          DOT_REMOTE_VALIDATION_LINE_MAX_CHARS,
          DOT_REMOTE_VALIDATION_FALLBACKS[validation.verdict]
        )
      }
    }))
    const status: Facet = { facet: 'status', kind: 'request_status', data: snapshot.status }
    const decisions = snapshot.validationDecisions.map(validationDecisionFacet)
    return [
      status,
      ...prompts,
      ...messages,
      ...validations,
      ...deliverableFacet(snapshot),
      ...decisions
    ]
  }

  function messageFacet(message: DotRemoteMessageOutcome): Facet {
    const { messageId, outcome, reason } = message
    return {
      facet: `${MESSAGE_FACET}${messageId}`,
      kind: 'message_outcome',
      data: { messageId, outcome, reason }
    }
  }

  /** `complete` is false when a facet failed for a reason other than its data, so it is tried again. */
  function record(
    dotRequestId: string,
    facets: readonly Facet[]
  ): { recorded: number; complete: boolean } {
    let recorded = 0
    let complete = true
    for (const facet of facets) {
      try {
        const at = iso()
        const event = outbox.enqueue({
          dotRequestId,
          facet: facet.facet,
          signature: signatureOf(facet),
          timestamp: at,
          build: (sourceRevision) => ({
            eventId: deps.newEventId(),
            kind: facet.kind,
            dotRequestId,
            sourceRevision,
            at,
            data: facet.data
          })
        })
        recorded += event ? 1 : 0
      } catch (error) {
        if (isDotRemoteDataRefusal(error)) {
          // Why only the kind: the refused data may hold text that must not reach a log.
          deps.log({ event: 'dot_remote_event_refused', code: facet.kind, dotRequestId })
        } else {
          complete = false
          const code = dotRemoteErrorCode(error)
          deps.log({ event: 'dot_remote_event_unrecorded', code, dotRequestId })
        }
      }
    }
    return { recorded, complete }
  }

  function read(dotRequestId: string): DotRemoteRequestSnapshot | null {
    try {
      const messageIds = requests
        .facetKeys(dotRequestId, MESSAGE_FACET)
        .map((facet) => facet.slice(MESSAGE_FACET.length))
      const validationIds = requests
        .facetKeys(dotRequestId, VALIDATION_DECISION_FACET)
        .map((facet) => facet.slice(VALIDATION_DECISION_FACET.length))
      return deps.source.snapshot(dotRequestId, { messageIds, validationIds })
    } catch {
      deps.log({ event: 'dot_remote_snapshot_failed', dotRequestId })
      return null
    }
  }

  /** Records what changed on every followed request; busy when any of them needs the active cadence. */
  function run(): { busy: boolean; recorded: number } {
    let busy = false
    let recorded = 0
    const followed = requests.listOpen(OPEN_REQUESTS_PER_SYNC)
    try {
      deps.source.beginSync?.(followed.map((request) => request.dotRequestId))
    } catch {
      deps.log({ event: 'dot_remote_snapshot_failed' })
    }
    for (const request of followed) {
      const snapshot = read(request.dotRequestId)
      if (!snapshot) {
        continue
      }
      const facets = record(request.dotRequestId, facetsOf(snapshot))
      recorded += facets.recorded
      busy = busy || isBusy(snapshot)
      // Why only when complete: a closed request is never read again, so its last facts would be lost.
      if (facets.complete && isFinished(snapshot)) {
        requests.close(request.dotRequestId, iso())
      }
    }
    return { busy, recorded }
  }

  /** The first outcome of a message, from its dispatch, before the run's message store says more. */
  function noteMessageOutcome(dotRequestId: string, outcome: DotRemoteMessageOutcome): void {
    if (requests.get(dotRequestId)) {
      record(dotRequestId, [messageFacet(outcome)])
    }
  }

  return { run, noteMessageOutcome }
}

export type DotRemoteEventSync = ReturnType<typeof createDotRemoteEventSync>
