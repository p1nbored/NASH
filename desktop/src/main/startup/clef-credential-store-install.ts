import { setClefCredentialSource } from '../clef/clef-credential-port'
import {
  createClefSealedCredentialStore,
  type ClefSealedCredentialStore
} from '../clef/clef-sealed-credential-store'

let installed: ClefSealedCredentialStore | null = null

/**
 * Creates the one sealed Clef store on first call and installs it as the credential source.
 * Later calls return the same instance, so the IPC handlers and the port never keep separate
 * decrypted caches. Call after app 'ready': Linux reports no keyring before then.
 */
export function installClefCredentialStore(): ClefSealedCredentialStore {
  if (installed === null) {
    installed = createClefSealedCredentialStore()
    setClefCredentialSource(installed)
  }
  return installed
}
