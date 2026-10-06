import type { AgentLaunchIntent, AgentLaunchResult } from '../../../shared/agent-launch-intent'
import { trackTerminalSpawnDispatch } from '../../agent-launch/agent-launch-not-started'
import type { AgentLaunchSurfaceFactory } from '../../agent-launch/agent-launch-surface-factories'
import type { OrchestrationDb } from '../orchestration/db'
import {
  getPrimarySessionStore,
  type PrimarySessionRecord
} from '../orchestration/db/primary-session-store'
import type { WorkflowRunRecord } from '../orchestration/db/workflow-run-store'
import type { PrimarySessionLaunchPlan } from './primary-session-launch-plan'
import {
  blockedLaunch,
  createLaunchSettlement,
  type ExecutingAdmission,
  type Launching,
  type PrimarySessionLaunchOutcome
} from './primary-session-launch-settlement'
import {
  mintPrimaryLaunchOperationId,
  type PrimaryLaunchLedgerPort
} from './primary-session-ledger'
import { resolvePrimaryPermissionMode } from './primary-session-permission'
import {
  clockTimestamp,
  errorCodeOf,
  launchBlocker,
  type PrimaryTerminalPort
} from './primary-session-ports'
import {
  PRIMARY_SESSION_LAUNCH_SOURCE,
  createPrimarySessionSurfaces
} from './primary-session-surfaces'
import type { PrimarySessionResult, SubagentRouteRowInput } from './primary-session-types'

export type { PrimarySessionLaunchOutcome } from './primary-session-launch-settlement'

export type PreparePrimaryLaunchRequest = {
  readonly runId: string
  readonly generation: number
  readonly access: WorkflowRunRecord['requestedAccess']
  readonly deliverableLanguage: string | null
  readonly objective: string
  readonly model: string
  readonly effort: string
  readonly routeRows: readonly SubagentRouteRowInput[]
  /** Where the session starts; Claude Code reads the project's own settings there. */
  readonly workspacePath: string
}

export type PrimarySessionLauncherDeps = {
  readonly db: OrchestrationDb
  readonly terminal: PrimaryTerminalPort
  readonly ledger: PrimaryLaunchLedgerPort
  /** `executeAgentLaunch` with a runtime whose settings force a terminal (bound by the runtime module). */
  executeLaunch(args: {
    intent: AgentLaunchIntent
    surfaces: AgentLaunchSurfaceFactory
  }): Promise<AgentLaunchResult>
  /** `preparePrimarySessionLaunch` bound to the user data path, platform, CLI name and settings. */
  prepare(request: PreparePrimaryLaunchRequest): PrimarySessionResult<PrimarySessionLaunchPlan>
  /** `deliverTerminalAgentLaunchPrompt`, for a prompt that does not ride argv (too long, or Windows). */
  deliverAfterStart(args: { handle: string; text: string }): Promise<boolean>
  /** Stops a session whose launch prompt did not land; `stopped` only when the pane is gone. */
  stopUndelivered(owner: PrimarySessionRecord): Promise<'stopped' | 'stop_unconfirmed'>
  readonly exitWatches?: { watch(owner: PrimarySessionRecord): void }
  readonly clock: { now(): number }
  /** 32 lowercase hex characters per call. */
  entropy(): string
}

export type PrimarySessionLaunchRequest = {
  readonly run: WorkflowRunRecord
  readonly objective: string
  readonly workspacePath: string
  readonly routeRows: readonly SubagentRouteRowInput[]
}

function intentFor(
  request: PrimarySessionLaunchRequest,
  plan: PrimarySessionLaunchPlan
): AgentLaunchIntent {
  return {
    agent: 'claude',
    target: {
      kind: 'existing',
      worktree: request.run.workspaceId,
      workspacePath: request.workspacePath
    },
    ...(plan.prompt.delivery === 'launch_argument'
      ? { prompt: { text: plan.prompt.text, delivery: 'submit' as const } }
      : {}),
    sessionOptions: plan.sessionOptions,
    agentArgs: plan.agentArgs,
    launchSource: PRIMARY_SESSION_LAUNCH_SOURCE
  }
}

/** One visible Claude Code primary per run (D-016): launched once, never relaunched on an unknown outcome. */
export function createPrimarySessionLauncher(deps: PrimarySessionLauncherDeps) {
  const { db, terminal } = deps
  const inFlight = new Map<string, Promise<PrimarySessionLaunchOutcome>>()
  const settlement = createLaunchSettlement(deps)

  function insertOwner(
    run: WorkflowRunRecord
  ): { readonly owner: PrimarySessionRecord } | PrimarySessionLaunchOutcome {
    const mode = resolvePrimaryPermissionMode(run.requestedAccess)
    if (!mode.ok) {
      return blockedLaunch(
        launchBlocker('launch_refused', mode.refusal.code, mode.refusal.detail),
        run,
        null
      )
    }
    try {
      const owner = getPrimarySessionStore(db).insertStarting({
        runId: run.runId,
        launchOperationId: mintPrimaryLaunchOperationId(deps.clock.now(), deps.entropy()),
        permissionMode: mode.value,
        requestedModel: run.coordinatorModel,
        requestedEffort: run.coordinatorEffort,
        timestamp: clockTimestamp(deps.clock)
      })
      return { owner }
    } catch (error) {
      return blockedLaunch(
        launchBlocker(
          'launch_refused',
          errorCodeOf(error),
          'The primary session could not be recorded.'
        ),
        run,
        null
      )
    }
  }

  type Admitted = {
    readonly plan: PrimarySessionLaunchPlan
    readonly intent: AgentLaunchIntent
    readonly admission: ExecutingAdmission
  }

  /** Everything before the spawn: a refusal or a throw here means nothing was started. */
  async function prepareAndAdmit(
    request: PrimarySessionLaunchRequest,
    launching: Launching
  ): Promise<Admitted | PrimarySessionLaunchOutcome> {
    const { run, owner } = launching
    const plan = deps.prepare({
      runId: run.runId,
      generation: owner.generation,
      access: run.requestedAccess,
      deliverableLanguage: run.deliverableLanguage,
      objective: request.objective,
      model: run.coordinatorModel,
      effort: run.coordinatorEffort,
      routeRows: request.routeRows,
      workspacePath: request.workspacePath
    })
    if (!plan.ok) {
      return settlement.refuseNoEffects(launching, plan.refusal.code, plan.refusal.detail)
    }
    const intent = intentFor(request, plan.value)
    const admission = await deps.ledger.admit(intent, owner.launchOperationId)
    if (admission.decision === 'refuse') {
      return settlement.refuseNoEffects(
        launching,
        admission.code,
        'The launch ledger refused the operation.'
      )
    }
    return { plan: plan.value, intent, admission }
  }

  /** The terminal never left: the ledger is told, and its own failure does not hide the cause. */
  async function refuseUnsent(
    launching: Launching,
    admission: ExecutingAdmission,
    code: string
  ): Promise<PrimarySessionLaunchOutcome> {
    try {
      await admission.fail(code)
    } catch (error) {
      console.warn(
        `[primary-session] the launch ledger did not record a failed spawn: ${errorCodeOf(error)}`
      )
    }
    return settlement.refuseNoEffects(
      launching,
      code,
      'The terminal could not be created; nothing was started.'
    )
  }

  function outcomeUnknown(launching: Launching, message: string): PrimarySessionLaunchOutcome {
    return settlement.markUnknown(
      launching,
      'launch_outcome_unknown',
      launchBlocker('launch_unverifiable', 'autopilot_launch_outcome_unknown', message)
    )
  }

  async function dispatchLaunch(
    launching: Launching,
    admitted: Admitted
  ): Promise<PrimarySessionLaunchOutcome> {
    const { plan, intent, admission } = admitted
    const spawn = trackTerminalSpawnDispatch()
    let result: AgentLaunchResult
    try {
      result = await deps.executeLaunch({
        intent,
        surfaces: createPrimarySessionSurfaces(terminal, spawn)
      })
    } catch (error) {
      const code = errorCodeOf(error)
      if (spawn.failedBeforeDispatch(error) || code === 'autopilot_launch_structured_refused') {
        return refuseUnsent(launching, admission, code)
      }
      return outcomeUnknown(
        launching,
        'The launch failed after the terminal was requested; it is not retried.'
      )
    }
    try {
      return await settlement.settleStarted(launching, plan, admission, result)
    } catch {
      return outcomeUnknown(
        launching,
        'The session started, but recording it failed; it is not retried.'
      )
    }
  }

  async function launchOnce(
    request: PrimarySessionLaunchRequest
  ): Promise<PrimarySessionLaunchOutcome> {
    const run = request.run
    if (run.status !== 'launching') {
      return blockedLaunch(
        launchBlocker(
          'launch_refused',
          'autopilot_launch_run_not_launching',
          'Only a launching run can start its primary session.'
        ),
        run,
        null
      )
    }
    const inserted = insertOwner(run)
    if ('ok' in inserted) {
      return inserted
    }
    const launching = { run, owner: inserted.owner }
    // Why each step is caught: a throw would leave the owner starting and the run launching.
    let admitted: Admitted | PrimarySessionLaunchOutcome
    try {
      admitted = await prepareAndAdmit(request, launching)
    } catch (error) {
      return settlement.refuseNoEffects(
        launching,
        errorCodeOf(error),
        'The launch could not be prepared; nothing was started.'
      )
    }
    if ('ok' in admitted) {
      return admitted
    }
    try {
      return await dispatchLaunch(launching, admitted)
    } catch {
      return outcomeUnknown(
        launching,
        'The launch failed after it was admitted; it is not retried.'
      )
    }
  }

  return {
    /** Single flight per run: a second call while one runs joins it. */
    launch(request: PrimarySessionLaunchRequest): Promise<PrimarySessionLaunchOutcome> {
      const runId = request.run.runId
      const existing = inFlight.get(runId)
      if (existing) {
        return existing
      }
      const attempt = launchOnce(request).finally(() => inFlight.delete(runId))
      inFlight.set(runId, attempt)
      return attempt
    }
  }
}
