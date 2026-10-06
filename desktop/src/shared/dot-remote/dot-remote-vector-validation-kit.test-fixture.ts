// FIXTURE_ONLY: synthetic validation decisions (G7) and the steps their conformance vectors share.
import {
  admittedSubmitSteps,
  controlFlow,
  eventsStep
} from './dot-remote-vector-flows.test-fixture'
import {
  ackStep,
  at,
  decisionId,
  event,
  leased,
  ok,
  payloadOf,
  receipt,
  requestId
} from './dot-remote-vector-kit.test-fixture'

export const validationId = (n: number) =>
  `validation_70000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const SUMMARIZED = {
  validationId: validationId(1),
  dotRequestId: requestId(1),
  title: 'List the open issues in the "docs" folder and summarize each in one sentence.',
  reason: 'primary_did_task',
  summary: 'Listed four open issues with one sentence each; secrets were masked as [secret].',
  summaryWithheld: false,
  createdAt: at(3)
}
export const WITHHELD = {
  validationId: validationId(2),
  dotRequestId: requestId(1),
  title: 'Check which pages in the [path] folder have broken links.',
  reason: 'review_unavailable',
  summary: null,
  summaryWithheld: true,
  createdAt: at(4)
}

export const VALIDATION_DECIDE_ARGS = {
  decisionId: decisionId(11),
  validationId: validationId(1),
  decision: 'waive'
}
export const REJECT_ARGS = {
  ...VALIDATION_DECIDE_ARGS,
  decisionId: decisionId(12),
  decision: 'reject'
}
export const DECIDE_PAYLOAD = payloadOf('validation_decision', VALIDATION_DECIDE_ARGS)
export const REJECT_PAYLOAD = payloadOf('validation_decision', REJECT_ARGS)
/** Item 2 decides validation 1: queued at 10 s, leased at 11 s and accepted at 12 s. */
export const DECIDE = controlFlow('validation_decision', DECIDE_PAYLOAD)
export const NONE_OPEN = ok({ validations: [], nextCursor: null })

export const pending = (n: number, revision: number, view: Record<string, unknown>) =>
  event(n, 'validation_decision_pending', revision, 5, view)
export const settled = (n: number, revision: number, seconds: number, outcome: string) =>
  event(n, 'validation_decision_settled', revision, seconds, {
    validationId: validationId(1),
    outcome,
    decidedAt: at(seconds)
  })

/** Request 1 is accepted and NASH reports validation 1 as waiting. */
export const OPENED = [...admittedSubmitSteps(), eventsStep(6, [pending(1, 1, SUMMARIZED)], 1)]

export function decisionReceipt(
  item: number,
  payload: Record<string, unknown>,
  state: string,
  updated: number
) {
  return receipt({
    item,
    kind: 'validation_decision',
    state,
    created: 10,
    updated,
    payload,
    dependsOn: 1,
    request: 1,
    ...(state === 'accepted' ? { extra: { duplicate: false } } : {})
  })
}

/** A decide item created at 10 s and leased at 11 s with the nonce of its item number. */
export function leasedDecision(item: number, payload: Record<string, unknown>) {
  const kind = 'validation_decision'
  return leased({ item, kind, payload, created: 10, leased: 11, nonce: item, dependsOn: 1 })
}

export function acceptedAck(seconds: number, item: number, payload: Record<string, unknown>) {
  const outcome = { outcome: 'accepted', dotRequestId: requestId(1) }
  return ackStep(seconds, item, item, payload, outcome, 'accepted')
}
