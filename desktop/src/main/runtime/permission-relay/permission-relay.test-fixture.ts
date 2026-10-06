// FIXTURE_ONLY: every id, token and hash below is synthetic and describes no real run.
import type { OrchestrationCompatibilityEvidence } from '../../../shared/orchestration-compatibility-evidence'
import type { RuntimeTerminalAgentStatus } from '../../../shared/runtime-types'
import type { PermissionRequestInput } from '../../../shared/rpc-contract/permission-relay-params'
import { PERMISSION_RELAY_WAIT_MS } from '../../../shared/rpc-contract/permission-relay-params'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { seedRunWithRunningOwner } from '../orchestration/db/autopilot-runtime.test-fixture'
import {
  getPermissionDecisionStore,
  type PermissionDecisionStore
} from '../orchestration/db/permission-decision-store'
import type { OrchestrationCompatibilityCallerAuthority } from '../runtime-terminal-contracts'
import { PermissionRelayService, type PermissionRelayDeps } from './permission-request-service'

export const FIXTURE_HANDLE = 'terminal_fixture01'
export const FIXTURE_PANE = 'pane_fixture01:1'
export const FIXTURE_INCARNATION = 'incarnation_fixture01'
export const FIXTURE_EVIDENCE: OrchestrationCompatibilityEvidence = {
  terminalHandle: FIXTURE_HANDLE,
  paneKey: FIXTURE_PANE,
  launchToken: 'fixture-launch-token'
}
export const FIXTURE_START_MS = Date.parse('2026-10-05T00:00:10.000Z')
export const FIXTURE_REQUEST_HASH = '0123456789abcdef'.repeat(4)

type Status = RuntimeTerminalAgentStatus['status'] | 'gone'

export function primaryAuthority(
  overrides: Partial<OrchestrationCompatibilityCallerAuthority> = {}
): OrchestrationCompatibilityCallerAuthority {
  return {
    hostScope: { kind: 'local', hostId: 'local' },
    paneKey: FIXTURE_PANE,
    terminalHandle: FIXTURE_HANDLE,
    processIncarnation: FIXTURE_INCARNATION,
    launchTokenHash: 'f'.repeat(64),
    ...overrides
  }
}

export function relayRequest(
  overrides: Partial<PermissionRequestInput> = {}
): PermissionRequestInput {
  return {
    toolName: 'Bash',
    agentId: null,
    cwd: '/fixture/repo',
    toolInput: { command: 'git status' },
    requestSha256: FIXTURE_REQUEST_HASH,
    waitBudgetMs: PERMISSION_RELAY_WAIT_MS,
    ...overrides
  }
}

export type RelayHarness = {
  owner: OrchestrationDb
  ownerId: string
  store: PermissionDecisionStore
  service: PermissionRelayService
  /** A second service over the same database and fakes, as the app would build after a restart. */
  newService(): PermissionRelayService
  setStatus(handle: string, status: Status): void
  setAuthority(authority: OrchestrationCompatibilityCallerAuthority | null): void
}

/** A running app run with its primary in a fixture pane; the clock is whatever vi's fake timers say. */
export function createRelayHarness(
  options: { seed?: boolean; appDataDirectories?: readonly string[] } = {}
): RelayHarness {
  const owner = new OrchestrationDb(':memory:')
  const ownerId = options.seed === false ? '' : seedRunWithRunningOwner(owner).ownerId
  const statuses = new Map<string, Status>([[FIXTURE_HANDLE, 'working']])
  let authority: OrchestrationCompatibilityCallerAuthority | null = primaryAuthority()
  const deps: PermissionRelayDeps = {
    getDb: () => owner,
    verifyCaller: (evidence) =>
      evidence?.launchToken === FIXTURE_EVIDENCE.launchToken ? authority : null,
    readStatus: async (handle) => {
      const status = statuses.get(handle)
      if (status === undefined || status === 'gone') {
        throw new Error('terminal_gone')
      }
      return { handle, isRunningAgent: true, status }
    },
    now: () => Date.now(),
    controlPlaneCommands: ['nash'],
    appDataDirectories: options.appDataDirectories
  }
  const service = new PermissionRelayService(deps)
  return {
    owner,
    ownerId,
    // Why a getter: opening the store creates the app tables, which the no-app-run cases must not do.
    get store() {
      return getPermissionDecisionStore(owner)
    },
    service,
    newService: () => new PermissionRelayService(deps),
    setStatus: (handle, status) => statuses.set(handle, status),
    setAuthority: (next) => {
      authority = next
    }
  }
}
