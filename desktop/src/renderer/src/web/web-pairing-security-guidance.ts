import { translate } from '@/i18n/i18n'
import type { WebDeviceKeySupport } from './web-device-key'
import type { StoredWebRuntimeEnvironment } from './web-runtime-environment'
import { MIGRATED_DEVICE_TOKEN_PREFIX } from './web-runtime-credential-source'

/** What to tell the user about how this browser holds its pairing; null when nothing is at risk. */
export function webPairingSecurityGuidance(
  support: WebDeviceKeySupport | null,
  environment: StoredWebRuntimeEnvironment | null
): string | null {
  if (!support || support === 'persistent' || !environment) {
    return null
  }
  const storesCode = environment.endpoints.some(
    (endpoint) => !endpoint.deviceToken.startsWith(MIGRATED_DEVICE_TOKEN_PREFIX)
  )
  if (environment.sessionOnly) {
    return webSessionPairingGuidance(support)
  }
  if (!storesCode) {
    return null
  }
  return support === 'session-insecure-origin'
    ? translate(
        'auto.web.pairingSecurity.storedCodeInsecureOrigin',
        'This browser keeps a reusable pairing code, because this page is plain http on another machine. Anyone who can read this browser’s storage could use it. For a safer pairing, open Orca over https, at localhost on this computer, or through an SSH tunnel, and pair again.'
      )
    : translate(
        'auto.web.pairingSecurity.storedCodeNoEd25519',
        'This browser keeps a reusable pairing code, because it cannot create secure sign-in keys (Ed25519). Use a current browser and pair again for a safer pairing.'
      )
}

/** Shown before and after pairing when this browser can only pair for the current tab. */
export function webSessionPairingGuidance(support: WebDeviceKeySupport | null): string | null {
  if (!support || support === 'persistent') {
    return null
  }
  return support === 'session-insecure-origin'
    ? translate(
        'auto.web.pairingSecurity.sessionInsecureOrigin',
        'This pairing lasts only while this tab is open, because this page is plain http on another machine. For a pairing this browser remembers, open Orca over https, at localhost on this computer, or through an SSH tunnel.'
      )
    : translate(
        'auto.web.pairingSecurity.sessionNoEd25519',
        'This pairing lasts only while this tab is open, because this browser cannot create secure sign-in keys (Ed25519). Use a current browser for a pairing it remembers.'
      )
}
