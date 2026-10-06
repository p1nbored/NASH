// FIXTURE_ONLY: refusals the hosted mailbox must produce: conflicts, expiry, identity, revocation
// and the remote access cap. RG7 permission answers are in dot-remote-vectors-rg7.
import { dotRemoteSiteRefusal } from './dot-remote-errors'
import {
  LEASED_SUBMIT_1,
  QUEUED_1,
  SUBMIT_1,
  acceptedSubmit,
  admittedSubmitSteps
} from './dot-remote-vector-flows.test-fixture'
import {
  OTHER_DEVICE,
  OTHER_OWNER,
  TTL_SECONDS,
  ackStep,
  at,
  dot,
  fail,
  itemId,
  leaseStep,
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
const EXPIRED_AT_TTL = { ...QUEUED_1, state: 'expired', updatedAt: at(TTL_SECONDS) }
const SUBMIT_2 = payloadOf('submit', submitArgs(2))
const QUEUED_2 = receipt({
  item: 2,
  kind: 'submit',
  state: 'queued',
  created: 3,
  updated: 3,
  payload: SUBMIT_2
})

export const DOT_REMOTE_ERROR_VECTORS: DotRemoteVector[] = [
  makeVector(
    'error.same_key_different_payload',
    'same key with a different payload',
    'The same idempotencyKey with other content is refused with idempotency_conflict. Stating the default requestedAccess explicitly is the same stored payload, so it returns the original receipt.',
    { items: 1, nonces: 0 },
    [
      dot(0, 'nash_submit_task', SUBMIT, ok({ receipt: QUEUED_1 })),
      dot(
        5,
        'nash_submit_task',
        { ...SUBMIT, objective: 'Delete the "docs" folder.' },
        fail('idempotency_conflict')
      ),
      dot(
        6,
        'nash_submit_task',
        { ...SUBMIT, requestedAccess: 'read_only' },
        ok({ receipt: QUEUED_1 })
      )
    ]
  ),
  makeVector(
    'error.expired_never_delivered',
    'expired item',
    'A submit not leased before its expiresAt expires, is never leased, and a retry with the same key returns the expired receipt instead of starting late.',
    { items: 1, nonces: 0 },
    [
      dot(0, 'nash_submit_task', SUBMIT, ok({ receipt: QUEUED_1 })),
      leaseStep(TTL_SECONDS + 1, []),
      dot(
        TTL_SECONDS + 2,
        'nash_get_receipt',
        { itemId: itemId(1) },
        ok({ receipt: EXPIRED_AT_TTL })
      ),
      dot(TTL_SECONDS + 3, 'nash_submit_task', SUBMIT, ok({ receipt: EXPIRED_AT_TTL }))
    ]
  ),
  makeVector(
    'error.expired_acked_by_nash',
    'expired item acknowledged by NASH',
    'NASH leased the item just before expiresAt, saw it expired when it came to process it, and acknowledged it as expired without acting on it.',
    { items: 1, nonces: 1 },
    [
      dot(0, 'nash_submit_task', SUBMIT, ok({ receipt: QUEUED_1 })),
      leaseStep(TTL_SECONDS - 10, [LEASED_SUBMIT_1(TTL_SECONDS - 10)]),
      ackStep(TTL_SECONDS + 5, 1, 1, SUBMIT_1, { outcome: 'expired' }, 'expired'),
      dot(
        TTL_SECONDS + 6,
        'nash_get_receipt',
        { itemId: itemId(1) },
        ok({ receipt: { ...QUEUED_1, state: 'expired', updatedAt: at(TTL_SECONDS + 5) } })
      )
    ]
  ),
  makeVector(
    'error.wrong_owner',
    'wrong owner',
    'A caller whose platform identity is not the binding owner can neither read nor write; the owner still sees the item unchanged.',
    { items: 1, nonces: 0 },
    [
      dot(0, 'nash_submit_task', SUBMIT, ok({ receipt: QUEUED_1 })),
      dot(1, 'nash_get_receipt', { itemId: itemId(1) }, fail('unauthorized'), OTHER_OWNER),
      dot(2, 'nash_submit_task', submitArgs(2), fail('unauthorized'), OTHER_OWNER),
      dot(3, 'nash_get_receipt', { itemId: itemId(1) }, ok({ receipt: QUEUED_1 }))
    ]
  ),
  makeVector(
    'error.wrong_device',
    'wrong device',
    'A session of another device cannot lease or acknowledge items of this binding; the paired device still can.',
    { items: 1, nonces: 1 },
    [
      dot(0, 'nash_submit_task', SUBMIT, ok({ receipt: QUEUED_1 })),
      leaseStep(1, [LEASED_SUBMIT_1(1)]),
      {
        ...ackStep(
          2,
          1,
          1,
          SUBMIT_1,
          { outcome: 'accepted', dotRequestId: requestId(1) },
          'accepted'
        ),
        caller: { deviceId: OTHER_DEVICE, generation: 1 },
        expect: fail('unauthorized')
      },
      nash(3, 'inbox.lease', { generation: 1, maxItems: 10 }, fail('unauthorized'), {
        deviceId: OTHER_DEVICE
      }),
      ackStep(4, 1, 1, SUBMIT_1, { outcome: 'accepted', dotRequestId: requestId(1) }, 'accepted')
    ]
  ),
  makeVector(
    'error.revoked_generation',
    'revoked generation',
    'Revocation refuses the waiting item with pairing_revoked and every later call with the old generation; the accepted request keeps its state and writes answer nash_never_paired.',
    { items: 2, nonces: 1 },
    [
      ...admittedSubmitSteps(),
      dot(3, 'nash_submit_task', submitArgs(2), ok({ receipt: QUEUED_2 })),
      nash(4, 'pairing.revoke', { generation: 1 }, ok({ revokedGeneration: 1 })),
      nash(5, 'inbox.lease', { generation: 1, maxItems: 10 }, fail('generation_revoked')),
      nash(
        6,
        'events.post',
        { generation: 1, events: [statusEvent(1, 1, 3, 'active')] },
        fail('generation_revoked')
      ),
      dot(
        7,
        'nash_get_receipt',
        { itemId: itemId(2) },
        ok({
          receipt: {
            ...QUEUED_2,
            state: 'refused',
            updatedAt: at(4),
            refusal: dotRemoteSiteRefusal('pairing_revoked')
          }
        })
      ),
      dot(8, 'nash_get_receipt', { itemId: itemId(1) }, ok({ receipt: acceptedSubmit(2) })),
      dot(9, 'nash_submit_task', submitArgs(3), fail('nash_never_paired'))
    ]
  ),
  makeVector(
    'error.remote_access_cap',
    'remote access cap and injected contract version',
    'A remote submission may not ask for workspace_write, and a tool input never carries contractVersion; both fail the input schema with payload_invalid and store nothing.',
    { items: 0, nonces: 0 },
    [
      dot(
        0,
        'nash_submit_task',
        { ...SUBMIT, requestedAccess: 'workspace_write' },
        fail('payload_invalid')
      ),
      dot(1, 'nash_submit_task', { ...SUBMIT, contractVersion: 2 }, fail('payload_invalid'))
    ]
  )
]
