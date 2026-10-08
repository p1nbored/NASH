import { randomUUID } from 'node:crypto'
import { tokenizeStartupCommand } from '../../../shared/tui-agent-startup-shell'
import { resolveActiveRoutingTable } from '../../routing-table/routing-table-activation'
import type { OrcaRuntimeService } from '../orca-runtime'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { workbenchWorkspaceBinding } from '../orchestration/db/workbench-request-scope'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { requireRoutingTableContext } from '../workbench-run/routing-table-context-registry'
import type { OrchestrationCompatibilityCallerAuthority } from '../runtime-terminal-contracts'
import { isEquivalentPaneKey } from '../orchestration/db/pane-key-match'
import { AUTOPILOT_EFFORT_LEVELS } from '../orchestration/db/autopilot-run-schema-definition'
import { recordNativeCoordinator } from './native-coordinator-record'

export type NativeCoordinatorAuthority = Omit<
  OrchestrationCompatibilityCallerAuthority,
  'launchTokenHash'
> & {
  launchTokenHash: string | null
}
export type NativeCoordinatorAdoptionOptions = {
  runId?: string
  requestId?: string
  requestedAccess?: 'read_only' | 'workspace_write'
}

function refuse(reason: string): never {
  throw new OrchestrationError(
    'autopilot_native_coordinator_refused',
    'The native coordinator could not be attached. No effects were applied.',
    { reason, effectsApplied: false }
  )
}

/** Host-only evidence for one explicitly selected coordinator; no caller can nominate another pane. */
export function nativeCoordinatorAuthority(
  runtime: OrcaRuntimeService,
  runId: string
): NativeCoordinatorAuthority {
  const run = runtime.getOrchestrationDb().getRun(runId)
  const handle = run?.coordinator_handle
  const authority = handle ? runtime.getOrchestrationDispatchAuthority(handle) : null
  if (
    !run ||
    run.legacy ||
    !handle ||
    !authority?.paneKey ||
    !authority.processIncarnation ||
    !authority.ptyId ||
    !run.coordinator_pane_key ||
    !isEquivalentPaneKey(run.coordinator_pane_key, authority.paneKey)
  ) {
    return refuse('coordinator_not_live')
  }
  return {
    terminalHandle: handle,
    paneKey: authority.paneKey,
    processIncarnation: authority.processIncarnation,
    launchTokenHash: authority.launchTokenHash,
    hostScope: authority.hostScope
  }
}

function launchChoice(runtime: OrcaRuntimeService, handle: string) {
  const launch = runtime.readNativeCoordinatorLaunch(handle)
  if (launch?.agent !== 'claude' && launch?.agent !== 'codex') {
    return refuse('unsupported_coordinator_agent')
  }
  const parsed = tokenizeStartupCommand(
    launch.agentArgs ?? '',
    process.platform === 'win32' ? 'powershell' : 'posix'
  )
  const tokens = parsed.ok ? parsed.tokens : []
  let model = 'session-default'
  let effort: (typeof AUTOPILOT_EFFORT_LEVELS)[number] = 'none'
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const selected =
      token === '--model' || token === '-m'
        ? tokens[index + 1]
        : token.startsWith('--model=')
          ? token.slice(8)
          : undefined
    if (selected && /^[A-Za-z0-9._:/-]{1,128}$/.test(selected)) {
      model = selected
    }
    const level =
      token === '--effort'
        ? tokens[index + 1]
        : /^model_reasoning_effort=["']?([a-z]+)["']?$/.exec(token)?.[1]
    const known = AUTOPILOT_EFFORT_LEVELS.find((entry) => entry === level)
    if (known) {
      effort = known
    }
  }
  return { agent: launch.agent, model, effort }
}

/** Adds classification and approval metadata to the current CLI without launching or reconfiguring it. */
export function adoptNativeCoordinator(
  runtime: OrcaRuntimeService,
  authority: NativeCoordinatorAuthority,
  options: NativeCoordinatorAdoptionOptions = {}
) {
  const db = runtime.getOrchestrationDb()
  const current = db.getCurrentRunForCoordinator({
    terminalHandle: authority.terminalHandle,
    paneKey: authority.paneKey,
    orcaSessionId: null
  })
  if (!current || (options.runId && current.id !== options.runId)) {
    return refuse('consumer_fenced')
  }
  const live = nativeCoordinatorAuthority(runtime, current.id)
  if (
    live.terminalHandle !== authority.terminalHandle ||
    live.processIncarnation !== authority.processIncarnation ||
    !isEquivalentPaneKey(live.paneKey, authority.paneKey) ||
    (live.launchTokenHash !== null && live.launchTokenHash !== authority.launchTokenHash)
  ) {
    return refuse('process_mismatch')
  }
  if (live.hostScope.kind !== 'local') {
    return refuse('unsupported_host')
  }
  const workspaceId = runtime.getTerminalWorktreeIdForHandle(authority.terminalHandle)
  if (!workspaceId) {
    return refuse('workspace_unavailable')
  }
  const workspace = runtime.requireWorkbenchWorkspace(workspaceId)
  const existingTables = db.db
    .prepare("SELECT 1 FROM sqlite_master WHERE name = 'workflow_runs'")
    .get()
  const existing = existingTables ? getWorkflowRunStore(db).get(current.id) : null
  if (existing && existing.workspaceBinding !== workbenchWorkspaceBinding(workspaceId, workspace)) {
    return refuse('workspace_changed')
  }
  const owner = existing ? getPrimarySessionStore(db).findLiveByRun(current.id) : null
  if (
    existing &&
    owner?.state === 'running' &&
    owner.processIncarnation === authority.processIncarnation &&
    owner.paneKey &&
    isEquivalentPaneKey(owner.paneKey, authority.paneKey)
  ) {
    if (options.requestedAccess === 'workspace_write' && existing.requestedAccess === 'read_only') {
      return refuse('access_upgrade_refused')
    }
    return { run: existing, owner }
  }
  const active = resolveActiveRoutingTable(requireRoutingTableContext(runtime))
  if (!active.ok) {
    return refuse(active.reason)
  }
  const choice = launchChoice(runtime, authority.terminalHandle)
  return recordNativeCoordinator(db, {
    runId: current.id,
    requestId: options.requestId ?? `native_${randomUUID()}`,
    workspaceId,
    workspaceBinding: workbenchWorkspaceBinding(workspaceId, workspace),
    requestedAccess: options.requestedAccess ?? 'read_only',
    routingTableVersion: active.version,
    routingTableSha256: active.sha256,
    coordinatorAgent: choice.agent,
    coordinatorModel: choice.model,
    coordinatorEffort: choice.effort,
    timestamp: new Date().toISOString(),
    authority
  })
}
