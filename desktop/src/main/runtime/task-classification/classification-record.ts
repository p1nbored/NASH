import type { ValidatedClefAnswers } from '../../../shared/clef/clef-answers'
import {
  RecordedClassificationAnswersSchema,
  type ClassificationResult,
  type RecordedClassificationAnswers
} from '../../../shared/clef/clef-classification-contract'
import type { RouteBlocker } from '../../../shared/clef/clef-route-contract'
import { CLEF_QUESTION_BUNDLE_SHA256, CLEF_TAXONOMY_VERSION } from '../../clef/clef-question-set'
import type { ClefVerifiedProfileRecord } from '../../clef/clef-verified-profile'
import {
  TaskClassificationInputSchema,
  type TaskClassificationInput
} from '../orchestration/db/task-classification-store'
import type { ClassificationRun } from './classification-ports'

/** A refusal before, without or instead of a classification: two codes, never free text. */
export type ClassificationBlocker = { readonly reason: string; readonly detail: string }

export type ClassificationBody =
  | {
      readonly kind: 'blocked'
      readonly outcome: 'blocked' | 'invalid_output' | 'discarded_after_cancel'
      readonly blocker: ClassificationBlocker
      /** Clef's answers when it answered and a rule refused them; kept for audit. */
      readonly answers: ValidatedClefAnswers | null
    }
  | {
      readonly kind: 'classified'
      readonly result: ClassificationResult
      readonly answers: RecordedClassificationAnswers
      /** The classification whose answers were reused; null for a fresh answer. */
      readonly cacheSource: string | null
    }

/** What the local gates and the request build learned; hashes and rule names, never TaskSpec text. */
export type ClassificationEvidence = {
  readonly stateSha256: string | null
  readonly requestBodySha256: string | null
  readonly fingerprint: string | null
  readonly contentScanRules: readonly string[]
}

/** What the transport and the ledger recorded; empty for a block before the call. */
export type ClassificationCall = {
  readonly attempts: number
  readonly transportErrorClass: string | null
  readonly rawResponseId: string | null
  readonly rawResponseSha256: string | null
  readonly spendReservationId: string | null
  /** Earlier billed attempts of the same call; each stays spent at its reserved bound. */
  readonly earlierReservationIds: readonly string[]
  readonly computedNeurons: number | null
}

export type Recordable = {
  readonly body: ClassificationBody
  readonly evidence: ClassificationEvidence
  readonly call: ClassificationCall
}

export const NO_EVIDENCE: ClassificationEvidence = Object.freeze({
  stateSha256: null,
  requestBodySha256: null,
  fingerprint: null,
  contentScanRules: []
})

export const NO_CALL: ClassificationCall = Object.freeze({
  attempts: 0,
  transportErrorClass: null,
  rawResponseId: null,
  rawResponseSha256: null,
  spendReservationId: null,
  earlierReservationIds: [],
  computedNeurons: null
})

export const INTERRUPTED: RouteBlocker = Object.freeze({
  reason: 'classifier_unavailable',
  detail: 'interrupted'
})

/** The abort reason of `cancel`; any other abort, such as shutdown, records `interrupted`. */
export const CLASSIFICATION_CANCELED = 'classification_canceled'

export function blockedRecord(
  blocker: ClassificationBlocker,
  evidence: ClassificationEvidence = NO_EVIDENCE,
  call: ClassificationCall = NO_CALL,
  answers: ValidatedClefAnswers | null = null
): Recordable {
  const outcome = blocker.reason === 'invalid_output' ? 'invalid_output' : 'blocked'
  return { body: { kind: 'blocked', outcome, blocker, answers }, evidence, call }
}

/** A stopped classification: discarded when the caller canceled it, otherwise interrupted. */
export function interruptedRecord(
  signal: AbortSignal,
  evidence: ClassificationEvidence = NO_EVIDENCE,
  call: ClassificationCall = NO_CALL
): Recordable {
  const outcome = signal.reason === CLASSIFICATION_CANCELED ? 'discarded_after_cancel' : 'blocked'
  return { body: { kind: 'blocked', outcome, blocker: INTERRUPTED, answers: null }, evidence, call }
}

export function recordedAnswersOf(answers: ValidatedClefAnswers): RecordedClassificationAnswers {
  return RecordedClassificationAnswersSchema.parse({
    taskType: answers.taskType.choice,
    needsDelegation: answers.needsDelegation.value,
    probabilities: { task_type: answers.taskType.probabilities },
    providerConfidence: { status: 'not_used', values: answers.providerConfidence }
  })
}

const ClassifierModelSchema = TaskClassificationInputSchema.shape.classifierModel

/** The pinned response model, when the classification store's column can hold it. */
function classifierModelOf(profile: ClefVerifiedProfileRecord | null): string | null {
  const parsed = ClassifierModelSchema.safeParse(profile?.profile.expectedResponseModel ?? null)
  return parsed.success ? parsed.data : null
}

function answersColumnOf({ body, evidence, call }: Recordable) {
  const classified = body.kind === 'classified'
  const answers = classified ? body.answers : body.answers && recordedAnswersOf(body.answers)
  return {
    answers,
    blocker: classified ? null : { reason: body.blocker.reason, detail: body.blocker.detail },
    evidence: {
      stateSha256: evidence.stateSha256,
      requestBodySha256: evidence.requestBodySha256,
      fingerprint: evidence.fingerprint,
      contentScanRules: [...evidence.contentScanRules],
      cacheSource: classified ? body.cacheSource : null,
      attempts: call.attempts,
      transportErrorClass: call.transportErrorClass,
      rawResponseSha256: call.rawResponseSha256,
      earlierReservationIds: [...call.earlierReservationIds],
      computedNeurons: call.computedNeurons
    }
  }
}

/** The one `task_classifications` row of this classification; the store refuses any inconsistency. */
export function toClassificationInput(
  run: ClassificationRun,
  recordable: Recordable,
  attempt: number,
  timestamp: string
): TaskClassificationInput {
  const { body, call } = recordable
  const classified = body.kind === 'classified'
  return {
    taskId: run.subject.taskId,
    attempt,
    outcome: classified ? 'classified' : body.outcome,
    detail: classified ? null : body.blocker.detail,
    needsDelegation: classified ? body.result.needsDelegation : null,
    taskType: classified ? body.result.taskType : null,
    answers: answersColumnOf(recordable),
    bundleSha256: CLEF_QUESTION_BUNDLE_SHA256,
    taxonomyVersion: CLEF_TAXONOMY_VERSION,
    profileSha256: run.profile?.profileHash ?? null,
    classifierModel: classifierModelOf(run.profile),
    rawResponseId: call.rawResponseId,
    spendReservationId: call.spendReservationId,
    timestamp
  }
}

/** Startup recovery: the billed attempt of a classification that never wrote its record. */
export function recoveredInterruptedInput(
  link: { readonly taskId: string; readonly reservationId: string },
  attempt: number,
  timestamp: string
): TaskClassificationInput {
  return {
    taskId: link.taskId,
    attempt,
    outcome: 'blocked',
    detail: INTERRUPTED.detail,
    needsDelegation: null,
    taskType: null,
    answers: { answers: null, blocker: { ...INTERRUPTED }, evidence: { recovered: true } },
    bundleSha256: CLEF_QUESTION_BUNDLE_SHA256,
    taxonomyVersion: CLEF_TAXONOMY_VERSION,
    profileSha256: null,
    classifierModel: null,
    rawResponseId: null,
    spendReservationId: link.reservationId,
    timestamp
  }
}
