import { DotRemoteDeviceCredentialSchema } from '../../shared/dot-remote/dot-remote-device-credential'
import { ApiKeySealingUnavailableError } from '../credentials/api-key-sealing-unavailable-error'
import { createEncryptedApiKeyFileStore } from '../credentials/encrypted-api-key-file-store'
import {
  DotRemoteDeviceCredential,
  type DotRemoteCredentialSource
} from '../runtime/dot-remote/dot-remote-credentials'
import { dotRemoteSealingAvailable } from './dot-remote-sealing-gate'

// The pairing's device credential, sealed in its own file next to the Site token. Fail closed: no
// plaintext fallback, a plaintext or unreadable envelope reads as absent, and no path logs the value.
// A rotation is one atomic write (temporary file, then rename), so a crash keeps the old or the new.

type DeviceSlot = Pick<DotRemoteCredentialSource, 'readDevice' | 'saveDevice' | 'clearDevice'>

export function createSealedDeviceCredentialSlot(): DeviceSlot {
  const store = createEncryptedApiKeyFileStore({
    fileName: 'dot-remote-device-credential.enc',
    envelopePrefix: 'nash-dot-remote-device-credential:v1:',
    providerLabel: 'Remote device credential',
    logScope: 'dot-remote',
    requireSealing: true
  })

  function removeQuietly(): boolean {
    try {
      store.clear()
      return true
    } catch {
      console.warn('[dot-remote] the sealed device credential file could not be removed')
      return false
    }
  }

  function readDevice(): DotRemoteDeviceCredential | null {
    if (!store.has() || store.protection() !== 'sealed' || !dotRemoteSealingAvailable()) {
      return null
    }
    try {
      const value = store.read()
      return value !== null && DotRemoteDeviceCredentialSchema.safeParse(value).success
        ? new DotRemoteDeviceCredential(value)
        : null
    } catch {
      console.warn('[dot-remote] the sealed device credential could not be unsealed')
      return null
    }
  }

  function saveDevice(credential: string): ReturnType<DeviceSlot['saveDevice']> {
    if (!DotRemoteDeviceCredentialSchema.safeParse(credential).success) {
      return { ok: false, code: 'credential_invalid' }
    }
    if (!dotRemoteSealingAvailable()) {
      return { ok: false, code: 'sealing_unavailable' }
    }
    try {
      store.save(credential)
    } catch (error) {
      // Why remove: a failed rotation leaves only a credential the Site has already superseded.
      removeQuietly()
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
    readDevice,
    saveDevice,
    clearDevice: () => (removeQuietly() ? { ok: true } : { ok: false, code: 'clear_failed' })
  }
}
