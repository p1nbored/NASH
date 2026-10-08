import { setTaskClassificationRuntime } from '../runtime/task-classification/classification-runtime'
import { registerValidationBacklogPort } from '../runtime/task-validation/validation-backlog-port'
import { registerRoutingTableContext } from '../runtime/workbench-run/routing-table-context-registry'
import { setPrimarySessionRuntime } from '../runtime/workflow-run/primary-session-runtime'
import { createClassificationNotice } from './autopilot-classification-notice'
import { requirePart, type AutopilotInstallContext } from './autopilot-install-context'
import { installFailureCode } from './autopilot-install-runner'
import { createLaunchGate } from './autopilot-launch-gate'
import { createValidationScheduler } from './autopilot-validation-scheduler'

// Steps 1 to 7 of the D-016 install order: schemas, Clef administration, the routing table, the
// classifier, the primary sessions, execution, validation and the permission relay. Each recovery
// runs before its runtime is published, and a step publishes only once it fully succeeded.

export function installSchemas(
  context: AutopilotInstallContext,
  schema: 'workbench' | 'autopilot' | 'dot'
): void {
  const { builders, owner } = context
  if (schema === 'workbench') {
    builders.ensureWorkbenchSchema(owner)
  } else if (schema === 'autopilot') {
    builders.ensureAutopilotSchema(owner)
  } else {
    builders.ensureDotSchema(owner)
  }
}

export function installClef(context: AutopilotInstallContext): void {
  const { ports } = context
  context.parts.clef = context.builders.installClefAdministration({
    owner: context.owner,
    userDataPath: context.userDataPath,
    credentials: ports.credentials,
    now: context.now,
    ...(ports.transport ? { transport: ports.transport } : {}),
    ...(ports.logFailure ? { logFailure: ports.logFailure } : {})
  })
}

export function installRoutingTable(context: AutopilotInstallContext): void {
  const build = context.builders.createRoutingTable({
    userDataPath: context.userDataPath,
    now: context.now
  })
  context.parts.unregisterRoutingContext = registerRoutingTableContext(
    context.runtime,
    build.context,
    build.runtime.resolver
  )
  // Why: a cached model listing or detection describes the account selected when it was read.
  context.parts.unwatchAccountChanges =
    context.ports.accountChanges?.subscribe(() => build.runtime.evaluator.invalidate()) ?? null
  context.parts.routing = build
}

export function installClassifier(context: AutopilotInstallContext): void {
  const { parts, log } = context
  const classifier = context.builders.createClassifier({
    owner: context.owner,
    clef: requirePart(parts.clef, 'Clef administration').classifier,
    routing: requirePart(parts.routing, 'routing table').runtime,
    now: context.now,
    onSettled: createClassificationNotice({
      owner: context.owner,
      cliCommand: context.cliCommand,
      announce: (message) => context.runtime.notifyMessageArrived(message.to_handle, message.type),
      log
    }),
    onFailure: (error) => log({ event: 'classification_failed', code: installFailureCode(error) })
  })
  // Why before publishing: a classification a crash interrupted is recorded as interrupted first.
  classifier.recoverInterrupted()
  setTaskClassificationRuntime(classifier)
  parts.classifier = classifier
}

export async function installPrimarySessions(
  context: AutopilotInstallContext,
  signal: AbortSignal
): Promise<void> {
  const primary = context.builders.createPrimarySessions({
    runtime: context.runtime,
    owner: context.owner,
    routing: requirePart(context.parts.routing, 'routing table').runtime,
    userDataPath: context.userDataPath
  })
  try {
    // Why before publishing: sessions and bindings an earlier run left are settled first.
    await primary.reconcile()
  } catch (error) {
    primary.dispose()
    throw error
  }
  if (signal.aborted) {
    // Why: the step already failed on its deadline; publishing now would half-wire the runs.
    primary.dispose()
    return
  }
  const gate = createLaunchGate(primary)
  setPrimarySessionRuntime(gate.runtime)
  context.parts.primary = primary
  context.parts.gate = gate
}

export function installExecution(context: AutopilotInstallContext): void {
  const execution = context.builders.createExecution({
    runtime: context.runtime,
    owner: context.owner,
    routing: requirePart(context.parts.routing, 'routing table').runtime,
    userDataPath: context.userDataPath,
    cliCommand: context.cliCommand,
    now: context.now,
    log: context.log
  })
  context.parts.execution = execution
}

export function installValidation(context: AutopilotInstallContext): void {
  const runner = context.builders.createValidation({
    runtime: context.runtime,
    owner: context.owner,
    routing: requirePart(context.parts.routing, 'routing table').runtime,
    userDataPath: context.userDataPath
  })
  const scheduler = createValidationScheduler({ runner, log: context.log })
  // Why the scheduler itself: the desktop's "Check now" must share the one-at-a-time queue.
  context.parts.unregisterValidationBacklog = registerValidationBacklogPort(
    context.runtime,
    scheduler
  )
  context.parts.validation = scheduler
}

export function installRelay(context: AutopilotInstallContext): void {
  context.parts.uninstallRelay = context.builders.installPermissionRelay({
    runtime: context.runtime,
    cliCommand: context.cliCommand
  })
}
