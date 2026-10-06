import { defineMethod } from '../../../core'
import type { GateStatus } from '../../../../orchestration/db'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { resolveRunScope } from '../runs/run-scope'
import { taskNotFoundError } from '../../../../orchestration/task-dispatch-refusal'
import { orchestrationMigrationData } from '../../../../../../shared/orchestration-rpc-contract'
import {
  GateCreateParams,
  GateListParams,
  GateResolveParams,
  RunParams,
  RunStopParams
} from '../../../../../../shared/rpc-contract/orchestration-gates-params'

// Why: the Claude Code primary session plans and dispatches; the Orca coordinator loop is gone, so a
// retired call must refuse with no effect even if a caller path skipped the dispatcher's fence.
function refuseRetiredCoordinatorLoop(): never {
  throw new OrchestrationError(
    'orchestration_migration_required',
    'The Orca coordinator loop is retired; the Claude Code primary session plans and dispatches. No effects were applied.',
    orchestrationMigrationData('command_retired')
  )
}

export const ORCHESTRATION_GATE_METHODS = [
  // Why: the names stay registered so an old client reads orchestration_migration_required, not method_not_found.
  defineMethod({
    name: 'orchestration.run',
    params: RunParams,
    handler: refuseRetiredCoordinatorLoop
  }),

  defineMethod({
    name: 'orchestration.runStop',
    params: RunStopParams,
    handler: refuseRetiredCoordinatorLoop
  }),

  defineMethod({
    name: 'orchestration.gateCreate',
    params: GateCreateParams,
    handler: (
      params,
      { orchestrationCompatibilityEvidence, orchestrationCaller, runtime, legacyCoordinatorRunId }
    ) => {
      const db = runtime.getOrchestrationDb()
      let options: string[] | undefined
      if (params.options) {
        try {
          const parsed = JSON.parse(params.options)
          if (!Array.isArray(parsed) || !parsed.every((option) => typeof option === 'string')) {
            throw new Error('not an array of strings')
          }
          options = parsed
        } catch {
          throw new Error('Invalid --options: must be a JSON array of strings')
        }
      }
      const task = db.getTask(params.task)
      if (!task) {
        throw new Error(`Task not found: ${params.task}`)
      }
      const run = resolveRunScope(runtime, {
        runId: params.run,
        callerTerminalHandle: params.from,
        requireCurrentConsumer: true,
        legacyCoordinatorRunId,
        callerEvidence: orchestrationCompatibilityEvidence,
        callerSession: orchestrationCaller
      })
      if (task.run_id !== run.id) {
        throw taskNotFoundError(`Task ${params.task} was not found in Run ${run.id}.`, {
          taskId: params.task,
          runId: run.id
        })
      }
      const gate = db.createGate({
        taskId: params.task,
        question: params.question,
        options
      })
      return { gate }
    }
  }),

  defineMethod({
    name: 'orchestration.gateResolve',
    params: GateResolveParams,
    handler: (
      params,
      { orchestrationCompatibilityEvidence, orchestrationCaller, runtime, legacyCoordinatorRunId }
    ) => {
      const db = runtime.getOrchestrationDb()
      const existing = db.getGate(params.id)
      if (!existing) {
        throw new Error(`Gate not found: ${params.id}`)
      }
      const run = resolveRunScope(runtime, {
        runId: params.run,
        callerTerminalHandle: params.from,
        requireCurrentConsumer: true,
        legacyCoordinatorRunId,
        callerEvidence: orchestrationCompatibilityEvidence,
        callerSession: orchestrationCaller
      })
      // Why: a gate outside the caller's Run is indistinguishable from a missing one, so probing cannot map foreign Runs.
      if (existing.run_id !== run.id) {
        throw new Error(`Gate not found: ${params.id}`)
      }
      const gate = db.resolveGate(params.id, params.resolution)
      if (!gate) {
        throw new Error(`Gate not found: ${params.id}`)
      }
      return { gate }
    }
  }),

  defineMethod({
    name: 'orchestration.gateList',
    params: GateListParams,
    handler: (
      params,
      { orchestrationCompatibilityEvidence, orchestrationCaller, runtime, legacyCoordinatorRunId }
    ) => {
      const db = runtime.getOrchestrationDb()
      const explicitRun = params.run ? db.getRun(params.run) : undefined
      // Why: same read posture as taskList — an explicitly named Run is inspectable, an unnamed one means the caller's own.
      const run =
        explicitRun?.legacy === 1
          ? explicitRun
          : resolveRunScope(runtime, {
              runId: params.run,
              callerTerminalHandle: params.from,
              requireCurrentConsumer: params.run === undefined,
              legacyCoordinatorRunId,
              callerEvidence: orchestrationCompatibilityEvidence,
              callerSession: orchestrationCaller
            })
      const gates = db
        .listGates({
          taskId: params.task,
          status: params.status as GateStatus
        })
        .filter((gate) => gate.run_id === run.id)
      return { runId: run.id, gates, count: gates.length }
    }
  })
]
