// FIXTURE_ONLY: every id, pane, token, hash and model below is synthetic and describes no real run.
import { vi } from 'vitest'
import type { OrchestrationCompatibilityEvidence } from '../../../../../../shared/orchestration-compatibility-evidence'
import type { AutopilotTaskSpec } from '../../../../../../shared/rpc-contract/orchestration-autopilot-params'
import { OrcaRuntimeService } from '../../../../orca-runtime'
import { OrchestrationDb } from '../../../../orchestration/db'
import { getAppAttemptSettlement } from '../../../../orchestration/db/app-attempt-settlement'
import { seedRoutedTask } from '../../../../orchestration/db/app-attempt-routing.test-fixture'
import { fixtureTime } from '../../../../orchestration/db/autopilot-runtime.test-fixture'
import { ensureWorkbenchRequestSchema } from '../../../../orchestration/db/workbench-request-schema'
import { getWorkflowRunStore } from '../../../../orchestration/db/workflow-run-store'
import type { WorkflowRunStatus } from '../../../../orchestration/db/workflow-run-transition'
import type { OrchestrationCompatibilityCallerAuthority } from '../../../../runtime-terminal-contracts'
import type { AttemptResultView } from '../../../../task-execution/executor-result-view'
import type { TaskStart, TaskStartInput } from '../../../../task-execution/task-start-service'
import {
  PRIMARY_PANE_KEY,
  markRunAsAppRun
} from '../../../../workflow-run/app-run-policy.test-fixture'
import type { RpcContext } from '../../../core'
import {
  registerAutopilotTaskApi,
  type AutopilotClaim,
  type AutopilotClassifierPort,
  type AutopilotTaskApiLogEvent
} from './autopilot-task-api'

export const PRIMARY_HANDLE = 'terminal_primary01'
export const PRIMARY_PANE = PRIMARY_PANE_KEY
export const PRIMARY_EVIDENCE: OrchestrationCompatibilityEvidence = {
  terminalHandle: PRIMARY_HANDLE,
  paneKey: PRIMARY_PANE,
  launchToken: 'fixture-launch-token'
}
export const FIXTURE_START_MS = Date.parse('2026-10-05T00:10:00.000Z')

export const FIXTURE_SPEC: AutopilotTaskSpec = {
  objective: 'Summarize the layout of the `src` folder in a short report.',
  expectedOutputs: ['A report named `report.md`.'],
  acceptanceCriteria: ['The report names every top-level folder.'],
  machineChecks: [{ kind: 'artifact_exists', path: 'report.md' }]
}

export type FakeClassifier = AutopilotClassifierPort & { classified: string[] }

function fakeClassifier(): FakeClassifier {
  const pending = new Map<string, ReturnType<AutopilotClassifierPort['classify']>>()
  const classified: string[] = []
  return {
    classified,
    classify: (taskId) => {
      classified.push(taskId)
      const handle = { status: 'pending' as const, taskId, settled: new Promise<never>(() => {}) }
      pending.set(taskId, handle)
      return handle
    },
    pending: (taskId) => pending.get(taskId) ?? null
  }
}

export function primaryAuthority(
  runId: string,
  overrides: Partial<OrchestrationCompatibilityCallerAuthority> = {}
): OrchestrationCompatibilityCallerAuthority {
  return {
    hostScope: { kind: 'local', hostId: 'local' },
    paneKey: PRIMARY_PANE,
    terminalHandle: PRIMARY_HANDLE,
    processIncarnation: `incarnation_${runId}`,
    launchTokenHash: 'f'.repeat(64),
    ...overrides
  }
}

function startView(input: TaskStartInput): TaskStart {
  return {
    view: {
      taskId: input.taskId,
      dispatchId: 'ctx_fixture',
      routeId: 'route_fixture',
      target: 'codex_cli',
      delegated: true,
      runsIn: 'process',
      taskStatus: 'dispatched',
      workerState: 'ready',
      instruction: 'Attempt `ctx_fixture` runs in the Codex CLI as an app process.'
    },
    settled: Promise.resolve()
  }
}

function fakePorts(clock: { ms: number }, classifier: { current: FakeClassifier | null }) {
  return {
    startTask: vi.fn<(input: TaskStartInput) => Promise<TaskStart>>(async (input) =>
      startView(input)
    ),
    readAttemptResult: vi.fn<(dispatchId: string) => Promise<AttemptResultView>>(async () => ({
      state: 'no_result'
    })),
    classifier: () => classifier.current,
    afterClaim: vi.fn<(claim: AutopilotClaim) => void>(),
    afterRunCompleted: vi.fn<(runId: string) => void>(),
    cliCommand: 'nash',
    now: () => clock.ms,
    sleep: vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(async (ms) => {
      clock.ms += ms
    }),
    log: vi.fn<(event: AutopilotTaskApiLogEvent) => void>()
  }
}

export type FakePorts = ReturnType<typeof fakePorts>

export type HarnessOptions = {
  runStatus?: WorkflowRunStatus
  appRun?: boolean
  ownerPane?: string
}

export type TaskApiHarness = {
  db: OrchestrationDb
  runtime: OrcaRuntimeService
  runId: string
  classifier: FakeClassifier
  ports: FakePorts
  context: RpcContext
  notify: ReturnType<typeof spyRuntime>
  clock: { ms: number }
  setAuthority(next: OrchestrationCompatibilityCallerAuthority | null): void
  setClassifier(next: FakeClassifier | null): void
  close(): void
}

function spyRuntime(
  runtime: OrcaRuntimeService,
  read: () => OrchestrationCompatibilityCallerAuthority | null
) {
  vi.spyOn(runtime, 'verifyOrchestrationCompatibilityCaller').mockImplementation((evidence) =>
    evidence?.launchToken === PRIMARY_EVIDENCE.launchToken ? read() : null
  )
  vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
    handle === PRIMARY_HANDLE ? PRIMARY_PANE : null
  )
  vi.spyOn(runtime, 'getNestedWorkerMaxDepth').mockReturnValue(3)
  vi.spyOn(runtime, 'getRuntimeId').mockReturnValue('runtime_fixture')
  return vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => undefined)
}

/** One Orca run bound to the primary's pane, recorded as an app run with a running owner. */
export function createTaskApiHarness(options: HarnessOptions = {}): TaskApiHarness {
  const db = new OrchestrationDb(':memory:')
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  const run = db.createRun({
    objective: 'Fixture run objective.',
    coordinatorHandle: PRIMARY_HANDLE,
    coordinatorPaneKey: PRIMARY_PANE
  })
  if (options.appRun !== false) {
    ensureWorkbenchRequestSchema(db.db)
    markRunAsAppRun(db, {
      runId: run.id,
      status: options.runStatus ?? 'active',
      paneKey: options.ownerPane ?? PRIMARY_PANE
    })
  }
  let authority: OrchestrationCompatibilityCallerAuthority | null = primaryAuthority(run.id)
  const notify = spyRuntime(runtime, () => authority)
  const initialClassifier = fakeClassifier()
  const classifier: { current: FakeClassifier | null } = { current: initialClassifier }
  const clock = { ms: FIXTURE_START_MS }
  const ports = fakePorts(clock, classifier)
  const unregister = registerAutopilotTaskApi(runtime, ports)
  return {
    db,
    runtime,
    runId: run.id,
    classifier: initialClassifier,
    ports,
    context: { runtime, orchestrationCompatibilityEvidence: PRIMARY_EVIDENCE },
    notify,
    clock,
    setAuthority: (next) => {
      authority = next
    },
    setClassifier: (next) => {
      classifier.current = next
    },
    close: () => {
      unregister()
      db.close()
      vi.restoreAllMocks()
    }
  }
}

/** Moves the app run along its edge list, as run-complete or a failure would. */
export function moveRun(harness: TaskApiHarness, to: WorkflowRunStatus): void {
  const runs = getWorkflowRunStore(harness.db)
  const run = runs.get(harness.runId)
  if (!run) {
    throw new Error('fixture run vanished')
  }
  runs.transition({
    runId: run.runId,
    from: run.status,
    to,
    expectedRevision: run.revision,
    reason: to === 'failed' || to === 'canceled' || to === 'unverifiable' ? 'fixture_reason' : null,
    timestamp: fixtureTime(20)
  })
}

/** A routed task whose in-session attempt is running, as task-start leaves a subagent attempt. */
export function seedInSessionAttempt(harness: TaskApiHarness): {
  taskId: string
  dispatchId: string
} {
  const { taskId, routeId } = seedRoutedTask(
    { owner: harness.db, runId: harness.runId },
    { route: { target: 'claude_subagent', model: 'claude-sonnet-5-5' } }
  )
  const settlement = getAppAttemptSettlement(harness.db)
  const started = settlement.start({
    taskId,
    routeId,
    executor: 'in_session',
    creator: { kind: 'system' },
    maxDepth: 3,
    timestamp: fixtureTime(5)
  })
  settlement.markRunning({ dispatchId: started.dispatchId, timestamp: fixtureTime(6) })
  return { taskId, dispatchId: started.dispatchId }
}
