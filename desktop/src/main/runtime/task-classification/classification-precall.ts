import { getClefCallCircuit } from '../../clef/clef-call-circuit-owner'
import type { ClefCredentialGeneration } from '../../clef/clef-credential-generation'
import { buildClefRequest, type BuiltClefRequest } from '../../clef/clef-request-builder'
import type { ClefVerifiedProfileRecord } from '../../clef/clef-verified-profile'
import { evaluateClefConfiguration } from '../workbench-routing/route-configuration-gate'
import { evaluateRouteDataBoundary } from '../workbench-routing/route-data-boundary'
import { cachedRecordable, classificationFingerprintFor } from './classification-cache'
import type { ClassificationRun } from './classification-ports'
import {
  NO_EVIDENCE,
  blockedRecord,
  type ClassificationEvidence,
  type Recordable
} from './classification-record'

/** Everything the call needs once every gate and the request build have passed. */
export type PreparedClassification = {
  readonly profile: ClefVerifiedProfileRecord
  readonly request: BuiltClefRequest
  readonly evidence: ClassificationEvidence
  readonly fingerprint: string | null
  /** Read once, before the circuit gate; the gate and the circuit record see the same value. */
  readonly generation: ClefCredentialGeneration
}

export type PreCallStage =
  | { readonly done: true; readonly record: Recordable }
  | { readonly done: false; readonly prepared: PreparedClassification }

/** The reason code of a refusal by the Routing Table itself; its detail is the table's own reason. */
export const ROUTING_TABLE_UNAVAILABLE = 'routing_table_unavailable'

const finished = (record: Recordable): PreCallStage => ({ done: true, record })

function scanEvidence(matchedRules: readonly string[]): ClassificationEvidence {
  return { ...NO_EVIDENCE, contentScanRules: [...matchedRules] }
}

/** G0 over credentials and the verified profile; no spend cap gates the call (D-022). */
function configurationOf(run: ClassificationRun) {
  return evaluateClefConfiguration({ credentials: run.deps.credentials }, run.profile)
}

/**
 * Everything before the paid call, in order: G0, the active Routing Table, G1, the request build, the
 * call circuit, then the cache. The circuit comes before the cache, so an outage blocks outright and a
 * cached answer is never a fallback. Every refusal ends the classification with nothing sent or spent.
 */
export function prepareClassification(run: ClassificationRun): PreCallStage {
  const configured = configurationOf(run)
  if (!configured.passed) {
    return finished(blockedRecord(configured.blocker))
  }
  const table = run.deps.routing.activeTable()
  if (!table.ok) {
    // Why before the call: with no usable table a delegated answer could never route; the bundled table is no fallback.
    return finished(blockedRecord({ reason: ROUTING_TABLE_UNAVAILABLE, detail: table.reason }))
  }
  const boundary = evaluateRouteDataBoundary(run.subject.taskSpec)
  if (!boundary.passed) {
    return finished(blockedRecord(boundary.blocker, scanEvidence(boundary.matchedRules)))
  }
  const built = buildClefRequest(run.subject.taskSpec)
  if (!built.ok) {
    return finished(blockedRecord(built.blocker, scanEvidence(built.matchedRules)))
  }
  const fingerprint = classificationFingerprintFor(built.request, configured.profile)
  const evidence: ClassificationEvidence = {
    stateSha256: built.request.stateSha256,
    requestBodySha256: built.request.bodySha256,
    fingerprint,
    contentScanRules: []
  }
  const generation = run.deps.credentials.generation()
  const gate = getClefCallCircuit().gate(generation)
  if (!gate.allowed) {
    return finished(blockedRecord(gate.blocker, evidence))
  }
  const cached = fingerprint === null ? null : run.deps.cache.lookup(fingerprint)
  if (cached !== null) {
    return finished(cachedRecordable(cached, evidence))
  }
  return {
    done: false,
    prepared: {
      profile: configured.profile,
      request: built.request,
      evidence,
      fingerprint,
      generation
    }
  }
}
