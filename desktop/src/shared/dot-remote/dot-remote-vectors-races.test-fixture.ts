// FIXTURE_ONLY: replay, ordering and queued-cancel races the hosted mailbox must resolve (RG5, RG6).
import { dotRemoteNashRefusal, dotRemoteSiteRefusal } from './dot-remote-errors'
import {
  LEASED_SUBMIT_1,
  QUEUED_1,
  SUBMIT_1,
  acceptedSubmit,
  admittedSubmitSteps
} from './dot-remote-vector-flows.test-fixture'
import {
  ackStep,
  at,
  decisionView,
  dot,
  event,
  eventId,
  itemId,
  leaseStep,
  leased,
  makeVector,
  nash,
  ok,
  payloadOf,
  receipt,
  requestId,
  statusEvent,
  submitArgs,
  type DotRemoteVector
} from './dot-remote-vector-kit.test-fixture'

const SUBMIT = submitArgs(1)
const CLAIMED_1 = (updated: number) => ({ ...QUEUED_1, state: 'claimed', updatedAt: at(updated) })
const CANCELED_1 = { ...QUEUED_1, state: 'canceled_before_claim', updatedAt: at(5) }
const CANCEL_PAYLOAD = payloadOf('cancel', { dotRequestId: requestId(1) })
const CANCEL_WAITING = receipt({
  item: 2,
  kind: 'cancel',
  state: 'queued',
  created: 2,
  updated: 2,
  payload: null,
  dependsOn: 1
})
const RATE_LIMITED = dotRemoteNashRefusal('dot_rate_limited')
const REFUSED_1 = { ...QUEUED_1, state: 'refused', updatedAt: at(3), refusal: RATE_LIMITED }
const CANCEL_REFUSED = {
  ...CANCEL_WAITING,
  state: 'refused',
  updatedAt: at(3),
  refusal: dotRemoteSiteRefusal('cancel_target_not_admitted')
}

const OPENED = event(
  2,
  'permission_prompt_opened',
  2,
  4,
  decisionView('Read', 'Read: docs/README.md', 4, true)
)
const CLOSED = event(
  4,
  'permission_prompt_closed',
  4,
  8,
  decisionView('Read', 'Read: docs/README.md', 4, true, {
    status: 'answered_in_terminal',
    by: 'terminal',
    at: 8
  })
)
const ACTIVE = statusEvent(3, 3, 5, 'active')

export const DOT_REMOTE_RACE_VECTORS: DotRemoteVector[] = [
  makeVector(
    'race.repeated_call_same_payload',
    'repeated MCP call with the same key and payload',
    'A retried submission with the same idempotencyKey and payload returns the original receipt in its current state and creates no second item.',
    { items: 1, nonces: 1 },
    [
      dot(0, 'nash_submit_task', SUBMIT, ok({ receipt: QUEUED_1 })),
      dot(5, 'nash_submit_task', SUBMIT, ok({ receipt: QUEUED_1 })),
      leaseStep(6, [LEASED_SUBMIT_1(6)]),
      dot(7, 'nash_submit_task', SUBMIT, ok({ receipt: CLAIMED_1(6) }))
    ]
  ),
  makeVector(
    'race.duplicate_and_late_events',
    'duplicate or late event',
    'A repeated eventId with the same content is a duplicate and with other content a conflict; an event at or below the applied revision is stale, so a closed prompt never reopens.',
    { items: 1, nonces: 1 },
    [
      ...admittedSubmitSteps(),
      nash(
        10,
        'events.post',
        { generation: 1, events: [statusEvent(1, 1, 3, 'launching'), OPENED, ACTIVE, CLOSED] },
        ok({
          results: [1, 2, 3, 4].map((n) => ({ eventId: eventId(n), status: 'applied' })),
          cursors: [{ dotRequestId: requestId(1), appliedRevision: 4 }]
        })
      ),
      nash(
        20,
        'events.post',
        {
          generation: 1,
          events: [
            ACTIVE,
            OPENED,
            statusEvent(5, 2, 3, 'launching'),
            { ...OPENED, eventId: eventId(6), sourceRevision: 3 },
            statusEvent(3, 3, 9, 'completed')
          ]
        },
        ok({
          results: [
            { eventId: eventId(3), status: 'duplicate' },
            { eventId: eventId(2), status: 'duplicate' },
            { eventId: eventId(5), status: 'stale' },
            { eventId: eventId(6), status: 'stale' },
            { eventId: eventId(3), status: 'conflict' }
          ],
          cursors: [{ dotRequestId: requestId(1), appliedRevision: 4 }]
        })
      ),
      dot(
        21,
        'nash_get_request',
        { dotRequestId: requestId(1) },
        ok({
          request: {
            dotRequestId: requestId(1),
            submitItemId: itemId(1),
            workspaceRef: SUBMIT_1.workspaceRef,
            requestedAccess: 'read_only',
            appliedRevision: 4,
            status: ACTIVE,
            prompts: [CLOSED],
            messageOutcomes: [],
            validationResults: [],
            deliverable: null,
            validationDecisions: []
          }
        })
      )
    ]
  ),
  makeVector(
    'race.cancel_before_claim',
    'queued cancel before claim',
    'A cancel for a submit NASH has not leased cancels it on the Site in one transaction; nothing reaches NASH, and a repeated cancel returns the same answer.',
    { items: 1, nonces: 0 },
    [
      dot(0, 'nash_submit_task', SUBMIT, ok({ receipt: QUEUED_1 })),
      dot(
        5,
        'nash_cancel_request',
        { submitItemId: itemId(1) },
        ok({ outcome: 'canceled_before_claim', target: CANCELED_1, cancel: null })
      ),
      leaseStep(6, []),
      dot(
        7,
        'nash_cancel_request',
        { submitItemId: itemId(1) },
        ok({ outcome: 'canceled_before_claim', target: CANCELED_1, cancel: null })
      )
    ]
  ),
  makeVector(
    'race.cancel_after_claim',
    'queued cancel after claim',
    'A cancel for a leased submit waits without payload until NASH accepts the submit, then is leased with the dotRequestId from that ack.',
    { items: 2, nonces: 2 },
    [
      dot(0, 'nash_submit_task', SUBMIT, ok({ receipt: QUEUED_1 })),
      leaseStep(1, [LEASED_SUBMIT_1(1)]),
      dot(
        2,
        'nash_cancel_request',
        { submitItemId: itemId(1) },
        ok({ outcome: 'forwarded', target: CLAIMED_1(1), cancel: CANCEL_WAITING })
      ),
      leaseStep(3, []),
      ackStep(4, 1, 1, SUBMIT_1, { outcome: 'accepted', dotRequestId: requestId(1) }, 'accepted'),
      leaseStep(5, [
        leased({
          item: 2,
          kind: 'cancel',
          payload: CANCEL_PAYLOAD,
          created: 2,
          leased: 5,
          nonce: 2,
          dependsOn: 1
        })
      ]),
      ackStep(
        6,
        2,
        2,
        CANCEL_PAYLOAD,
        { outcome: 'accepted', dotRequestId: requestId(1) },
        'accepted'
      ),
      dot(
        7,
        'nash_get_receipt',
        { itemId: itemId(2) },
        ok({
          receipt: receipt({
            item: 2,
            kind: 'cancel',
            state: 'accepted',
            created: 2,
            updated: 6,
            payload: CANCEL_PAYLOAD,
            dependsOn: 1,
            request: 1,
            extra: { duplicate: false }
          })
        })
      ),
      dot(8, 'nash_get_receipt', { itemId: itemId(1) }, ok({ receipt: acceptedSubmit(4) }))
    ]
  ),
  makeVector(
    'race.cancel_after_claim_target_refused',
    'queued cancel after claim, submit refused',
    'When NASH refuses the leased submit, the waiting cancel is refused by the Site with cancel_target_not_admitted, and a repeated cancel returns that state.',
    { items: 2, nonces: 1 },
    [
      dot(0, 'nash_submit_task', SUBMIT, ok({ receipt: QUEUED_1 })),
      leaseStep(1, [LEASED_SUBMIT_1(1)]),
      dot(
        2,
        'nash_cancel_request',
        { submitItemId: itemId(1) },
        ok({ outcome: 'forwarded', target: CLAIMED_1(1), cancel: CANCEL_WAITING })
      ),
      ackStep(
        3,
        1,
        1,
        SUBMIT_1,
        { outcome: 'refused', dotRequestId: null, refusal: RATE_LIMITED },
        'refused'
      ),
      dot(4, 'nash_get_receipt', { itemId: itemId(2) }, ok({ receipt: CANCEL_REFUSED })),
      dot(5, 'nash_get_receipt', { itemId: itemId(1) }, ok({ receipt: REFUSED_1 })),
      dot(
        6,
        'nash_cancel_request',
        { submitItemId: itemId(1) },
        ok({ outcome: 'forwarded', target: REFUSED_1, cancel: CANCEL_REFUSED })
      )
    ]
  )
]
