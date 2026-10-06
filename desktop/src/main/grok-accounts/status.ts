import type { GrokAccountStatus } from '../../shared/rate-limit-types'
import { isGrokAccessTokenFresh, readGrokAuthSession } from '../rate-limits/grok-auth'
import { USAGE_METER_SOURCE } from '../rate-limits/usage-meters-policy'

export function getGrokAccountStatus(): GrokAccountStatus {
  // Why: this status only serves the usage meter, which NASH keeps off (no credential read).
  const readResult =
    USAGE_METER_SOURCE === 'orca-inherited' ? readGrokAuthSession() : { status: 'missing' as const }
  if (readResult.status === 'missing') {
    return {
      signedIn: false,
      email: null,
      teamId: null,
      tokenFresh: false,
      error: null
    }
  }
  if (readResult.status === 'error') {
    return {
      signedIn: false,
      email: null,
      teamId: null,
      tokenFresh: false,
      error: readResult.error
    }
  }
  const session = readResult.session
  return {
    signedIn: true,
    email: session.email,
    teamId: session.teamId,
    tokenFresh: isGrokAccessTokenFresh(session),
    error: null
  }
}
