// Why a counter and not a hash: spec section 4 forbids any credential-derived fingerprint.
let mintedCount = 0

/**
 * Opaque marker for "which credentials are stored". The sealed store mints a new one on every
 * save and clear; the auth_failed latch compares generations and so never holds a credential value.
 * It carries no readable field, so a log, snapshot or serializer cannot leak or forge it.
 */
export class ClefCredentialGeneration {
  readonly #serial: number

  private constructor(serial: number) {
    this.#serial = serial
  }

  /** A generation that no other minted generation equals. */
  static mint(): ClefCredentialGeneration {
    mintedCount += 1
    return new ClefCredentialGeneration(mintedCount)
  }

  equals(other: unknown): boolean {
    return (
      typeof other === 'object' &&
      other !== null &&
      #serial in other &&
      other.#serial === this.#serial
    )
  }
}
