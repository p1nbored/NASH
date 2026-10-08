import { DOT_INGRESS_RATE_WINDOW_MS } from '../../../shared/dot-ingress/dot-ingress-limits'
import type {
  DotValidationDecideOutcome,
  DotValidationDecision
} from '../../../shared/dot-ingress/dot-ingress-validation'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { getTaskValidationStore } from '../orchestration/db/task-validation-store'
import {
  createValidationDecisionService,
  type ValidationDecisionService
} from '../task-validation/validation-decision-service'
import type { DotIngressServiceDeps } from './dot-ingress-ports'
import { dotRefusal, orchestrationCodeOf, requireDotInterfaceOn } from './dot-ingress-refusals'
import { findDotRequestOfRun, hasAppTable } from './dot-ingress-run-link'
import {
  getDotValidationLedger,
  type DotValidationLedgerEntry
} from './dot-ingress-validation-ledger'
import {
  dotValidationSettlement,
  readDotValidationViews,
  type DotValidationPage
} from './dot-ingress-validation-reads'

// G7: dot lists and decides the inconclusive validations of runs it started. Every waive or reject
// goes through G6's decision service with `by: 'dot'` (which re-checks that dot started the run and
// files the same notice to the primary); this module adds only the dot rails: the interface switch,
// the user's caps, the decisionId ledger and the dot error codes.

export type DotValidationDecided = {
  readonly decisionId: string
  readonly validationId: string
  readonly dotRequestId: string
  readonly outcome: DotValidationDecideOutcome
  readonly decidedAt: string | null
  readonly duplicate: boolean
}

type DecideInput = {
  readonly decisionId: string
  readonly validationId: string
  readonly decision: DotValidationDecision
}

/** Codes that mean "no decision of dot waits here"; existence is never revealed to dot. */
const NOT_FOUND_CODES: ReadonlySet<string> = new Set([
  'autopilot_validation_not_found',
  'autopilot_validation_decision_not_owned'
])
/** Codes that mean the decision stopped waiting before this call: decided by someone, or closed. */
const SETTLED_CODES: ReadonlySet<string> = new Set([
  'autopilot_validation_conflict',
  'autopilot_attempt_conflict'
])

function decisionsOf(deps: DotIngressServiceDeps): ValidationDecisionService {
  return createValidationDecisionService({
    owner: deps.db,
    now: deps.now,
    announce: (message) => deps.announce(message)
  })
}

function notFound(): Error {
  return dotRefusal('dot_validation_not_found')
}

export function listDotValidations(
  deps: DotIngressServiceDeps,
  input: { readonly dotRequestId?: string; readonly limit: number }
): DotValidationPage {
  requireDotInterfaceOn(deps.db)
  return readDotValidationViews(deps.db, decisionsOf(deps), input)
}

/** The dot request whose run the validation belongs to, once it has a result to decide. */
function requestOfValidation(deps: DotIngressServiceDeps, validationId: string): string {
  const record = hasAppTable(deps.db, 'task_validations')
    ? getTaskValidationStore(deps.db).get(validationId)
    : null
  const runId = record ? deps.db.getDispatchContextById(record.dispatchId)?.run_id : undefined
  const request =
    record?.verdict !== 'pending' && runId ? findDotRequestOfRun(deps.db, runId) : null
  if (!request) {
    throw notFound()
  }
  return request.dotRequestId
}

/** The submission caps the user set, counted separately over the decisions dot recorded. */
function requireWithinCaps(deps: DotIngressServiceDeps): void {
  const { ratePerMinute, ratePerUtcDay } = getDotIngressSettingsStore(deps.db).getSettings()
  const ledger = getDotValidationLedger(deps.db)
  const now = deps.now()
  const minuteStart = new Date(now.getTime() - DOT_INGRESS_RATE_WINDOW_MS).toISOString()
  if (ledger.countRecordedSince(minuteStart, false) >= ratePerMinute) {
    throw dotRefusal('dot_rate_limited', { window: 'minute' })
  }
  const dayStart = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`
  if (ledger.countRecordedSince(dayStart, true) >= ratePerUtcDay) {
    throw dotRefusal('dot_rate_limited', { window: 'utc_day' })
  }
}

async function settle(
  deps: DotIngressServiceDeps,
  input: DecideInput
): Promise<Pick<DotValidationDecided, 'outcome' | 'decidedAt'>> {
  try {
    await decisionsOf(deps).decide({
      validationId: input.validationId,
      decision: input.decision,
      by: 'dot'
    })
  } catch (error) {
    const code = orchestrationCodeOf(error) ?? ''
    if (NOT_FOUND_CODES.has(code)) {
      throw notFound()
    }
    if (!SETTLED_CODES.has(code)) {
      throw error
    }
    const settled = dotValidationSettlement(deps.db, input.validationId)
    return settled.outcome === 'closed'
      ? { outcome: 'closed', decidedAt: null }
      : { outcome: 'already_decided', decidedAt: settled.decidedAt }
  }
  const decided = dotValidationSettlement(deps.db, input.validationId)
  return { outcome: 'decided', decidedAt: decided.decidedAt ?? deps.now().toISOString() }
}

function answerOf(entry: DotValidationLedgerEntry, duplicate: boolean): DotValidationDecided {
  const { decisionId, validationId, dotRequestId, outcome, decidedAt } = entry
  return { decisionId, validationId, dotRequestId, outcome, decidedAt, duplicate }
}

/** The first outcome of this decision id, or a refusal when the same id came with another payload. */
function replayOf(first: DotValidationLedgerEntry, input: DecideInput): DotValidationDecided {
  if (first.validationId !== input.validationId || first.decision !== input.decision) {
    throw dotRefusal('dot_idempotency_conflict')
  }
  return answerOf(first, true)
}

/** Waives or rejects once per decisionId; a replay answers the first outcome, another payload is refused. */
export async function decideDotValidation(
  deps: DotIngressServiceDeps,
  input: DecideInput
): Promise<DotValidationDecided> {
  requireDotInterfaceOn(deps.db)
  const ledger = getDotValidationLedger(deps.db)
  const first = ledger.get(input.decisionId)
  if (first) {
    return replayOf(first, input)
  }
  const dotRequestId = requestOfValidation(deps, input.validationId)
  requireWithinCaps(deps)
  const settled = await settle(deps, input)
  const entry: DotValidationLedgerEntry = {
    ...input,
    dotRequestId,
    ...settled,
    recordedAt: deps.now().toISOString()
  }
  // Why keep-first: a concurrent call with the same id may have recorded while the decision ran.
  const stored = ledger.recordFirst(entry)
  return stored === entry ? answerOf(entry, false) : replayOf(stored, input)
}
