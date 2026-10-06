// FIXTURE_ONLY: step sequences and expected bodies several conformance vectors share.
import {
  ackStep,
  decisionView,
  dot,
  event,
  itemId,
  leaseStep,
  leased,
  nash,
  ok,
  payloadOf,
  receipt,
  requestId,
  submitArgs,
  WORKSPACE,
  type DotRemoteVectorStep
} from './dot-remote-vector-kit.test-fixture'

export const SUBMIT_1 = payloadOf('submit', submitArgs(1))

export const QUEUED_1 = receipt({
  item: 1,
  kind: 'submit',
  state: 'queued',
  created: 0,
  updated: 0,
  payload: SUBMIT_1
})

export function acceptedSubmit(updated: number): Record<string, unknown> {
  return receipt({
    item: 1,
    kind: 'submit',
    state: 'accepted',
    created: 0,
    updated,
    payload: SUBMIT_1,
    request: 1,
    extra: { duplicate: false }
  })
}

export const LEASED_SUBMIT_1 = (leasedAt: number) =>
  leased({ item: 1, kind: 'submit', payload: SUBMIT_1, created: 0, leased: leasedAt, nonce: 1 })

/** dot submits task 1 at 0 s, NASH leases it at 1 s and accepts it as request 1 at 2 s. */
export function admittedSubmitSteps(): DotRemoteVectorStep[] {
  return [
    dot(0, 'nash_submit_task', submitArgs(1), ok({ receipt: QUEUED_1 })),
    leaseStep(1, [LEASED_SUBMIT_1(1)]),
    ackStep(2, 1, 1, SUBMIT_1, { outcome: 'accepted', dotRequestId: requestId(1) }, 'accepted')
  ]
}

/** NASH posts events of request 1 that all apply; the cursor names the highest revision. */
export function eventsStep(
  seconds: number,
  events: Record<string, unknown>[],
  revision: number
): DotRemoteVectorStep {
  const results = events.map((entry) => ({ eventId: entry.eventId, status: 'applied' }))
  return nash(
    seconds,
    'events.post',
    { generation: 1, events },
    ok({ results, cursors: [{ dotRequestId: requestId(1), appliedRevision: revision }] })
  )
}

/** A Bash prompt of request 1, opened at 4 s, as NASH reported it to the Site. */
export const bashOpened = (dotMayAllow: boolean) =>
  event(
    1,
    'permission_prompt_opened',
    1,
    4,
    decisionView('Bash', 'Bash: git status', 4, dotMayAllow)
  )

/** Item 2 for request 1, created at 10 s, then leased at 11 s and accepted at 12 s. */
export function controlFlow(
  kind: 'cancel' | 'permission_answer' | 'message' | 'validation_decision',
  payload: Record<string, unknown>,
  expires?: number
) {
  const queued = receipt({
    item: 2,
    kind,
    state: 'queued',
    created: 10,
    updated: 10,
    payload,
    dependsOn: 1,
    request: 1,
    expires
  })
  return {
    queued,
    steps: [
      leaseStep(11, [
        leased({ item: 2, kind, payload, created: 10, leased: 11, nonce: 2, dependsOn: 1, expires })
      ]),
      ackStep(12, 2, 2, payload, { outcome: 'accepted', dotRequestId: requestId(1) }, 'accepted')
    ]
  }
}

/** The nash_get_request body for request 1 with the given applied revision and folded events. */
export function projection(revision: number, extra: Record<string, unknown>) {
  return {
    request: {
      dotRequestId: requestId(1),
      submitItemId: itemId(1),
      workspaceRef: WORKSPACE,
      requestedAccess: 'read_only',
      appliedRevision: revision,
      status: null,
      prompts: [],
      messageOutcomes: [],
      validationResults: [],
      deliverable: null,
      validationDecisions: [],
      ...extra
    }
  }
}
