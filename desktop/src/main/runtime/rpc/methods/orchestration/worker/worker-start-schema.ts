import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { RunRow, TaskRow } from '../../../../orchestration/types'
import type {
  OrchestrationCallerIdentity,
  OrchestrationSessionCaller
} from '../../../../orchestration/orchestration-caller-identity'
import type { WorkerStartModeReceipt } from '../../orchestration-worker-start-mode'
import type { z } from 'zod'
import { WorkerStartParams } from '../../../../../../shared/rpc-contract/orchestration-worker-start-params'
export { OptionalWorkerLaunchPreference } from '../../../../../../shared/rpc-contract/orchestration-worker-start-params'
export { WorkerStartParams }

export type WorkerStartInput = z.infer<typeof WorkerStartParams>

type WorkerStartMutation = {
  callerFingerprint: string
  requestId: string
  method: string
  payloadHash: string
}

export type LocalWorkerStartInput = {
  params: WorkerStartInput
  taskAccess?: 'read_only' | 'workspace_write'
  taskBrief?: string
  routeId?: string
  assertCanStart?: () => void
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  run: RunRow
  coordinator: OrchestrationCallerIdentity | null
  callerSession?: OrchestrationSessionCaller
  existingTask?: TaskRow
  orchestrationMutation?: WorkerStartMutation
  /** Settings-driven; the executing host still gets to refuse below. */
  mode: WorkerStartModeReceipt
}
