// FIXTURE_ONLY: RG7 permission answers: dot may deny any prompt it sees, but may allow a command or
// edit prompt only where NASH says so; NASH checks again and stays the authority.
import { dotRemoteNashRefusal } from './dot-remote-errors'
import { admittedSubmitSteps, bashOpened, eventsStep } from './dot-remote-vector-flows.test-fixture'
import {
  ackStep,
  decisionId,
  dot,
  fail,
  itemId,
  leaseStep,
  leased,
  makeVector,
  ok,
  payloadOf,
  receipt,
  requestId,
  type DotRemoteVector,
  type DotRemoteVectorExpect
} from './dot-remote-vector-kit.test-fixture'

const ALLOW = payloadOf('permission_answer', { decisionId: decisionId(1), decision: 'allow' })
const DENY = payloadOf('permission_answer', { decisionId: decisionId(1), decision: 'deny' })
const DENY_ONLY = dotRemoteNashRefusal('dot_decision_deny_only')
const TWO = { items: 2, nonces: 2 }

const answerReceipt = (
  payload: Record<string, unknown>,
  state: string,
  times: { created: number; updated: number },
  extra = {}
) =>
  receipt({
    item: 2,
    kind: 'permission_answer',
    state,
    ...times,
    payload,
    dependsOn: 1,
    request: 1,
    expires: 244,
    extra
  })

const answer = (seconds: number, decision: string, expect: DotRemoteVectorExpect) =>
  dot(seconds, 'nash_answer_permission_prompt', { decisionId: decisionId(1), decision }, expect)

export const DOT_REMOTE_RG7_VECTORS: DotRemoteVector[] = [
  makeVector(
    'error.allow_on_read_only_run',
    'dot allow on a read-only run (RG7)',
    'NASH reported the Bash prompt of a read-only run with dotMayAllow false, so the Site refuses allow and stores nothing; deny is still accepted.',
    TWO,
    [
      ...admittedSubmitSteps(),
      eventsStep(5, [bashOpened(false)], 1),
      answer(10, 'allow', fail('decision_allow_not_permitted')),
      answer(
        11,
        'deny',
        ok({ receipt: answerReceipt(DENY, 'queued', { created: 11, updated: 11 }) })
      )
    ]
  ),
  makeVector(
    'error.allow_refused_by_nash',
    'dot allow refused by NASH (RG7)',
    'Defense in depth: the Site copy of the prompt allowed it, but NASH checks RG7 again and refuses with dot_decision_deny_only; the Site records the refusal of NASH and never overrides it.',
    TWO,
    [
      ...admittedSubmitSteps(),
      eventsStep(5, [bashOpened(true)], 1),
      answer(
        10,
        'allow',
        ok({ receipt: answerReceipt(ALLOW, 'queued', { created: 10, updated: 10 }) })
      ),
      leaseStep(11, [
        leased({
          item: 2,
          kind: 'permission_answer',
          payload: ALLOW,
          created: 10,
          leased: 11,
          nonce: 2,
          dependsOn: 1,
          expires: 244
        })
      ]),
      ackStep(
        12,
        2,
        2,
        ALLOW,
        { outcome: 'refused', dotRequestId: requestId(1), refusal: DENY_ONLY },
        'refused'
      ),
      dot(
        13,
        'nash_get_receipt',
        { itemId: itemId(2) },
        ok({
          receipt: answerReceipt(
            ALLOW,
            'refused',
            { created: 10, updated: 12 },
            { refusal: DENY_ONLY }
          )
        })
      )
    ]
  )
]
