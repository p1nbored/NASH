import { APP_IDENTITY } from '../../shared/app-identity-constants'
import { parsePairingCode, type PairingOffer } from '../../shared/pairing'
import { resolveEnvironmentPairingOffer } from './environments'
import { RuntimeClientError } from './types'

export function resolveRemotePairing(
  userDataPath: string,
  pairingCode: string | null,
  environmentSelector: string | null
): PairingOffer | null {
  if (pairingCode && environmentSelector) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Use either --pairing-code or --environment, not both.'
    )
  }
  if (environmentSelector) {
    return resolveEnvironmentPairingOffer(userDataPath, environmentSelector)
  }
  if (!pairingCode) {
    return null
  }
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Invalid remote pairing code. Expected a ${APP_IDENTITY.urlScheme}://pair?... URL or bare pairing payload.`
    )
  }
  return pairing
}
