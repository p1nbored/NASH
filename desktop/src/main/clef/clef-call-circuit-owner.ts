import { createClefCallCircuit, type ClefCallCircuit } from './clef-call-circuit'
import { getClefCredentialSource } from './clef-credential-port'

/**
 * Owns the one Clef call circuit in the main process (no electron import, so runtime code may use
 * it). Router wiring: gate and record through getClefCallCircuit(), never a private
 * createClefCallCircuit(), so the credential-change listener below reaches the same auth latch.
 */
let current: ClefCallCircuit | null = null

export function getClefCallCircuit(): ClefCallCircuit {
  current ??= createClefCallCircuit({ now: () => Date.now() })
  return current
}

/** Installs a circuit (tests inject a fake clock this way); null lets the next read create one. */
export function setClefCallCircuit(circuit: ClefCallCircuit | null): void {
  current = circuit
}

/** onCredentialsChanged listener: the store has already minted the new generation. */
export function liftClefAuthLatchForCurrentCredentials(): void {
  getClefCallCircuit().liftAuthLatch(getClefCredentialSource().generation())
}
