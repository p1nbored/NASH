import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { WorkflowRunStatus } from '../../../../orchestration/db/workflow-run-transition'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import type { RunRow } from '../../../../orchestration/types'
import type { OrchestrationCompatibilityCallerAuthority } from '../../../../runtime-terminal-contracts'
import { resolveAppRunPrimary } from '../../../../workflow-run/app-run-primary'
import { appRunReadersFor, NO_APP_RUNS } from '../../../../workflow-run/app-run-readers'
import { adoptNativeCoordinator } from '../../../../workflow-run/native-coordinator-adoption'
import { getPrimarySessionStore } from '../../../../orchestration/db/primary-session-store'
import type { RpcContext } from '../../../core'
import { resolveRunScope } from '../runs/run-scope'
import { AUTOPILOT_TASK_API_ERROR_CODES, autopilotRefusal } from './autopilot-task-api'

/** The primary session of an app run, as the request's attested pane proves it. */
export type AutopilotPrimaryCaller = Readonly<{
  runId: string
  ownerId: string
  terminalHandle: string
  paneKey: string
  processIncarnation: string
  /** Orca's consumer generation of the run, recorded on the tasks the primary creates. */
  runGeneration: number
  runStatus: WorkflowRunStatus
}>

function refused(reason: string): OrchestrationError {
  return autopilotRefusal(
    AUTOPILOT_TASK_API_ERROR_CODES.callerRefused,
    'Only the primary session of an app run can use this command.',
    { reason }
  )
}

// Why the attested handle: no param names the caller, so Orca's run binding is checked for the pane
// the request evidence proves, never for a declared one.
function boundRun(
  runtime: OrcaRuntimeService,
  context: Pick<RpcContext, 'orchestrationCompatibilityEvidence'>,
  authority: OrchestrationCompatibilityCallerAuthority
): RunRow {
  try {
    return resolveRunScope(runtime, {
      callerTerminalHandle: authority.terminalHandle,
      callerPaneKey: authority.paneKey,
      callerEvidence: context.orchestrationCompatibilityEvidence,
      callerSession: undefined,
      requireCurrentConsumer: true
    })
  } catch (error) {
    throw refused(error instanceof OrchestrationError ? error.code : 'run_scope_failed')
  }
}

/**
 * Accepts only the attested pane of the live primary of an app run: Orca's own run binding for that
 * pane (resolveRunScope), then the shared app-run primary check (workflow_runs row, live owner pane,
 * same process the app launched). A database that never held an app run is refused without any
 * table being created.
 */
export function resolveAutopilotPrimaryCaller(
  runtime: OrcaRuntimeService,
  context: Pick<RpcContext, 'orchestrationCompatibilityEvidence' | 'orchestrationCaller'>,
  options: { requireActiveRun: boolean }
): AutopilotPrimaryCaller {
  if (context.orchestrationCaller) {
    throw refused('session_caller')
  }
  const evidence = context.orchestrationCompatibilityEvidence
  const authority = evidence ? runtime.verifyOrchestrationCompatibilityCaller(evidence) : null
  if (!authority) {
    throw refused('not_attested')
  }
  const db = runtime.getOrchestrationDb()
  const run = boundRun(runtime, context, authority)
  let readers = appRunReadersFor(db)
  if (
    readers === NO_APP_RUNS ||
    !readers.findAppRun(run.id) ||
    !getPrimarySessionStore(db).findLiveByRun(run.id)
  ) {
    adoptNativeCoordinator(runtime, authority, { runId: run.id })
    readers = appRunReadersFor(db)
  }
  const resolved = resolveAppRunPrimary(db, readers, authority, { runId: run.id })
  if (!resolved.ok) {
    throw refused(resolved.refusal)
  }
  const runStatus = resolved.primary.run.status
  if (options.requireActiveRun && runStatus !== 'active') {
    throw autopilotRefusal(
      'autopilot_run_not_live',
      `Run ${run.id} is ${runStatus}; this command needs an active run.`,
      { runStatus }
    )
  }
  return Object.freeze({
    runId: run.id,
    ownerId: resolved.primary.ownerId,
    terminalHandle: authority.terminalHandle,
    paneKey: authority.paneKey,
    processIncarnation: authority.processIncarnation,
    runGeneration: run.consumer_generation,
    runStatus
  })
}
