import { getSecretStore } from '../../shared/secret-store'

/** Same gate as the sealed Clef store; a missing or throwing port counts as unsealed. */
export function dotRemoteSealingAvailable(): boolean {
  try {
    const secrets = getSecretStore()
    return secrets.isEncryptionAvailable() && secrets.describeProtectionGap() === null
  } catch {
    return false
  }
}
