import type { RouteBlocker } from '../../../shared/clef/clef-route-contract'
import { exchangeWithClef } from './classification-exchange'
import { finishExchange } from './classification-outcome'
import { prepareClassification, type PreparedClassification } from './classification-precall'
import type {
  ClassificationRun,
  ClassificationRunResult,
  TaskClassifierDeps
} from './classification-ports'
import {
  NO_CALL,
  blockedRecord,
  interruptedRecord,
  toClassificationInput,
  type Recordable
} from './classification-record'
import { routeClassification } from './classification-route'
import type { ClassificationSubject } from './classification-subject'

export type TaskClassifier = {
  /** Classifies one TaskSpec; resolves after its one record (and, when classified, its route) is written. */
  classify(subject: ClassificationSubject, signal: AbortSignal): Promise<ClassificationRunResult>
}

const CREDENTIALS_UNREADABLE: RouteBlocker = {
  reason: 'classifier_unavailable',
  detail: 'not_configured'
}

/** After every gate: read the credentials, make the one paid call, settle the spend. */
async function callAndJudge(
  run: ClassificationRun,
  prepared: PreparedClassification
): Promise<Recordable> {
  if (run.signal.aborted) {
    return interruptedRecord(run.signal, prepared.evidence)
  }
  // Why: the generation was read before the handle, so a credential save in between lifts the latch
  // instead of latching the new credentials for an old failure.
  const credentials = run.deps.credentials.read()
  if (credentials === null) {
    const call = { ...NO_CALL, transportErrorClass: 'credentials_unavailable' }
    return blockedRecord(CREDENTIALS_UNREADABLE, prepared.evidence, call)
  }
  const exchange = await exchangeWithClef(run, prepared, credentials)
  return finishExchange(run, prepared, exchange)
}

async function produce(run: ClassificationRun): Promise<Recordable> {
  if (run.signal.aborted) {
    return interruptedRecord(run.signal)
  }
  const stage = prepareClassification(run)
  return stage.done ? stage.record : callAndJudge(run, stage.prepared)
}

/** Writes the one classification record; a fresh classified answer becomes reusable, then routes. */
async function recordOutcome(
  run: ClassificationRun,
  recordable: Recordable
): Promise<ClassificationRunResult> {
  const { deps, subject } = run
  const timestamp = new Date(deps.clock.now()).toISOString()
  const attempt = deps.classifications.nextAttempt(subject.taskId)
  const classification = deps.classifications.record(
    toClassificationInput(run, recordable, attempt, timestamp)
  )
  const { body, evidence } = recordable
  if (body.kind !== 'classified') {
    return { classification, route: { kind: 'not_requested' }, cacheHit: false }
  }
  if (body.cacheSource === null && evidence.fingerprint !== null) {
    deps.cache.remember(evidence.fingerprint, {
      result: body.result,
      answers: body.answers,
      sourceClassificationId: classification.classificationId
    })
  }
  const route = await routeClassification(run, classification, body.result)
  return { classification, route, cacheHit: body.cacheSource !== null }
}

/**
 * Classifies one TaskSpec into {needs_delegation, task_type} (D-016): G0, Routing Table, G1, build,
 * circuit, cache, reserve, call, validate, decide, record, route. Every refusal ends in exactly one
 * recorded reason and detail; there is no fallback classifier, stale answer or substitute route.
 */
export function createTaskClassifier(deps: TaskClassifierDeps): TaskClassifier {
  return {
    async classify(subject, signal) {
      const run: ClassificationRun = {
        deps,
        subject,
        signal,
        profile: deps.verifiedProfile.read()
      }
      return recordOutcome(run, await produce(run))
    }
  }
}
