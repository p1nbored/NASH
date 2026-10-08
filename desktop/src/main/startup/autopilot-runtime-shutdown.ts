import {
  getTaskClassificationRuntime,
  setTaskClassificationRuntime
} from '../runtime/task-classification/classification-runtime'
import {
  getPrimarySessionRuntime,
  setPrimarySessionRuntime
} from '../runtime/workflow-run/primary-session-runtime'
import type { AutopilotInstallContext } from './autopilot-install-context'
import { installFailureCode } from './autopilot-install-runner'

// Will-quit, in three phases. 1: fence (no launch, task command, classification or dot intake
// starts). 2: wait, bounded, for launches and validations to
// settle while the database and the primary runtime stay up. 3: dispose and unregister the rest.

export type AutopilotShutdownReport = {
  /** What had not settled when the bounded wait ended: 'launches', 'validations' or 'dotRemote'. */
  readonly pending: readonly string[]
}

type Settling = { readonly name: string; readonly promise: Promise<unknown> }

/** One teardown action; a throwing one is logged by code and the rest still run. */
function guarded(context: AutopilotInstallContext, step: string, action: () => void): void {
  try {
    action()
  } catch (error) {
    context.log({ event: 'shutdown_step_failed', step, code: installFailureCode(error) })
  }
}

function settlingOf(
  context: AutopilotInstallContext,
  name: string,
  start: () => Promise<unknown>
): Settling[] {
  try {
    return [{ name, promise: start() }]
  } catch (error) {
    context.log({ event: 'shutdown_step_failed', step: name, code: installFailureCode(error) })
    return []
  }
}

function fence(context: AutopilotInstallContext): Settling[] {
  const { parts, runtime } = context
  const { classifier, validation, dotRemote } = parts
  // Why first: no remote item may be leased while the app quits; its outbox flushes within the wait.
  const remote = dotRemote ? settlingOf(context, 'dotRemote', () => dotRemote.stop()) : []
  guarded(context, 'gate', () => parts.gate?.close())
  guarded(context, 'taskApi', () => parts.unregisterTaskApi?.())
  if (classifier) {
    guarded(context, 'classifier', () => {
      classifier.abortAll()
      if (getTaskClassificationRuntime() === classifier) {
        setTaskClassificationRuntime(null)
      }
    })
  }
  guarded(context, 'validation', () => validation?.abort())
  guarded(context, 'clefAdministration', () => parts.clef?.runtime.abortAllRouting())
  const launches = settlingOf(context, 'launches', () => context.builders.settleLaunches())
  const validations = validation ? [{ name: 'validations', promise: validation.drain() }] : []
  if (parts.dotReaderInstalled) {
    // Why: a server that aligns the endpoint again now closes it.
    guarded(context, 'dotIngress', () => runtime.installDotIngressEnabledReader(() => false))
  }
  return [...remote, ...launches, ...validations]
}

/** Resolves with the names that had not settled when the wait ended; a rejection counts as settled. */
async function settleWithin(settling: readonly Settling[], waitMs: number): Promise<string[]> {
  const settled = new Set<string>()
  const all = Promise.all(
    settling.map(({ name, promise }) =>
      promise.then(
        () => settled.add(name),
        () => settled.add(name)
      )
    )
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs)
    timer.unref?.()
  })
  await Promise.race([all, deadline])
  clearTimeout(timer)
  return settling.map(({ name }) => name).filter((name) => !settled.has(name))
}

function dispose(context: AutopilotInstallContext): void {
  const { parts } = context
  const { primary, gate } = parts
  guarded(context, 'dotRemote', () => parts.dotRemote?.uninstall())
  if (primary) {
    guarded(context, 'primarySessions', () => {
      if (gate && getPrimarySessionRuntime() === gate.runtime) {
        setPrimarySessionRuntime(null)
      }
      primary.dispose()
    })
  }
  guarded(context, 'permissionRelay', () => parts.uninstallRelay?.())
  guarded(context, 'validation', () => parts.unregisterValidationBacklog?.())
  guarded(context, 'accountChanges', () => parts.unwatchAccountChanges?.())
  guarded(context, 'routingTable', () => parts.unregisterRoutingContext?.())
  guarded(context, 'clefAdministration', () => parts.clef?.uninstall())
}

export async function shutdownAutopilotRuntime(
  context: AutopilotInstallContext,
  waitMs: number
): Promise<AutopilotShutdownReport> {
  const settling = fence(context)
  const pending = await settleWithin(settling, waitMs)
  if (pending.length > 0) {
    context.log({ event: 'shutdown_pending', missing: pending })
  }
  dispose(context)
  return { pending }
}
