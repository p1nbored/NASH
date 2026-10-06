// FIXTURE_ONLY: pairing and device-credential refresh vectors. Every challenge, code, session token
// and device credential below is an obviously fake value the test harness injects as generated.
import { DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS } from './dot-remote-defaults'
import {
  DOT_REMOTE_CHALLENGE_TTL_MINUTES,
  DOT_REMOTE_SESSION_RENEW_AFTER_MINUTES,
  DOT_REMOTE_SESSION_TTL_MINUTES
} from './dot-remote-limits'
import {
  DEVICE,
  OWNER,
  at,
  dot,
  fail,
  makeVector,
  ok,
  submitArgs,
  type DotRemoteEndpointStep,
  type DotRemoteVector,
  type DotRemoteVectorExpect,
  type DotRemoteVectorStep
} from './dot-remote-vector-kit.test-fixture'

const SESSION_SECONDS = DOT_REMOTE_SESSION_TTL_MINUTES * 60
const RENEW_SECONDS = DOT_REMOTE_SESSION_RENEW_AFTER_MINUTES * 60
const ISSUED_AT = 15
const LIFETIME_END = ISSUED_AT + DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS * 86_400
const CHALLENGE_ID = '70000000-0000-4000-8000-000000000001'
const USER_CODE = 'BCDF-GHJK'
const DEVICE_CODE = `FIXTUREdeviceCode${'0'.repeat(26)}1`
const SERVICE = { serviceOnly: true } as const

const sessionToken = (n: number) => `FIXTUREsessionToken${String(n).padStart(25, '0')}`
const credential = (n: number) =>
  `ndc_${String(n).padStart(24, '0')}.FIXTUREdeviceCredentialSecret${String(n).padStart(20, '0')}`
const count = (n: number, make: (index: number) => string) =>
  Array.from({ length: n }, (_, index) => make(index + 1))

/** Session n, issued at the given time; no session outlives the pairing. */
function session(n: number, issuedAt: number) {
  const expires = Math.min(issuedAt + SESSION_SECONDS, LIFETIME_END)
  return {
    sessionToken: sessionToken(n),
    expiresAt: at(expires),
    renewAfter: at(Math.min(issuedAt + RENEW_SECONDS, expires)),
    deviceId: DEVICE,
    generation: 1
  }
}

const grant = (n: number) => ({ credential: credential(n), expiresAt: at(LIFETIME_END) })

function siteStep(
  seconds: number,
  endpoint: string,
  caller: DotRemoteEndpointStep['caller'],
  body: Record<string, unknown>,
  expect: DotRemoteVectorExpect
): DotRemoteEndpointStep {
  return { actor: 'nash', at: at(seconds), caller, endpoint, body, expect }
}

function ownerStep(
  seconds: number,
  endpoint: string,
  body: Record<string, unknown>,
  expect: DotRemoteVectorExpect
): DotRemoteEndpointStep {
  return { actor: 'owner', at: at(seconds), caller: { ownerId: OWNER }, endpoint, body, expect }
}

const ISSUE_BODY = { challengeId: CHALLENGE_ID, deviceCode: DEVICE_CODE }

/** Challenge at 0 s, a pending poll at 5 s, owner approval at 10 s, issue with credential 1 at 15 s. */
function pairedSteps(): DotRemoteVectorStep[] {
  const challenge = {
    challengeId: CHALLENGE_ID,
    userCode: USER_CODE,
    deviceCode: DEVICE_CODE,
    expiresAt: at(DOT_REMOTE_CHALLENGE_TTL_MINUTES * 60),
    pollIntervalSeconds: 5
  }
  return [
    siteStep(0, 'pairing.challenge.create', SERVICE, { appVersion: '1.4.0' }, ok(challenge)),
    siteStep(
      5,
      'pairing.session.issue',
      SERVICE,
      ISSUE_BODY,
      ok({ state: 'pending', pollIntervalSeconds: 5 })
    ),
    ownerStep(
      10,
      'pairing.approve',
      { userCode: USER_CODE, decision: 'approve' },
      ok({ outcome: 'approved' })
    ),
    siteStep(
      ISSUED_AT,
      'pairing.session.issue',
      SERVICE,
      ISSUE_BODY,
      ok({ state: 'issued', session: session(1, ISSUED_AT), deviceCredential: grant(1) })
    )
  ]
}

/** NASH presents credential `presented` in the Nash-Device-Credential header. */
const refresh = (seconds: number, presented: number, expect: DotRemoteVectorExpect) =>
  siteStep(
    seconds,
    'pairing.session.refresh',
    { deviceCredential: credential(presented) },
    { generation: 1 },
    expect
  )
const refreshed = (n: number, seconds: number) =>
  ok({ session: session(n, seconds), deviceCredential: grant(n) })

function pairingVector(
  id: string,
  covers: string,
  description: string,
  issued: number,
  steps: DotRemoteVectorStep[]
): DotRemoteVector {
  const vector = makeVector(id, covers, description, { items: 0, nonces: 0 }, [
    ...pairedSteps(),
    ...steps
  ])
  const pairing = {
    challengeIds: [CHALLENGE_ID],
    userCodes: [USER_CODE],
    deviceCodes: [DEVICE_CODE],
    deviceIds: [DEVICE],
    sessionTokens: count(issued, sessionToken),
    deviceCredentials: count(issued, credential)
  }
  return { ...vector, generated: { ...vector.generated, pairing } }
}

export const DOT_REMOTE_PAIRING_VECTORS: DotRemoteVector[] = [
  pairingVector(
    'pairing.refresh_ok',
    'refresh ok',
    'After a restart NASH has no session; it presents its device credential in the Nash-Device-Credential header and gets a new session and a rotated credential without asking the owner.',
    2,
    [refresh(1000, 1, refreshed(2, 1000))]
  ),
  pairingVector(
    'pairing.refresh_rotation',
    'rotation',
    'Every refresh replaces the presented credential with a new one; the absolute expiresAt of the pairing never moves.',
    3,
    [refresh(1000, 1, refreshed(2, 1000)), refresh(2000, 2, refreshed(3, 2000))]
  ),
  pairingVector(
    'pairing.refresh_reuse_detected',
    'reuse detected',
    'A replaced credential presented again is treated as theft: the Site revokes the binding, so the newest credential is refused too and dot can no longer write.',
    2,
    [
      refresh(1000, 1, refreshed(2, 1000)),
      refresh(1100, 1, fail('device_credential_reused')),
      refresh(1200, 2, fail('generation_revoked')),
      dot(1300, 'nash_submit_task', submitArgs(1), fail('nash_never_paired'))
    ]
  ),
  pairingVector(
    'pairing.refresh_lifetime_expired',
    'expired lifetime',
    'A session issued near the end of the pairing ends with it; at expiresAt the refresh is refused and the owner must pair again.',
    2,
    [
      refresh(LIFETIME_END - 300, 1, refreshed(2, LIFETIME_END - 300)),
      refresh(LIFETIME_END, 2, fail('pairing_expired'))
    ]
  ),
  pairingVector(
    'pairing.refresh_revoked_generation',
    'revoked generation',
    'The owner revokes the pairing on the Site; the device credential of that generation is refused afterwards.',
    1,
    [
      ownerStep(100, 'pairing.owner.revoke', { generation: 1 }, ok({ revokedGeneration: 1 })),
      refresh(1000, 1, fail('generation_revoked'))
    ]
  )
]
