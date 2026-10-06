import type { ClefCredentialGeneration } from './clef-credential-generation'
import type { ClefCredentialStatus } from './clef-credential-port'
import type { ClefCredentialHandleLike } from './clef-endpoint'
import type { ClefTransportRequest } from './clef-transport'
import type { ClefTransportOutcome } from './clef-transport-outcome'

/** The credential source a Clef caller reads; `getClefCredentialSource()` satisfies it. */
export type ClefCredentialSourcePort = {
  status(): ClefCredentialStatus
  read(): ClefCredentialHandleLike | null
  generation(): ClefCredentialGeneration
}

/** The only Clef call site; production installs `sendClefRequest`. */
export type ClefTransportPort = (request: ClefTransportRequest) => Promise<ClefTransportOutcome>
