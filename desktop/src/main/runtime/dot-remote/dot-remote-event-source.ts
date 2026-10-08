import type { z } from 'zod'
import type { DotDecisionView } from '../../../shared/dot-ingress/dot-ingress-decision'
import type {
  DotValidationSettled,
  DotValidationView
} from '../../../shared/dot-ingress/dot-ingress-validation'
import type { DotRemoteRequestStatusDataSchema } from '../../../shared/dot-remote/dot-remote-events'
import type { DotRemoteMessageOutcome } from './dot-remote-item-dispatch'

// What the event sync reads about one dot request, from the existing local readers only: the D4
// projection, D2's listForDot, C3's message outcomes, C5's record lines, the D1 run summary and C4's
// artifacts. Free text is still raw here; the sync turns it into schema-valid lines.

export type DotRemoteRequestStatusData = z.infer<typeof DotRemoteRequestStatusDataSchema>

export type DotRemoteValidationFact = {
  validationId: string
  verdict: 'pass' | 'fail' | 'inconclusive'
  /** The C5 record line that decided the verdict, or null. */
  line: string | null
}

/** A waiting decision as dot may see it, or how a decision NASH reported as waiting ended. */
export type DotRemoteValidationDecisionFact =
  | { kind: 'pending'; view: DotValidationView }
  | { kind: 'settled'; settled: DotValidationSettled }

export type DotRemoteArtifactFact = {
  /** The local artifact id; it is mapped to an opaque art_ id before anything is recorded. */
  artifactId: string
  sizeBytes: number
  sha256: string
}

export type DotRemoteRequestSnapshot = {
  status: DotRemoteRequestStatusData
  /** Every prompt dot may see on the request's run, pending or decided. */
  prompts: readonly DotDecisionView[]
  messages: readonly DotRemoteMessageOutcome[]
  validations: readonly DotRemoteValidationFact[]
  /** Present once the run completed: the run summary (or null) and the artifacts that passed. */
  deliverable: { summary: string | null; artifacts: readonly DotRemoteArtifactFact[] } | null
  /** At most the open cap across followed requests are pending; known ones that ended are settled. */
  validationDecisions: readonly DotRemoteValidationDecisionFact[]
  /** A validation of the run still waits for a decision, reported or not. */
  awaitsValidationDecision: boolean
}

export type DotRemoteEventSource = {
  /** Null when NASH has no record of the request; the sync then leaves it as it is. */
  snapshot(
    dotRequestId: string,
    known: { messageIds: readonly string[]; validationIds: readonly string[] }
  ): DotRemoteRequestSnapshot | null
  /** Called once per sync with the requests it follows, before it reads any of them. */
  beginSync?(followed: readonly string[]): void
}
