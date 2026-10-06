import { createDotRemoteSealedCredentialStore } from '../dot-remote/dot-remote-sealed-credential-store'
import type { DotRemoteCredentialSource } from '../runtime/dot-remote/dot-remote-credentials'

let installed: DotRemoteCredentialSource | null = null

/**
 * Creates the one sealed remote-access store on first call; later calls return the same instance, so
 * no second decrypted cache exists. Call after app 'ready': Linux reports no keyring before then.
 */
export function installDotRemoteCredentialStore(): DotRemoteCredentialSource {
  installed ??= createDotRemoteSealedCredentialStore()
  return installed
}
