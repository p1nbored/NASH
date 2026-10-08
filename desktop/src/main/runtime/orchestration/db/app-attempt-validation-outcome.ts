import { z } from 'zod'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import {
  AttemptNoticeSchema,
  AttemptResultSchema,
  type AppAttemptView,
  type AttemptNotice
} from './app-attempt-input'
import { expectAttempt, loadAttempt, readAttemptView, type LoadedAttempt } from './app-attempt-load'
import { fileAttemptNotice, recordReportFact } from './app-attempt-orca-facts'
import {
  completeAttemptInOrca,
  failAttemptInOrca,
  markInconclusiveInOrca
} from './app-attempt-orca-writes'
import { APP_ATTEMPT_AWAITING_VALIDATION_STAGES, APP_ATTEMPT_STAGES } from './app-attempt-stages'
import { assertNoSecretLikeText } from './autopilot-json-column'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import { TASK_VALIDATION_WAIVERS } from './autopilot-task-schema-definition'
import {
  AutopilotIdSchema,
  UtcTimestampSchema,
  parseAutopilotInput,
  runAutopilotWrite
} from './autopilot-store-input'
import type { TaskSpecRecord } from './task-spec-record'
import { getTaskSpecStore, type TaskSpecStore } from './task-spec-store'
import { ValidationVerdictInputSchema, type TaskValidationRecord } from './task-validation-record'
import { assertPassIsSufficient } from './validation-pass-sufficiency'
import {
  applyValidationVerdict,
  applyValidationWaiver,
  getTaskValidationStore,
  type TaskValidationStore
} from './task-validation-store'

const RecordVerdictInputSchema = z
  .object({
    ...ValidationVerdictInputSchema.shape,
    resultSummary: AttemptResultSchema.optional(),
    notice: AttemptNoticeSchema.optional()
  })
  .strict()
export type RecordVerdictInput = z.input<typeof RecordVerdictInputSchema>

const DecisionInputSchema = z
  .object({
    validationId: AutopilotIdSchema,
    by: z.enum(TASK_VALIDATION_WAIVERS),
    resultSummary: AttemptResultSchema.optional(),
    notice: AttemptNoticeSchema.optional(),
    timestamp: UtcTimestampSchema
  })
  .strict()
export type WaiveInput = z.input<typeof DecisionInputSchema>
export type RejectInput = z.input<typeof DecisionInputSchema>

export type ValidationOutcome = { validation: TaskValidationRecord; attempt: AppAttemptView }

type Filing = { notice: AttemptNotice; name: string; priority: 'normal' | 'high' }
type Context = { validation: TaskValidationRecord; attempt: LoadedAttempt; spec: TaskSpecRecord }

const stores = new WeakMap<OrchestrationDb, ValidationOutcomeService>()

export function getValidationOutcomeService(owner: OrchestrationDb): ValidationOutcomeService {
  let service = stores.get(owner)
  if (!service) {
    service = new ValidationOutcomeService(owner)
    stores.set(owner, service)
  }
  return service
}

function conflict(message: string): OrchestrationError {
  return new OrchestrationError('autopilot_validation_conflict', message)
}

/**
 * The only path that decides a claimed attempt: the verdict, the attempt's Orca rows and the Task's
 * status move in one transaction. A pass completes the task through Orca's updateTaskStatus, which
 * promotes its dependents; a fail fails it; an inconclusive result keeps it blocked for the user or dot.
 */
export class ValidationOutcomeService {
  private readonly validations: TaskValidationStore
  private readonly specs: TaskSpecStore

  constructor(private readonly owner: OrchestrationDb) {
    ensureAutopilotRuntimeSchema(owner.db)
    this.validations = getTaskValidationStore(owner)
    this.specs = getTaskSpecStore(owner)
  }

  recordVerdict(input: RecordVerdictInput): ValidationOutcome {
    const params = parseAutopilotInput(RecordVerdictInputSchema, input, 'validation verdict')
    assertNoSecretLikeText([params.resultSummary, params.notice], 'validation result')
    const { owner } = this
    return this.settle('autopilot_validation_verdict', params.validationId, (context) => {
      const { attempt, validation } = context
      if (params.verdict === 'pass') {
        assertPassIsSufficient(owner.db, context, params)
      }
      applyValidationVerdict(owner.db, {
        validationId: params.validationId,
        verdict: params.verdict,
        checks: params.checks,
        evidenceRefs: params.evidenceRefs,
        timestamp: params.timestamp
      })
      if (params.verdict === 'inconclusive') {
        markInconclusiveInOrca(owner, attempt, params.timestamp)
      } else if (params.verdict === 'pass') {
        completeAttemptInOrca(owner, attempt, {
          resultText: params.resultSummary ?? 'Validation passed.',
          timestamp: params.timestamp
        })
        recordReportFact(
          owner,
          attempt.dispatch,
          { outcome: 'succeeded', reportId: validation.validationId },
          params.timestamp
        )
      } else {
        this.failValidated(
          context,
          'validation_failed',
          params.resultSummary ?? 'Validation failed.',
          params.timestamp
        )
      }
      return this.filing(
        params.notice,
        params.verdict,
        params.verdict === 'pass' ? 'normal' : 'high'
      )
    })
  }

  /** The user or dot accepts an inconclusive result as done; the verdict stays inconclusive, the waiver is on record. */
  waive(input: WaiveInput): ValidationOutcome {
    const params = parseAutopilotInput(DecisionInputSchema, input, 'validation waiver')
    assertNoSecretLikeText([params.resultSummary, params.notice], 'validation result')
    const { owner } = this
    return this.settle(
      'autopilot_validation_waiver',
      params.validationId,
      ({ attempt, validation }) => {
        applyValidationWaiver(owner.db, {
          validationId: params.validationId,
          waiver: params.by,
          timestamp: params.timestamp
        })
        completeAttemptInOrca(owner, attempt, {
          resultText: params.resultSummary ?? `Validation waived by ${params.by}.`,
          timestamp: params.timestamp
        })
        recordReportFact(
          owner,
          attempt.dispatch,
          { outcome: 'succeeded', reportId: validation.validationId },
          params.timestamp
        )
        return this.filing(params.notice, 'waived', 'normal')
      }
    )
  }

  /** The user or dot declines an inconclusive result: the validation fails and so does the task. */
  reject(input: RejectInput): ValidationOutcome {
    const params = parseAutopilotInput(DecisionInputSchema, input, 'validation rejection')
    assertNoSecretLikeText([params.resultSummary, params.notice], 'validation result')
    return this.settle('autopilot_validation_rejection', params.validationId, (context) => {
      const { validation } = context
      if (validation.verdict !== 'inconclusive') {
        throw conflict('Only an inconclusive validation can be rejected.')
      }
      applyValidationVerdict(this.owner.db, {
        validationId: validation.validationId,
        verdict: 'fail',
        checks: [
          ...validation.checks,
          { kind: 'user_decision', status: 'fail', note: `Rejected by ${params.by}.` }
        ],
        evidenceRefs: validation.evidenceRefs,
        timestamp: params.timestamp
      })
      this.failValidated(
        context,
        'validation_rejected',
        params.resultSummary ?? `Validation rejected by ${params.by}.`,
        params.timestamp
      )
      return this.filing(params.notice, 'rejected', 'high')
    })
  }

  private failValidated(
    context: Context,
    reason: string,
    resultText: string,
    timestamp: string
  ): void {
    const { attempt, validation } = context
    failAttemptInOrca(this.owner, attempt, {
      reason,
      stage: APP_ATTEMPT_STAGES.settled,
      resultText,
      timestamp
    })
    recordReportFact(
      this.owner,
      attempt.dispatch,
      { outcome: 'failed', reportId: validation.validationId },
      timestamp
    )
  }

  private filing(
    notice: AttemptNotice | undefined,
    name: string,
    priority: 'normal' | 'high'
  ): Filing | null {
    return notice ? { notice, name, priority } : null
  }

  /** Loads the validation and its attempt, checks both are still open, runs the change, and returns both. */
  private settle(
    savepoint: string,
    validationId: string,
    change: (context: Context) => Filing | null
  ): ValidationOutcome {
    return runAutopilotWrite(this.owner.db, savepoint, () => {
      const validation = this.validations.get(validationId)
      if (!validation) {
        throw new OrchestrationError(
          'autopilot_validation_not_found',
          'The validation was not found.'
        )
      }
      const attempt = loadAttempt(this.owner, validation.dispatchId)
      if (!['pending', 'inconclusive'].includes(validation.verdict) || validation.waiver !== null) {
        throw conflict('The validation is already settled or was waived.')
      }
      expectAttempt(attempt, {
        dispatch: ['dispatched'],
        worker: ['ready'],
        stage: APP_ATTEMPT_AWAITING_VALIDATION_STAGES,
        task: ['blocked']
      })
      const spec = this.specs.get(validation.taskId)
      if (!spec) {
        throw new OrchestrationError('autopilot_recovery_required', 'The TaskSpec row disappeared.')
      }
      const filing = change({ validation, attempt, spec })
      const message = filing
        ? fileAttemptNotice(this.owner, attempt.dispatch, filing.notice, filing)
        : null
      const settled = this.validations.get(validationId)
      if (!settled) {
        throw new OrchestrationError(
          'autopilot_recovery_required',
          'The validation row disappeared.'
        )
      }
      return {
        validation: settled,
        attempt: readAttemptView(this.owner, attempt.dispatch.id, message)
      }
    })
  }
}
