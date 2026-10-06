// FIXTURE_ONLY: validation decision vectors (G7): listing, deciding, replays, races and refusals.
import { dotRemoteNashRefusal } from './dot-remote-errors'
import {
  DECIDE,
  DECIDE_PAYLOAD,
  NONE_OPEN,
  OPENED,
  REJECT_ARGS,
  REJECT_PAYLOAD,
  SUMMARIZED,
  VALIDATION_DECIDE_ARGS,
  WITHHELD,
  acceptedAck,
  decisionReceipt,
  leasedDecision,
  pending,
  settled
} from './dot-remote-vector-validation-kit.test-fixture'
import { admittedSubmitSteps, eventsStep, projection } from './dot-remote-vector-flows.test-fixture'
import {
  OTHER_OWNER,
  ackStep,
  dot,
  fail,
  itemId,
  leaseStep,
  makeVector,
  ok,
  requestId,
  type DotRemoteVector
} from './dot-remote-vector-kit.test-fixture'

export { VALIDATION_DECIDE_ARGS } from './dot-remote-vector-validation-kit.test-fixture'

/** The race and error cases of validation decisions the hosted side must pass. */
export const DOT_REMOTE_VALIDATION_CASES = [
  'race.validation_decided_on_desktop',
  'race.validation_second_decision_id',
  'race.validation_decision_replay',
  'error.validation_decision_not_found',
  'error.validation_decision_wrong_owner',
  'error.validation_decision_input'
] as const

const ONE = { items: 1, nonces: 1 }
const TWO = { items: 2, nonces: 2 }
const DECIDE_TOOL = 'nash_decide_validation'
const LIST_TOOL = 'nash_list_validation_decisions'
const queuedDecision = (seconds: number) =>
  dot(seconds, DECIDE_TOOL, VALIDATION_DECIDE_ARGS, ok({ receipt: DECIDE.queued }))
const NOT_FOUND = dotRemoteNashRefusal('dot_validation_not_found')

export const DOT_REMOTE_VALIDATION_VECTORS: DotRemoteVector[] = [
  makeVector(
    'accepted.nash_list_validation_decisions',
    LIST_TOOL,
    'dot lists the open validation decisions NASH reported, oldest first by createdAt, with exactly the reported fields; a withheld summary stays null.',
    ONE,
    [
      ...admittedSubmitSteps(),
      eventsStep(6, [pending(1, 1, WITHHELD), pending(2, 2, SUMMARIZED)], 2),
      dot(7, LIST_TOOL, {}, ok({ validations: [SUMMARIZED, WITHHELD], nextCursor: null })),
      dot(8, LIST_TOOL, { dotRequestId: requestId(2) }, NONE_OPEN)
    ]
  ),
  makeVector(
    'accepted.nash_decide_validation',
    DECIDE_TOOL,
    'dot waives an open decision: the item depends on the accepted submit, NASH accepts it, and the settled event closes the decision.',
    TWO,
    [
      ...OPENED,
      queuedDecision(10),
      ...DECIDE.steps,
      eventsStep(13, [settled(2, 2, 12, 'waived')], 2),
      dot(14, LIST_TOOL, {}, NONE_OPEN)
    ]
  ),
  makeVector(
    'race.validation_decided_on_desktop',
    'decision already made in the app',
    'The app decided first: the settled event closes the decision, a new decisionId is refused with validation_decision_not_open and stores nothing, and nash_get_request shows how it ended.',
    ONE,
    [
      ...OPENED,
      eventsStep(8, [settled(2, 2, 7, 'rejected')], 2),
      dot(9, DECIDE_TOOL, VALIDATION_DECIDE_ARGS, fail('validation_decision_not_open')),
      dot(10, LIST_TOOL, {}, NONE_OPEN),
      dot(
        11,
        'nash_get_request',
        { dotRequestId: requestId(1) },
        ok(projection(2, { validationDecisions: [settled(2, 2, 7, 'rejected')] }))
      )
    ]
  ),
  makeVector(
    'race.validation_second_decision_id',
    'second decisionId for one decision',
    'Two decisionIds for one open decision both reach NASH. The first wins there; NASH acknowledges the second as accepted (already_decided), and the settled event names the winner.',
    { items: 3, nonces: 3 },
    [
      ...OPENED,
      queuedDecision(10),
      dot(
        10,
        DECIDE_TOOL,
        REJECT_ARGS,
        ok({ receipt: decisionReceipt(3, REJECT_PAYLOAD, 'queued', 10) })
      ),
      leaseStep(11, [leasedDecision(2, DECIDE_PAYLOAD), leasedDecision(3, REJECT_PAYLOAD)]),
      acceptedAck(12, 2, DECIDE_PAYLOAD),
      acceptedAck(13, 3, REJECT_PAYLOAD),
      eventsStep(14, [settled(2, 2, 12, 'waived')], 2),
      dot(
        15,
        'nash_get_receipt',
        { itemId: itemId(3) },
        ok({ receipt: decisionReceipt(3, REJECT_PAYLOAD, 'accepted', 13) })
      )
    ]
  ),
  makeVector(
    'race.validation_decision_replay',
    'repeated decide with the same decisionId',
    'The same decisionId with the same payload returns the original receipt, also after the decision closed; with another decision it is refused with idempotency_conflict.',
    TWO,
    [
      ...OPENED,
      queuedDecision(10),
      ...DECIDE.steps,
      eventsStep(13, [settled(2, 2, 12, 'waived')], 2),
      dot(
        14,
        DECIDE_TOOL,
        VALIDATION_DECIDE_ARGS,
        ok({ receipt: decisionReceipt(2, DECIDE_PAYLOAD, 'accepted', 12) })
      ),
      dot(
        15,
        DECIDE_TOOL,
        { ...VALIDATION_DECIDE_ARGS, decision: 'reject' },
        fail('idempotency_conflict')
      )
    ]
  ),
  makeVector(
    'error.validation_decision_not_found',
    'validation not found on NASH',
    'NASH no longer finds the validation for a run dot started and refuses the item; the receipt carries dot_validation_not_found with its fixed English message.',
    TWO,
    [
      ...OPENED,
      queuedDecision(10),
      leaseStep(11, [leasedDecision(2, DECIDE_PAYLOAD)]),
      ackStep(
        12,
        2,
        2,
        DECIDE_PAYLOAD,
        { outcome: 'refused', dotRequestId: requestId(1), refusal: NOT_FOUND },
        'refused'
      ),
      dot(
        13,
        'nash_get_receipt',
        { itemId: itemId(2) },
        ok({
          receipt: { ...decisionReceipt(2, DECIDE_PAYLOAD, 'refused', 12), refusal: NOT_FOUND }
        })
      )
    ]
  ),
  makeVector(
    'error.validation_decision_wrong_owner',
    'wrong owner',
    'Another platform user can neither list nor decide the validation decisions of this binding; the owner still sees the decision open.',
    ONE,
    [
      ...OPENED,
      dot(7, LIST_TOOL, {}, fail('unauthorized'), OTHER_OWNER),
      dot(8, DECIDE_TOOL, VALIDATION_DECIDE_ARGS, fail('unauthorized'), OTHER_OWNER),
      dot(9, LIST_TOOL, {}, ok({ validations: [SUMMARIZED], nextCursor: null }))
    ]
  ),
  makeVector(
    'error.validation_decision_input',
    'decision input checks',
    'A decision is only waive or reject, names no decider, and never carries contractVersion; each fails the input schema with payload_invalid and stores nothing.',
    { items: 0, nonces: 0 },
    [{ decision: 'allow' }, { by: 'desktop_user' }, { contractVersion: 3 }].map((change, index) =>
      dot(index, DECIDE_TOOL, { ...VALIDATION_DECIDE_ARGS, ...change }, fail('payload_invalid'))
    )
  )
]
