import type { DotIntakeDoor } from '../runtime/dot-ingress/dot-ingress-ports'
import { getDotIngressSettingsStore } from '../runtime/orchestration/db/dot-ingress-settings-store'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import { registerAutopilotTaskApi } from '../runtime/rpc/methods/orchestration/autopilot/autopilot-task-api'
import type { TaskExecutionRuntime } from '../runtime/task-execution/task-execution-runtime'
import { cancelWorkbenchRequest } from '../runtime/workbench-intake-submit'
import { requirePart, type AutopilotInstallContext } from './autopilot-install-context'
import type { ValidationScheduler } from './autopilot-validation-scheduler'

// Steps 8 to 11 of the D-016 install order: the task API, opening run launches, the launch
// reconcile, dot intake recovery, and the dot interface switch reader.

/** A process attempt is validated once it settled; an in-session one once task-report claims it. */
function startTaskValidating(
  execution: TaskExecutionRuntime,
  validation: ValidationScheduler
): TaskExecutionRuntime['startTask'] {
  return async (input) => {
    const start = await execution.startTask(input)
    if (start.view.delegated) {
      void start.settled.then(
        () => validation.validateAttempt(start.view.dispatchId),
        // Why ignored: the attempt's settlement records its own failure; there is nothing to validate.
        () => undefined
      )
    }
    return start
  }
}

export function installTaskApi(context: AutopilotInstallContext): void {
  const { parts, log } = context
  const execution = requirePart(parts.execution, 'execution runtime')
  const validation = requirePart(parts.validation, 'validation scheduler')
  parts.unregisterTaskApi = registerAutopilotTaskApi(context.runtime, {
    startTask: startTaskValidating(execution, validation),
    readAttemptResult: (dispatchId) => execution.readAttemptResult(dispatchId),
    afterClaim: (claim) => validation.validateAttempt(claim.dispatchId),
    cliCommand: context.cliCommand,
    now: context.now,
    log: ({ event, ...ids }) => log({ event: 'task_api_event', detail: event, ...ids })
  })
}

/** Runs start only now: the task API, the relay and the validators a run needs are all in. */
export function openRunLaunches(context: AutopilotInstallContext): void {
  requirePart(context.parts.gate, 'launch gate').open()
}

export function reconcileLaunches(context: AutopilotInstallContext): void {
  context.builders.reconcileLaunches(context.owner)
}

/**
 * Records a recovered dot request but launches nothing: no agent CLI may start while the app starts.
 * The second reconcile then settles each recorded request from its (absent) run record.
 */
export const RECORDING_INTAKE_DOOR: DotIntakeDoor = {
  submit: (target, params) => target.store.submit(target.principalId, params, target.workspace),
  cancel: (target, params) => cancelWorkbenchRequest(target, params)
}

export async function recoverDotIntake(context: AutopilotInstallContext): Promise<void> {
  await context.builders.recoverDotIntake({
    runtime: context.runtime,
    door: RECORDING_INTAKE_DOOR
  })
  context.builders.reconcileLaunches(context.owner)
}

function isDotIngressUnavailable(error: unknown): boolean {
  return error instanceof OrchestrationError && error.code === 'workbench_dot_ingress_unavailable'
}

/** After the dot endpoint: remote items reach NASH only through that endpoint and its checks. */
export function installDotRemote(context: AutopilotInstallContext): void {
  const { ports } = context
  const remote = context.builders.createDotRemote({
    runtime: context.runtime,
    owner: context.owner,
    userDataPath: context.userDataPath,
    credentials: ports.dotRemote.credentials,
    appVersion: ports.dotRemote.appVersion,
    log: context.log
  })
  context.parts.dotRemote = remote
  remote.start()
}

/** The endpoint may open only once intake recovery and run launches are in place. */
export async function installDotIngress(context: AutopilotInstallContext): Promise<void> {
  const { owner, runtime } = context
  runtime.installDotIngressEnabledReader(
    () => getDotIngressSettingsStore(owner).getSettings().enabled
  )
  context.parts.dotReaderInstalled = true
  let control: ReturnType<typeof runtime.requireDotIngressControl>
  try {
    control = runtime.requireDotIngressControl()
  } catch (error) {
    if (isDotIngressUnavailable(error)) {
      // Why: the RPC server starts after this install, and its start aligns the endpoint itself.
      return
    }
    throw error
  }
  await control.sync()
}
