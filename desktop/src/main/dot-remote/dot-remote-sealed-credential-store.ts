import { ApiKeySealingUnavailableError } from '../credentials/api-key-sealing-unavailable-error'
import { createEncryptedApiKeyFileStore } from '../credentials/encrypted-api-key-file-store'
import {
  DotRemoteServiceToken,
  validateDotRemoteServiceTokenShape,
  type DotRemoteCredentialSource,
  type DotRemoteTokenProtection
} from '../runtime/dot-remote/dot-remote-credentials'
import { createSealedDeviceCredentialSlot } from './dot-remote-sealed-device-credential'
import { dotRemoteSealingAvailable } from './dot-remote-sealing-gate'

// The Sites service token the user pastes, sealed with the OS keyring under the NASH home folder
// (the Clef pattern, D-012/D-017). Fail closed: no plaintext fallback, a plaintext or unreadable
// envelope is refused, and no path logs the value. Startup installs one instance, which also holds
// the pairing's device credential in its own sealed file.

type StoredState = 'missing' | 'sealed' | 'refused'

export function createDotRemoteSealedCredentialStore(): DotRemoteCredentialSource {
  const store = createEncryptedApiKeyFileStore({
    fileName: 'dot-remote-service-token.enc',
    envelopePrefix: 'nash-dot-remote-service-token:v1:',
    providerLabel: 'Sites service token',
    logScope: 'dot-remote',
    requireSealing: true
  })

  function stored(): StoredState {
    if (!store.has()) {
      return 'missing'
    }
    // Why: a null protection means the envelope is unreadable, which is no more trusted than plaintext.
    return store.protection() === 'sealed' ? 'sealed' : 'refused'
  }

  function status(): { present: boolean; protection: DotRemoteTokenProtection } {
    const state = stored()
    if (state === 'refused') {
      return { present: true, protection: 'plaintext_refused' }
    }
    if (!dotRemoteSealingAvailable()) {
      return { present: state !== 'missing', protection: 'sealing_unavailable' }
    }
    return { present: state === 'sealed', protection: state === 'sealed' ? 'sealed' : 'absent' }
  }

  function read(): DotRemoteServiceToken | null {
    if (status().protection !== 'sealed') {
      return null
    }
    try {
      const token = store.read()
      return token !== null && validateDotRemoteServiceTokenShape(token) === null
        ? new DotRemoteServiceToken(token)
        : null
    } catch {
      console.warn('[dot-remote] the sealed service token could not be unsealed')
      return null
    }
  }

  function removeQuietly(): boolean {
    try {
      store.clear()
      return true
    } catch {
      console.warn('[dot-remote] the sealed service token file could not be removed')
      return false
    }
  }

  function save(token: string): ReturnType<DotRemoteCredentialSource['save']> {
    const shape = validateDotRemoteServiceTokenShape(token)
    if (shape !== null) {
      return { ok: false, code: shape }
    }
    if (!dotRemoteSealingAvailable()) {
      return { ok: false, code: 'sealing_unavailable' }
    }
    try {
      store.save(token)
    } catch (error) {
      removeQuietly()
      // Why: sealing dropped after the check above; the store refuses before writing any plaintext.
      return {
        ok: false,
        code:
          error instanceof ApiKeySealingUnavailableError ? 'sealing_unavailable' : 'write_failed'
      }
    }
    if (store.protection() !== 'sealed') {
      removeQuietly()
      return { ok: false, code: 'sealing_unavailable' }
    }
    return { ok: true }
  }

  return {
    status,
    read,
    save,
    clear: () => (removeQuietly() ? { ok: true } : { ok: false, code: 'clear_failed' }),
    ...createSealedDeviceCredentialSlot()
  }
}
