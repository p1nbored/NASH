import { hasSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import type { AttemptArtifactRecord } from '../orchestration/db/attempt-artifact-store'
import type { EvidenceRef } from '../orchestration/db/task-validation-record'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { inspectArtifactFile, type ArtifactFileResult } from './artifact-file-inspection'
import type { TaskValidationPort } from './task-validation-port'
import {
  failed,
  passed,
  quoted,
  undecided,
  type AttemptEvidence,
  type CheckOutcome
} from './validation-context'
import type { ArtifactRoot } from './validation-policy'

const ARTIFACT_EXISTS = 'artifact_exists'
const SECRET_SCAN = 'secret_scan_clean'
/** The artifact kind recorded for a file a TaskSpec names. */
const DELIVERABLE_KIND = 'deliverable'
/** Bound text retained for secret scanning. */
const ARTIFACT_TEXT_MAX_BYTES = 4 * 1024 * 1024

export type ArtifactRecorder = Pick<TaskValidationPort, 'recordArtifact' | 'listArtifacts'>

function inspectionProblem(
  path: string,
  inspected: Exclude<ArtifactFileResult, { status: 'ok' }>
): CheckOutcome {
  const name = quoted(path)
  switch (inspected.status) {
    case 'path_refused':
      return failed(
        ARTIFACT_EXISTS,
        `The artifact path ${name} is not a plain relative path and is refused.`
      )
    case 'missing':
      return failed(ARTIFACT_EXISTS, `The artifact ${name} does not exist.`)
    case 'symlink':
      return failed(
        ARTIFACT_EXISTS,
        `The artifact path ${name} goes through a link, which is refused.`
      )
    case 'hard_linked':
      return failed(
        ARTIFACT_EXISTS,
        `The artifact ${name} has another hard link, which is refused.`
      )
    case 'escape':
      return failed(
        ARTIFACT_EXISTS,
        `The artifact ${name} resolves outside its root, which is refused.`
      )
    case 'not_a_file':
      return failed(ARTIFACT_EXISTS, `The artifact ${name} is not a regular file.`)
    case 'too_large':
      return undecided(ARTIFACT_EXISTS, `The artifact ${name} is too large to hash.`)
    case 'changed':
      return undecided(ARTIFACT_EXISTS, `The artifact ${name} changed while it was read.`)
    case 'unreadable':
      return undecided(ARTIFACT_EXISTS, `The artifact ${name} could not be read.`)
  }
}

function recordingProblem(path: string, error: unknown): CheckOutcome {
  if (error instanceof OrchestrationError && error.code === 'autopilot_artifact_conflict') {
    return undecided(
      ARTIFACT_EXISTS,
      `The artifact ${quoted(path)} changed after it was first recorded.`
    )
  }
  if (error instanceof OrchestrationError) {
    return undecided(
      ARTIFACT_EXISTS,
      `The artifact ${quoted(path)} could not be recorded (${error.code}).`
    )
  }
  throw error
}

/** The named file exists now as a plain file under its root; its sha256 is recorded with the attempt. */
export async function checkArtifactExists(
  evidence: AttemptEvidence,
  check: { readonly path: string; readonly root: ArtifactRoot },
  recorder: ArtifactRecorder,
  timestamp: string
): Promise<CheckOutcome> {
  const rootPath = evidence.workspace?.path ?? null
  if (rootPath === null) {
    return undecided(
      ARTIFACT_EXISTS,
      'The workspace is not a local directory the validators can read.'
    )
  }
  const inspected = await inspectArtifactFile(rootPath, check.path)
  if (inspected.status !== 'ok') {
    return inspectionProblem(check.path, inspected)
  }
  try {
    const { record } = recorder.recordArtifact({
      dispatchId: evidence.dispatchId,
      kind: DELIVERABLE_KIND,
      root: check.root,
      relativePath: check.path,
      sha256: inspected.sha256,
      sizeBytes: inspected.sizeBytes,
      timestamp
    })
    return passed(
      ARTIFACT_EXISTS,
      `The artifact ${quoted(check.path)} exists (${inspected.sizeBytes} bytes).`,
      [{ kind: 'artifact', ref: record.artifactId }]
    )
  } catch (error) {
    return recordingProblem(check.path, error)
  }
}

type Scan = { readonly verdict: 'clean' | 'secret' | 'unknown'; readonly ref: EvidenceRef | null }

async function scanArtifact(
  evidence: AttemptEvidence,
  artifact: AttemptArtifactRecord
): Promise<Scan> {
  const rootPath = evidence.workspace?.path ?? null
  if (rootPath === null) {
    return { verdict: 'unknown', ref: null }
  }
  const read = await inspectArtifactFile(rootPath, artifact.relativePath, {
    textMaxBytes: ARTIFACT_TEXT_MAX_BYTES
  })
  if (read.status !== 'ok' || read.text === null || read.sha256 !== artifact.sha256) {
    return { verdict: 'unknown', ref: null }
  }
  const ref = { kind: 'artifact', ref: artifact.artifactId }
  return { verdict: hasSecretLikeText(read.text) ? 'secret' : 'clean', ref }
}

/** No recorded artifact holds a credential shape. */
export async function checkSecretScanClean(
  evidence: AttemptEvidence,
  recorder: Pick<ArtifactRecorder, 'listArtifacts'>
): Promise<CheckOutcome> {
  const artifacts = recorder.listArtifacts(evidence.dispatchId)
  const scans = await Promise.all(artifacts.map((artifact) => scanArtifact(evidence, artifact)))
  const refs = scans.flatMap((scan) => (scan.ref ? [scan.ref] : []))
  const secrets = scans.filter((scan) => scan.verdict === 'secret').length
  if (secrets > 0) {
    return failed(
      SECRET_SCAN,
      `Secret-shaped text was found in ${secrets} of ${scans.length} outputs.`,
      refs
    )
  }
  if (scans.some((scan) => scan.verdict === 'unknown')) {
    return undecided(
      SECRET_SCAN,
      'An output could not be read whole, or changed after it was recorded.',
      refs
    )
  }
  return scans.length === 0
    ? passed(SECRET_SCAN, 'There was no output to scan.', [])
    : passed(
        SECRET_SCAN,
        `${scans.length} outputs were scanned and hold no secret-shaped text.`,
        refs
      )
}
