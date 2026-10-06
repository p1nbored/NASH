// FIXTURE_ONLY: panes, handles, incarnations and hashes below are synthetic and attest nothing.
import type { OrchestrationCompatibilityEvidence } from '../../../shared/orchestration-compatibility-evidence'
import { PERMISSION_RELAY_WAIT_MS } from '../../../shared/rpc-contract/permission-relay-params'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import { PermissionRelayService } from '../permission-relay/permission-request-service'

function paneOf(slot: number) {
  return {
    paneKey: `pane_dot${slot}:1`,
    terminalHandle: `terminal_dot${slot}`,
    processIncarnation: `incarnation_dot${slot}`
  }
}

/** A running primary session for the run, in its own fixture pane; returns the evidence its hook would send. */
export function seedLivePrimary(
  owner: OrchestrationDb,
  runId: string,
  slot: number
): OrchestrationCompatibilityEvidence {
  const pane = paneOf(slot)
  const sessions = getPrimarySessionStore(owner)
  const session = sessions.insertStarting({
    runId,
    launchOperationId: `operation_dot${slot}`,
    permissionMode: 'manual',
    requestedModel: 'claude-opus-5-5',
    requestedEffort: 'max',
    timestamp: new Date(Date.now()).toISOString()
  })
  sessions.markRunning(session.ownerId, {
    ...pane,
    launchTokenSha256: 'a'.repeat(64),
    launchLedger: 'orca',
    receipt: { mode: 'terminal' },
    timestamp: new Date(Date.now()).toISOString()
  })
  return {
    terminalHandle: pane.terminalHandle,
    paneKey: pane.paneKey,
    launchToken: `token-${slot}`
  }
}

/** A run that no dot request started: no Workbench row and no dot link, so its origin is not dot. */
export function seedForeignRun(owner: OrchestrationDb, runId: string): void {
  getWorkflowRunStore(owner).create({
    runId,
    requestId: `request-${runId}`,
    workspaceId: 'fixture-repo::/fixture/repo',
    workspaceBinding: 'c'.repeat(64),
    requestedAccess: 'workspace_write',
    deliverableLanguage: null,
    routingTableVersion: 1,
    routingTableSha256: 'b'.repeat(64),
    coordinatorModel: 'claude-opus-5-5',
    coordinatorEffort: 'max',
    timestamp: new Date(Date.now()).toISOString()
  })
}

export type FixtureRelay = {
  readonly relay: PermissionRelayService
  /** Raises a prompt from the pane in `evidence` and starts the hook's wait, as Claude Code would. */
  raise(
    evidence: OrchestrationCompatibilityEvidence,
    prompt: { toolName: string; toolInput: Record<string, string> }
  ): string
}

/** The real relay over the fixture database; the attested caller is whichever pane the evidence names. */
export function createFixtureRelay(owner: OrchestrationDb): FixtureRelay {
  const relay = new PermissionRelayService({
    getDb: () => owner,
    verifyCaller: (evidence) =>
      evidence?.paneKey && evidence.terminalHandle
        ? {
            hostScope: { kind: 'local', hostId: 'local' },
            paneKey: evidence.paneKey,
            terminalHandle: evidence.terminalHandle,
            processIncarnation: evidence.paneKey.replace(/^pane_dot(\d+):1$/, 'incarnation_dot$1'),
            launchTokenHash: 'f'.repeat(64)
          }
        : null,
    readStatus: async (handle) => ({ handle, isRunningAgent: true, status: 'working' }),
    now: () => Date.now(),
    controlPlaneCommands: ['nash']
  })
  return {
    relay,
    raise(evidence, prompt) {
      const result = relay.request(evidence, {
        toolName: prompt.toolName,
        agentId: null,
        cwd: '/fixture/repo',
        toolInput: prompt.toolInput,
        requestSha256: '0123456789abcdef'.repeat(4),
        waitBudgetMs: PERMISSION_RELAY_WAIT_MS
      })
      if (result.outcome !== 'relayed') {
        throw new Error(`expected ${prompt.toolName} to be relayed`)
      }
      void relay.wait(evidence, { decisionId: result.decisionId, waitMs: 20_000 })
      return result.decisionId
    }
  }
}
