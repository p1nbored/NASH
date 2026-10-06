import type { AgentLaunchResult } from '../../../shared/agent-launch-intent'
import type { OrchestrationDb } from '../orchestration/db'
import {
  getPrimarySessionStore,
  type PrimarySessionRecord
} from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore, type WorkflowRunRecord } from '../orchestration/db/workflow-run-store'
import type { PrimarySessionLaunchPlan } from './primary-session-launch-plan'
import type { PrimaryLaunchAdmission } from './primary-session-ledger'
import { moveOwner, moveWorkflowRun } from './primary-session-moves'
import {
  clockTimestamp,
  launchBlocker,
  type PrimaryTerminalPort,
  type WorkflowRunLaunchBlocker
} from './primary-session-ports'

export type PrimarySessionLaunchOutcome =
  | { readonly ok: true; readonly run: WorkflowRunRecord; readonly owner: PrimarySessionRecord }
  | {
      readonly ok: false
      readonly blocker: WorkflowRunLaunchBlocker
      readonly run: WorkflowRunRecord
      readonly owner: PrimarySessionRecord | null
    }

export type Launching = {
  readonly run: WorkflowRunRecord
  readonly owner: PrimarySessionRecord
}

export type ExecutingAdmission = Extract<PrimaryLaunchAdmission, { decision: 'execute' }>

export type LaunchSettlementDeps = {
  readonly db: OrchestrationDb
  readonly terminal: Pick<
    PrimaryTerminalPort,
    'closeTerminal' | 'getTerminalProcessIncarnation' | 'getOrchestrationDispatchAuthority'
  >
  readonly clock: { now(): number }
  deliverAfterStart(args: { handle: string; text: string }): Promise<boolean>
  stopUndelivered(owner: PrimarySessionRecord): Promise<'stopped' | 'stop_unconfirmed'>
  readonly exitWatches?: { watch(owner: PrimarySessionRecord): void }
}

/** The owner receipt: how the launch ran, never the prompt or any argument value. */
function launchReceipt(
  result: AgentLaunchResult,
  plan: PrimarySessionLaunchPlan,
  ledger: ExecutingAdmission['ledger']
): Record<string, unknown> {
  return {
    mode: result.receipt.mode,
    reason: result.receipt.reason,
    outcome: result.outcome.kind,
    prompt: result.prompt?.outcome ?? null,
    promptDelivery: plan.prompt.delivery,
    permissionMode: plan.permissionMode,
    subagents: plan.subagentNames,
    ledger
  }
}

export function blockedLaunch(
  blocker: WorkflowRunLaunchBlocker,
  run: WorkflowRunRecord,
  owner: PrimarySessionRecord | null
): PrimarySessionLaunchOutcome {
  return { ok: false, blocker, run, owner }
}

/** How a launch ends: the owner and run move together, and an unknown outcome is never retried. */
export function createLaunchSettlement(deps: LaunchSettlementDeps) {
  const { db, terminal } = deps
  const now = () => clockTimestamp(deps.clock)

  function readBack(launching: Launching) {
    return {
      run: getWorkflowRunStore(db).get(launching.run.runId) ?? launching.run,
      owner: getPrimarySessionStore(db).get(launching.owner.ownerId)
    }
  }

  /** Provably nothing was started: the owner closes as no-effects and the run fails. */
  function refuseNoEffects(launching: Launching, code: string, message: string) {
    moveOwner(db, launching.owner.ownerId, 'stopped', 'launch_failed_no_effects', now())
    moveWorkflowRun(db, launching.run.runId, 'failed', 'launch_refused', now())
    const { run, owner } = readBack(launching)
    return blockedLaunch(launchBlocker('launch_refused', code, message), run, owner)
  }

  /** Something may have started: record unverifiable and never launch again. */
  function markUnknown(
    launching: Launching,
    reason: string,
    blocker: WorkflowRunLaunchBlocker
  ): PrimarySessionLaunchOutcome {
    moveOwner(db, launching.owner.ownerId, 'unverifiable', reason, now())
    moveWorkflowRun(db, launching.run.runId, 'unverifiable', reason, now())
    const { run, owner } = readBack(launching)
    return blockedLaunch(blocker, run, owner)
  }

  async function promptUndelivered(
    launching: Launching,
    owner: PrimarySessionRecord
  ): Promise<PrimarySessionLaunchOutcome> {
    const stop = await deps.stopUndelivered(owner)
    const to = stop === 'stopped' ? 'failed' : 'unverifiable'
    moveWorkflowRun(db, launching.run.runId, to, 'launch_prompt_undelivered', now())
    const back = readBack(launching)
    return blockedLaunch(
      launchBlocker(
        'launch_refused',
        'autopilot_launch_prompt_undelivered',
        'The session started but its prompt could not be delivered, so it was stopped.'
      ),
      back.run,
      back.owner
    )
  }

  /** After `executeAgentLaunch` returned: check the receipt, record identity, bind, activate. */
  async function settleStarted(
    launching: Launching,
    plan: PrimarySessionLaunchPlan,
    admission: ExecutingAdmission,
    result: AgentLaunchResult
  ): Promise<PrimarySessionLaunchOutcome> {
    const outcome = result.outcome
    const promptLanded =
      plan.prompt.delivery !== 'launch_argument' || result.prompt?.outcome === 'handed-to-terminal'
    if (
      outcome.kind !== 'terminal' ||
      result.receipt.mode !== 'terminal' ||
      !outcome.paneKey ||
      !promptLanded
    ) {
      await admission.fail('autopilot_launch_receipt_refused')
      if (outcome.kind === 'terminal') {
        await terminal.closeTerminal(outcome.handle).catch(() => undefined)
      }
      return markUnknown(
        launching,
        'launch_receipt_refused',
        launchBlocker(
          'launch_refused',
          'autopilot_launch_receipt_refused',
          'The launch did not start one visible terminal session with its prompt.'
        )
      )
    }
    const processIncarnation = terminal.getTerminalProcessIncarnation(outcome.handle)
    await admission.settle(result)
    if (processIncarnation === null) {
      return markUnknown(
        launching,
        'identity_unavailable',
        launchBlocker(
          'launch_unverifiable',
          'autopilot_launch_identity_unavailable',
          'The session started, but its process identity could not be read.'
        )
      )
    }
    const owner = getPrimarySessionStore(db).markRunning(launching.owner.ownerId, {
      terminalHandle: outcome.handle,
      paneKey: outcome.paneKey,
      processIncarnation,
      launchTokenSha256:
        terminal.getOrchestrationDispatchAuthority(outcome.handle)?.launchTokenHash ?? null,
      launchLedger: admission.ledger,
      receipt: launchReceipt(result, plan, admission.ledger),
      timestamp: now()
    })
    db.bindRun({
      runId: launching.run.runId,
      coordinatorHandle: outcome.handle,
      coordinatorPaneKey: outcome.paneKey
    })
    if (
      plan.prompt.delivery === 'after_start_paste' &&
      !(await deps.deliverAfterStart({ handle: outcome.handle, text: plan.prompt.text }))
    ) {
      return promptUndelivered(launching, owner)
    }
    const run = moveWorkflowRun(db, launching.run.runId, 'active', null, now()) ?? launching.run
    deps.exitWatches?.watch(owner)
    return { ok: true, run, owner }
  }

  return { refuseNoEffects, markUnknown, settleStarted }
}
