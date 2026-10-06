import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { LoadedAttempt } from './app-attempt-load'
import type { TaskSpecRecord } from './task-spec-record'
import type { TaskValidationRecord } from './task-validation-record'

// The store's own check that a pass stands on the evidence its policy promises, whatever the caller.

/** Mirrors the validators' default checks (D-027), so a pass can never claim less than they run. */
const DEFAULT_PROCESS_CHECK_KINDS: readonly string[] = ['executor_completed', 'secret_scan_clean']
const SESSION_REPORT_CHECK_KINDS: readonly string[] = ['session_report']
const SESSION_REPORT_CLAIM = 'session_report_claim'
/** Only these in-session targets pass on the primary's report; restriction 27 stays for the rest. */
const REPORT_PASSES_TARGETS: readonly string[] = ['claude_subagent', 'claude_workflow']

type PassVerdict = {
  readonly checks: readonly { kind: string; status: string }[]
  readonly evidenceRefs: readonly { kind: string }[]
}

function insufficient(message: string): OrchestrationError {
  return new OrchestrationError('autopilot_validation_insufficient', message)
}

function startsWith(kinds: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((kind, index) => kinds[index] === kind)
}

function sameKinds(kinds: readonly string[], expected: readonly string[]): boolean {
  return kinds.length === expected.length && startsWith(kinds, expected)
}

function routeTargetOf(db: Database.Database, routeId: string): string | null {
  const row = db.prepare('SELECT target FROM task_routes WHERE route_id = ?').get(routeId)
  return typeof row?.target === 'string' ? row.target : null
}

/** D-027 default: the process check for a process attempt, the report claim for a subagent or workflow. */
function assertDefaultPass(
  db: Database.Database,
  attempt: Pick<LoadedAttempt, 'kind' | 'routeId'>,
  kinds: readonly string[],
  verdict: PassVerdict
): void {
  if (attempt.kind === 'process') {
    if (!sameKinds(kinds, DEFAULT_PROCESS_CHECK_KINDS)) {
      throw insufficient('A pass without machine checks must stand on the process check.')
    }
    return
  }
  const target = routeTargetOf(db, attempt.routeId)
  if (!target || !REPORT_PASSES_TARGETS.includes(target)) {
    throw insufficient('A task the primary session did itself cannot pass on its own report.')
  }
  const claimed = verdict.evidenceRefs.some((ref) => ref.kind === SESSION_REPORT_CLAIM)
  if (!sameKinds(kinds, SESSION_REPORT_CHECK_KINDS) || !claimed) {
    throw insufficient('A pass on the session report must name that report as its claim.')
  }
}

/**
 * A pass must stand on the same evidence the policy promises: every machine check of the TaskSpec
 * ran, in order, and passed; a review adds at least one passing check after them; a TaskSpec with
 * neither passes only on its default check (D-027); and something is on record to check it against.
 */
export function assertPassIsSufficient(
  db: Database.Database,
  context: {
    readonly spec: TaskSpecRecord
    readonly validation: TaskValidationRecord
    readonly attempt: Pick<LoadedAttempt, 'kind' | 'routeId'>
  },
  verdict: PassVerdict
): void {
  const { spec, validation, attempt } = context
  if (verdict.evidenceRefs.length === 0) {
    throw insufficient('A pass needs evidence to point at.')
  }
  if (verdict.checks.some((check) => check.status !== 'pass')) {
    throw insufficient('Every check of a pass must have passed.')
  }
  const kinds = verdict.checks.map((check) => check.kind)
  const specKinds = spec.machineChecks.map((check) => check.kind)
  if (validation.policy === 'model_review') {
    if (kinds.length <= specKinds.length || !startsWith(kinds, specKinds)) {
      throw insufficient('A review pass needs the machine checks, in order, and a passing review.')
    }
    return
  }
  if (specKinds.length > 0) {
    if (!sameKinds(kinds, specKinds)) {
      throw insufficient('A pass must cover every machine check of the TaskSpec, in order.')
    }
    return
  }
  assertDefaultPass(db, attempt, kinds, verdict)
}
