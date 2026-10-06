// FIXTURE_ONLY: one accepted conformance vector per write tool; writes go to the inbox.
import {
  acceptedSubmit,
  admittedSubmitSteps,
  bashOpened,
  controlFlow,
  eventsStep
} from './dot-remote-vector-flows.test-fixture'
import {
  decisionId,
  decisionView,
  dot,
  event,
  itemId,
  makeVector,
  messageId,
  ok,
  payloadOf,
  requestId,
  statusEvent,
  type DotRemoteVector,
  type DotRemoteVectorStep
} from './dot-remote-vector-kit.test-fixture'

function vector(
  tool: string,
  description: string,
  generated: { items: number; nonces: number },
  steps: DotRemoteVectorStep[]
): DotRemoteVector {
  return makeVector(`accepted.${tool}`, tool, description, generated, steps)
}

const TWO = { items: 2, nonces: 2 }
const CANCEL = controlFlow('cancel', payloadOf('cancel', { dotRequestId: requestId(1) }))
const ANSWER = controlFlow(
  'permission_answer',
  payloadOf('permission_answer', { decisionId: decisionId(1), decision: 'deny' }),
  244
)
const MESSAGE_ARGS = {
  dotRequestId: requestId(1),
  messageId: messageId(1),
  text: 'Also list the files you read.'
}
const MESSAGE = controlFlow('message', payloadOf('message', MESSAGE_ARGS))
const DENIED = event(
  2,
  'permission_prompt_closed',
  2,
  12,
  decisionView('Bash', 'Bash: git status', 4, false, { status: 'denied', by: 'dot', at: 12 })
)
const DELIVERED = event(1, 'message_outcome', 1, 12, {
  messageId: messageId(1),
  outcome: 'delivered',
  reason: null
})

export const DOT_REMOTE_WRITE_TOOL_VECTORS: DotRemoteVector[] = [
  vector(
    'nash_submit_task',
    'A submission returns a queued receipt at once; NASH leases the item with the stored payload and accepts it.',
    { items: 1, nonces: 1 },
    admittedSubmitSteps()
  ),
  vector(
    'nash_cancel_request',
    'A cancel for an accepted task becomes a cancel item with the dotRequestId from the admission mapping.',
    TWO,
    [
      ...admittedSubmitSteps(),
      dot(
        10,
        'nash_cancel_request',
        { submitItemId: itemId(1) },
        ok({ outcome: 'forwarded', target: acceptedSubmit(2), cancel: CANCEL.queued })
      ),
      ...CANCEL.steps,
      eventsStep(13, [statusEvent(1, 1, 12, null)], 1)
    ]
  ),
  vector(
    'nash_answer_permission_prompt',
    'dot denies an open prompt; the answer item expires no later than the prompt deadline.',
    TWO,
    [
      ...admittedSubmitSteps(),
      eventsStep(5, [bashOpened(false)], 1),
      dot(
        10,
        'nash_answer_permission_prompt',
        { decisionId: decisionId(1), decision: 'deny' },
        ok({ receipt: ANSWER.queued })
      ),
      ...ANSWER.steps,
      eventsStep(13, [DENIED], 2)
    ]
  ),
  vector(
    'nash_send_message_to_run',
    'A follow-up message is queued for NASH and its delivery outcome comes back as an event.',
    TWO,
    [
      ...admittedSubmitSteps(),
      dot(10, 'nash_send_message_to_run', MESSAGE_ARGS, ok({ receipt: MESSAGE.queued })),
      ...MESSAGE.steps,
      eventsStep(13, [DELIVERED], 1)
    ]
  )
]
