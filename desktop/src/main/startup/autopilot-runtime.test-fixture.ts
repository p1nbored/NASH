// FIXTURE_ONLY: fake builders for the autopilot runtime install. Nothing here opens a database,
// a file, a process or a socket; every runtime is a stub that records the order it was used in.
import { vi } from 'vitest'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import { registerPermissionRelay } from '../runtime/permission-relay/permission-relay-registry'
import type { PermissionRelayService } from '../runtime/permission-relay/permission-request-service'
import { getTaskClassificationRuntime } from '../runtime/task-classification/classification-runtime'
import type { TaskClassificationRuntime } from '../runtime/task-classification/classification-runtime'
import type { TaskExecutionRuntime } from '../runtime/task-execution/task-execution-runtime'
import type { ValidationRunner } from '../runtime/task-validation/validation-runner'
import {
  setWorkbenchRoutingRuntime,
  type WorkbenchRoutingRuntime
} from '../runtime/workbench-routing/workbench-routing-runtime'
import {
  getPrimarySessionRuntime,
  type PrimarySessionRuntime
} from '../runtime/workflow-run/primary-session-runtime'
import type { RoutingTableContext } from '../routing-table/routing-table-context'
import type { RoutingTableRuntime } from '../routing-table/routing-table-runtime'
import type { AutopilotRuntimeBuilders } from './autopilot-runtime-builders'

/** One cast for every stub: each test reads only the members its stub defines. */
function stub<T>(value: object): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: fixture stubs define every member the exercised wiring reads.
  return value as T
}

export type FakeBuilderName = keyof AutopilotRuntimeBuilders

export type FakeAutopilot = {
  readonly calls: string[]
  readonly runtime: OrcaRuntimeService
  readonly owner: OrchestrationDb
  readonly builders: AutopilotRuntimeBuilders
  readonly classifier: TaskClassificationRuntime
  readonly primary: PrimarySessionRuntime
  readonly execution: TaskExecutionRuntime
  readonly validation: ValidationRunner
  readonly routingContext: RoutingTableContext
  /** What the stubs saw in the registries when they were called. */
  readonly seen: Record<string, unknown>
  /** Releases the will-quit waits of the executors and the launches. */
  readonly release: { executors(): void; launches(): void; validation(): void; remote(): void }
}

export type FakeAutopilotOptions = {
  /** The builder that throws, as a broken install step would. */
  readonly fail?: FakeBuilderName
  /** Resolves the primary-session reconcile only when the test says so. */
  readonly reconcile?: Promise<void>
  /** Keeps the will-quit waits open until released. */
  readonly holdQuit?: boolean
  /** Keeps the remote access stop (its final outbox flush) open until released. */
  readonly holdRemote?: boolean
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** A launch attempt's outcome as data, so a refused one is never an unhandled rejection. */
export function launchOutcome(): Promise<{ ok: true } | { ok: false; code: string }> | null {
  const runs = getPrimarySessionRuntime()
  if (runs === null) {
    return null
  }
  return runs.startWorkflowRun(stub({})).then(
    () => ({ ok: true }),
    (error: unknown) => ({
      ok: false,
      code: error instanceof OrchestrationError ? error.code : 'not_an_orchestration_error'
    })
  )
}

function failingIf(options: FakeAutopilotOptions, name: FakeBuilderName): void {
  if (options.fail === name) {
    throw new OrchestrationError('fixture_install_failed', `Fixture: ${name} failed.`)
  }
}

export function createFakeAutopilot(options: FakeAutopilotOptions = {}): FakeAutopilot {
  const calls: string[] = []
  const seen: Record<string, unknown> = {}
  const executorsQuit = deferred()
  const launchesQuit = deferred()
  const validationQuit = deferred()
  const remoteQuit = deferred()
  if (!options.holdRemote) {
    remoteQuit.resolve()
  }
  if (!options.holdQuit) {
    executorsQuit.resolve()
    launchesQuit.resolve()
    validationQuit.resolve()
  }
  const record = (name: string) => () => {
    calls.push(name)
  }
  const runtime = stub<OrcaRuntimeService>({
    installDotIngressEnabledReader: vi.fn((reader: () => boolean) => {
      calls.push('runtime.installDotIngressEnabledReader')
      seen.dotReader = reader
    }),
    requireDotIngressControl: vi.fn(() => {
      throw new OrchestrationError('workbench_dot_ingress_unavailable', 'Fixture: no server yet.')
    }),
    notifyMessageArrived: vi.fn()
  })
  const owner = stub<OrchestrationDb>({ fixtureOwner: true })
  const classifier = stub<TaskClassificationRuntime>({
    classify: vi.fn(),
    pending: vi.fn(() => null),
    cancel: vi.fn(() => false),
    abortAll: vi.fn(() => {
      calls.push('classifier.abortAll')
      return 0
    }),
    recoverInterrupted: vi.fn(() => {
      calls.push('classifier.recoverInterrupted')
      seen.classifierAtRecovery = getTaskClassificationRuntime()
      return { releasedReservations: 0, interruptedClassifications: 0 }
    })
  })
  const primary = stub<PrimarySessionRuntime>({
    startWorkflowRun: vi.fn(async () => ({ ok: true, fixture: 'started' })),
    stopPrimarySession: vi.fn(),
    readPrimarySessionStatus: vi.fn(async () => null),
    deliverRunMessage: vi.fn(),
    readRunOrigin: vi.fn(),
    notifyPrimaryStatusChanged: vi.fn(),
    reconcile: vi.fn(async () => {
      calls.push('primary.reconcile')
      seen.primaryAtReconcile = getPrimarySessionRuntime()
      await options.reconcile
      return {
        adopted: 0,
        verified: 0,
        unverified: 0,
        failedLaunches: 0,
        releasedBindings: 0,
        interruptedMessages: 0
      }
    }),
    dispose: vi.fn(record('primary.dispose'))
  })
  const execution = stub<TaskExecutionRuntime>({
    startTask: vi.fn(),
    stopPort: { stopExecutor: vi.fn() },
    abortAllForQuit: vi.fn(() => {
      calls.push('execution.abortAllForQuit')
      return executorsQuit.promise.then(record('execution.settled'))
    }),
    reconcileAfterRestart: vi.fn(() => {
      calls.push('execution.reconcileAfterRestart')
      return { startUnknown: [], stopUnknown: [], startFailed: [], skipped: [], failed: [] }
    }),
    readAttemptResult: vi.fn()
  })
  const validation = stub<ValidationRunner>({
    validatePending: vi.fn(async () => {
      calls.push('validation.validatePending')
      return []
    }),
    validateAttempt: vi.fn(async (dispatchId: string, signal?: AbortSignal) => {
      calls.push(`validation.validateAttempt:${dispatchId}`)
      await Promise.race([
        validationQuit.promise,
        new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()))
      ])
      return { dispatchId, outcome: 'skipped', reason: 'fixture' }
    })
  })
  const clefRuntime = stub<WorkbenchRoutingRuntime>({
    abortAllRouting: vi.fn(() => {
      calls.push('clef.abortAllRouting')
      return 0
    })
  })
  const routingContext = stub<RoutingTableContext>({ fixtureContext: true })
  const routingRuntime = stub<RoutingTableRuntime>({
    resolver: {},
    evaluator: { invalidate: vi.fn(record('routing.invalidate')) },
    activeTable: vi.fn()
  })
  const builders: AutopilotRuntimeBuilders = {
    ensureWorkbenchSchema: () => {
      calls.push('ensureWorkbenchSchema')
      failingIf(options, 'ensureWorkbenchSchema')
    },
    ensureAutopilotSchema: () => {
      calls.push('ensureAutopilotSchema')
      failingIf(options, 'ensureAutopilotSchema')
    },
    ensureDotSchema: () => {
      calls.push('ensureDotSchema')
      failingIf(options, 'ensureDotSchema')
    },
    installClefAdministration: () => {
      calls.push('installClefAdministration')
      failingIf(options, 'installClefAdministration')
      setWorkbenchRoutingRuntime(clefRuntime)
      return {
        runtime: clefRuntime,
        classifier: stub({ fixtureClefPorts: true }),
        uninstall: () => {
          setWorkbenchRoutingRuntime(null)
          calls.push('clef.uninstall')
        }
      }
    },
    createRoutingTable: () => {
      calls.push('createRoutingTable')
      failingIf(options, 'createRoutingTable')
      return { context: routingContext, runtime: routingRuntime }
    },
    createClassifier: () => {
      calls.push('createClassifier')
      failingIf(options, 'createClassifier')
      return classifier
    },
    createPrimarySessions: () => {
      calls.push('createPrimarySessions')
      failingIf(options, 'createPrimarySessions')
      return primary
    },
    createExecution: () => {
      calls.push('createExecution')
      failingIf(options, 'createExecution')
      seen.launchBeforeOpen = launchOutcome()
      return execution
    },
    createValidation: () => {
      calls.push('createValidation')
      failingIf(options, 'createValidation')
      return validation
    },
    installPermissionRelay: (input) => {
      calls.push('installPermissionRelay')
      failingIf(options, 'installPermissionRelay')
      const unregister = registerPermissionRelay(input.runtime, stub<PermissionRelayService>({}))
      return () => {
        unregister()
        calls.push('relay.uninstall')
      }
    },
    reconcileLaunches: () => {
      calls.push('reconcileLaunches')
      failingIf(options, 'reconcileLaunches')
      return { launched: 0, blocked: 0, canceled: 0, skipped: 0 }
    },
    recoverDotIntake: async (input) => {
      calls.push('recoverDotIntake')
      failingIf(options, 'recoverDotIntake')
      seen.recoveryDoor = input.door
      seen.launchAfterOpen = launchOutcome()
      return { submitted: 0, failed: 0, pending: 0 }
    },
    settleLaunches: () => {
      calls.push('settleLaunches')
      return launchesQuit.promise.then(record('launches.settled'))
    },
    ensureDotRemoteSchema: () => {
      calls.push('ensureDotRemoteSchema')
      failingIf(options, 'ensureDotRemoteSchema')
    },
    createDotRemote: (input) => {
      calls.push('createDotRemote')
      failingIf(options, 'createDotRemote')
      seen.dotRemoteInput = input
      return {
        start: record('dotRemote.start'),
        stop: () => {
          calls.push('dotRemote.stop')
          return remoteQuit.promise.then(record('dotRemote.flushed'))
        },
        uninstall: record('dotRemote.uninstall')
      }
    }
  }
  return {
    calls,
    runtime,
    owner,
    builders,
    classifier,
    primary,
    execution,
    validation,
    routingContext,
    seen,
    release: {
      executors: executorsQuit.resolve,
      launches: launchesQuit.resolve,
      validation: validationQuit.resolve,
      remote: remoteQuit.resolve
    }
  }
}
