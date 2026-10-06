import type { CursorAccountStatus } from '../../shared/rate-limit-types'
import { readCursorAuthSession } from '../rate-limits/cursor-auth'
import { isCursorSessionTokenExpired } from '../rate-limits/cursor-session-token'
import { USAGE_METER_SOURCE } from '../rate-limits/usage-meters-policy'

function signedOut(error: string | null): CursorAccountStatus {
  return {
    signedIn: false,
    email: null,
    displayName: null,
    credentialSource: null,
    planType: null,
    tokenFresh: false,
    error
  }
}

export async function getCursorAccountStatus(): Promise<CursorAccountStatus> {
  // Why: this status only serves the usage meter, which NASH keeps off (no credential read).
  if (USAGE_METER_SOURCE !== 'orca-inherited') {
    return signedOut(null)
  }
  const readResult = await readCursorAuthSession()
  if (readResult.status !== 'ok') {
    return signedOut(readResult.status === 'error' ? readResult.error : null)
  }
  const session = readResult.session
  return {
    signedIn: true,
    email: session.email,
    displayName: session.displayName,
    credentialSource: session.source,
    planType: session.membershipType,
    tokenFresh: !isCursorSessionTokenExpired(session.token),
    error: null
  }
}
