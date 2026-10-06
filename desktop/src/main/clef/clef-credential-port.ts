import type { ClefCredentialStatus } from '../../shared/clef/clef-credential-contract'
import { ClefCredentialGeneration } from './clef-credential-generation'
import type { ClefCredentialHandle } from './clef-credential-handle'

/**
 * Port through which runtime code reaches the sealed Clef credentials without importing
 * electron (same pattern as `network/http-client.ts`). Main startup installs the sealed store.
 */

export type {
  ClefCredentialProtection,
  ClefCredentialStatus
} from '../../shared/clef/clef-credential-contract'

export type ClefCredentialSource = {
  /** Presence and protection only; never values. */
  status(): ClefCredentialStatus
  /** A handle when both values are present, sealed and well formed; otherwise null. */
  read(): ClefCredentialHandle | null
  /**
   * Opaque marker that is replaced on every save and clear, never derived from a value. Read it
   * before a call and pass that same value to the call circuit so a later save lifts the latch.
   */
  generation(): ClefCredentialGeneration
}

const ABSENT_CREDENTIAL_GENERATION = ClefCredentialGeneration.mint()

const absentClefCredentialSource: ClefCredentialSource = {
  status: () => ({ tokenPresent: false, accountPresent: false, protection: 'absent' }),
  read: () => null,
  generation: () => ABSENT_CREDENTIAL_GENERATION
}

let current: ClefCredentialSource = absentClefCredentialSource

/** Installs the credential source; null restores the default that reports absent. */
export function setClefCredentialSource(source: ClefCredentialSource | null): void {
  current = source ?? absentClefCredentialSource
}

export function getClefCredentialSource(): ClefCredentialSource {
  return current
}
