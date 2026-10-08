import { isEquivalentPaneKey } from '../orchestration/db/pane-key-match'
import { releaseOrchestrationWorker } from '../rpc/methods/orchestration/worker/worker-release'
import { workspaceKindForWorktreeId } from '../../../shared/workspace-launch-kind'
import { randomUUID } from 'node:crypto'
import { stopOrchestrationWorker } from '../rpc/methods/orchestration/worker/worker-stop'
import { isNativeTaskAttempt } from '../workflow-run/app-run-policy'
import { withStructuredNativeChatDisabled } from '../workflow-run/primary-session-preflight'
import type { OrcaRuntimeService } from '../orca-runtime'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getTaskSpecStore } from '../orchestration/db/task-spec-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { orchestrationCallerIdentity } from '../rpc/methods/orchestration/runs/run-scope'
import { startLocalWorker } from '../rpc/methods/orchestration/worker/local-worker-start'
import { assertWorkerStartTaskSpecWithinPromptBudget } from '../rpc/methods/orchestration/worker/worker-start-prompt-budget'
import {
  decideWorkerStartMode,
  readWorkerStartModeSettings
} from '../rpc/methods/orchestration-worker-start-mode'
import type { TaskStart, TaskStartInput } from './task-start-service'
import type { DelegatedRoute } from './task-start-route'

const pendingStarts = new WeakMap<OrcaRuntimeService, Map<string, Set<Promise<TaskStart>>>>()

export async function startRoutedNativeWorker(
  runtime: OrcaRuntimeService,
  input: TaskStartInput,
  route: DelegatedRoute
): Promise<TaskStart> {
  const runId = runtime.getOrchestrationDb().getTask(input.taskId)?.run_id
  if (!runId) {
    throw new OrchestrationError('task_not_found', 'The task was not found.')
  }
  let runs = pendingStarts.get(runtime)
  if (!runs) {
    runs = new Map()
    pendingStarts.set(runtime, runs)
  }
  let starts = runs.get(runId)
  if (!starts) {
    starts = new Set()
    runs.set(runId, starts)
  }
  const start = startWorker(runtime, input, route)
  starts.add(start)
  try {
    return await start
  } finally {
    starts.delete(start)
    if (starts.size === 0) {
      runs.delete(runId)
    }
  }
}

/** Only adapts a checked route and TaskSpec; Orca owns launch, context delivery and reporting. */
async function startWorker(
  runtime: OrcaRuntimeService,
  input: TaskStartInput,
  route: DelegatedRoute
): Promise<TaskStart> {
  const db = runtime.getOrchestrationDb()
  const task = db.getTask(input.taskId)
  const spec = getTaskSpecStore(db).get(input.taskId)
  const run = task ? db.getRun(task.run_id) : undefined
  if (!task || !spec || !run || input.creator.kind !== 'terminal') {
    throw new OrchestrationError('consumer_fenced', 'A routed worker needs its active primary.')
  }
  const creator = input.creator
  const coordinator = orchestrationCallerIdentity(runtime, {
    handle: creator.handle,
    paneKey: creator.paneKey,
    session: undefined
  })
  const assertCanStart = () => {
    const workflow = getWorkflowRunStore(db).get(run.id)
    const primary = getPrimarySessionStore(db).findLiveByRun(run.id)
    if (
      workflow?.status !== 'active' ||
      primary?.state !== 'running' ||
      !primary.paneKey ||
      !creator.paneKey ||
      !isEquivalentPaneKey(primary.paneKey, creator.paneKey) ||
      runtime.getTerminalProcessIncarnation(creator.handle) !== creator.processIncarnation
    ) {
      throw new OrchestrationError(
        'autopilot_run_not_live',
        'The primary no longer owns an active run.'
      )
    }
  }
  assertCanStart()
  const access =
    spec.accessNeed === 'read_only' ||
    getWorkflowRunStore(db).get(run.id)?.requestedAccess === 'read_only'
      ? 'read_only'
      : 'workspace_write'
  const brief = [
    task.spec,
    'Expected outputs:',
    ...spec.expectedOutputs.map((item) => `- ${item}`),
    'Acceptance criteria:',
    ...spec.acceptanceCriteria.map((item) => `- ${item}`),
    'Constraints:',
    ...spec.constraints.map((item) => `- ${item}`),
    access === 'read_only'
      ? 'This task is read-only. Do not create, change or delete files or run mutating commands.'
      : 'Change only the files needed for this task in the assigned workspace.',
    'Use English for coordination messages and reports; follow the task objective when choosing artifact language.',
    'Ask the primary through the run mailbox if further delegation is needed; it keeps classification and routing.'
  ].join('\n')
  await assertWorkerStartTaskSpecWithinPromptBudget(brief)
  const workflow = getWorkflowRunStore(db).get(run.id)!
  const isolated =
    access === 'workspace_write' && workspaceKindForWorktreeId(workflow.workspaceId) !== 'folder'
  const baseBranch = isolated
    ? (await runtime.showManagedWorktree(`id:${workflow.workspaceId}`)).branch
    : undefined
  const params = {
    from: creator.handle,
    task: task.id,
    run: run.id,
    agent:
      route.target === 'codex_cli'
        ? 'codex'
        : route.target === 'claude_subagent'
          ? 'claude'
          : 'antigravity',
    model: route.availability.cli.model,
    ...(route.availability.cli.effort === null ? {} : { effort: route.availability.cli.effort }),
    ...(isolated
      ? {
          worktree: 'new-child',
          baseBranch,
          name: `task-${task.id}-${randomUUID().slice(0, 8)}`,
          setup: 'skip' as const
        }
      : {}),
    retryOf: input.retryOf,
    timeoutMs: 60_000
  }
  const receipt = await startLocalWorker({
    runtime,
    db,
    run,
    coordinator,
    existingTask: task,
    params,
    orchestrationMutation: input.mutationReceipt,
    // Permission relay hooks require a terminal CLI until structured approval callbacks are bridged.
    mode: decideWorkerStartMode({
      params,
      settings: withStructuredNativeChatDisabled(readWorkerStartModeSettings(runtime) ?? {})
    }),
    taskAccess: access,
    taskBrief: brief,
    routeId: route.routeId,
    assertCanStart
  })
  const dispatch = db.getDispatchContextById(receipt.dispatchId)!
  const worker = db.getWorkerDispatch(dispatch.id)!
  const cli = runtime.getTerminalOrchestrationCliCommand(creator.handle)
  return {
    view: {
      taskId: task.id,
      dispatchId: dispatch.id,
      routeId: route.routeId,
      target: route.target,
      delegated: true,
      runsIn: 'process',
      nativeWorker: true,
      taskStatus: db.getTask(task.id)!.status,
      workerState: worker.state,
      instruction: `NASH worker ${dispatch.id} is ${worker.state}. Read its report with '${cli} orchestration task-show --task ${task.id} --json' and messages with '${cli} orchestration check'. Do not task-report on its behalf.`
    },
    // Native readiness is not task completion; worker reports own the later settlement.
    settled: Promise.resolve()
  }
}

export async function stopNativeRunWorkers(
  runtime: OrcaRuntimeService,
  runId: string
): Promise<void> {
  // The primary is already stopped: pending launches either finish or fail their ownership check.
  const starting = pendingStarts.get(runtime)?.get(runId)
  if (starting) {
    await Promise.allSettled(starting)
  }
  const db = runtime.getOrchestrationDb()
  const rows = db.db
    .prepare(`SELECT w.dispatch_id FROM worker_dispatches w
    JOIN dispatch_contexts d ON d.id = w.dispatch_id WHERE d.run_id = ?`)
    .all(runId)
  let unconfirmed = false
  for (const row of rows) {
    const dispatchId = String(row.dispatch_id)
    if (!isNativeTaskAttempt(db, dispatchId)) {
      continue
    }
    try {
      const worker = db.getWorkerDispatch(dispatchId)!
      if (!['succeeded', 'failed', 'stopped', 'abandoned'].includes(worker.state)) {
        await stopOrchestrationWorker(
          runtime,
          { dispatch: dispatchId },
          { requestId: randomUUID() }
        )
        if (db.getWorkerDispatch(dispatchId)?.state !== 'stopped') {
          throw new OrchestrationError(
            'workbench_run_stop_unconfirmed',
            'A worker could not be confirmed stopped. The run remains open.'
          )
        }
      }
      const resource = db.getWorkerTerminalResourceByOwner(dispatchId)
      if (resource?.ownership_state === 'owned') {
        const released = await releaseOrchestrationWorker(
          runtime,
          { dispatch: dispatchId },
          { requestId: randomUUID() }
        )
        if (released.state !== 'released' && released.state !== 'already_released') {
          throw new OrchestrationError(
            'workbench_run_stop_unconfirmed',
            'A worker terminal could not be released. The run remains open.'
          )
        }
      }
    } catch (error) {
      unconfirmed = true
      console.warn('[orchestration] native worker stop unconfirmed', dispatchId, error)
    }
  }
  if (unconfirmed) {
    throw new OrchestrationError(
      'workbench_run_stop_unconfirmed',
      'Some workers could not be confirmed stopped. The run remains open for cleanup.'
    )
  }
}
