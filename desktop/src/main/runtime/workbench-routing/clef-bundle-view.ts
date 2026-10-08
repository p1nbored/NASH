import type { ClefVerifiedProfileFileStore } from '../../clef/clef-verified-profile'

/**
 * The bundle hash the stored profile was verified against (its input pin), read before the pin check
 * so a profile for another bundle is still named. Null when none is stored or the file is unreadable;
 * the pin-checked source already reports a read failure, so it is not reported twice.
 */
export function readVerifiedBundleSha256(
  storedProfile: Pick<ClefVerifiedProfileFileStore, 'read'>
): string | null {
  try {
    return storedProfile.read()?.profile.schemaPins.inputSchemaSha256 ?? null
  } catch {
    return null
  }
}
