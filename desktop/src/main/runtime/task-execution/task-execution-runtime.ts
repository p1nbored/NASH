import type { OrchestrationDb } from '../orchestration/db'
import { readAttemptResult, type AttemptResultView } from './executor-result-view'
import {
  createTaskStartService,
  type TaskStartService,
  type TaskStartDeps
} from './task-start-service'
import type { RouteRecheckPort } from './task-start-route'
import type { TaskExecutionLogEvent } from './task-execution-ports'

export type TaskExecutionRuntimePorts = {
  readonly startWorker: TaskStartDeps['startWorker']
  readonly owner: OrchestrationDb
  readonly routes: RouteRecheckPort
  readonly now: () => number
  readonly cliCommand: string
  readonly log: (event: TaskExecutionLogEvent) => void
}

export type TaskExecutionRuntime = {
  readonly startTask: TaskStartService['startTask']
  readAttemptResult(dispatchId: string): Promise<AttemptResultView>
}

/** Native workers own process lifecycle, restart reconciliation and reports. */
export function createTaskExecutionRuntime(ports: TaskExecutionRuntimePorts): TaskExecutionRuntime {
  const service = createTaskStartService({
    owner: ports.owner,
    startWorker: ports.startWorker,
    routes: ports.routes,
    now: ports.now,
    cliCommand: ports.cliCommand,
    log: ports.log
  })
  return {
    startTask: service.startTask,
    readAttemptResult: (dispatchId) => readAttemptResult({ owner: ports.owner }, dispatchId)
  }
}
