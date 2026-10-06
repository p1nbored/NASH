// FIXTURE_ONLY: a sync agent wired to the fake Site, a fake local dot endpoint, a scripted event
// source, a memory credential store and a hand-driven clock. Nothing leaves the process.
import { vi, type Mock } from 'vitest'
import { DOT_REQUEST_STATUS_TEXT } from '../../../shared/dot-ingress/dot-ingress-status-text'
import { at, requestId } from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { createDotRemoteAgent, type DotRemoteAgent } from './dot-remote-agent'
import type { DotRemoteEventSource, DotRemoteRequestSnapshot } from './dot-remote-event-source'
import { createFakeSite } from './dot-remote-fake-site.test-fixture'
import { ensureDotRemoteSchema } from './dot-remote-schema'
import type { DotRemoteLog } from './dot-remote-timers'
import {
  FIXTURE_ORIGIN,
  FIXTURE_SERVICE_VALUE,
  fakeLocalEndpoint,
  fixtureClock,
  manualTimers,
  memoryCredentials
} from './dot-remote.test-fixture'

export const WORKSPACE = {
  workspaceRef: 'dws_0123456789abcdef01234567',
  displayName: 'Fixture docs'
}

export function submittedView(runState = 'active') {
  return {
    contractVersion: 3,
    dotRequestId: requestId(1),
    sequence: 1,
    revision: 1,
    workspaceRef: WORKSPACE.workspaceRef,
    deliverableLanguage: null,
    reply: null,
    createdAt: at(1),
    updatedAt: at(1),
    result: null,
    artifacts: [],
    state: 'submitted',
    statusText: DOT_REQUEST_STATUS_TEXT.submitted,
    run: { state: runState, blocker: null },
    requestedAccess: 'read_only'
  }
}

export function activeSnapshot(): DotRemoteRequestSnapshot {
  return {
    status: {
      state: 'submitted',
      statusText: DOT_REQUEST_STATUS_TEXT.submitted,
      run: { state: 'active', blocker: null }
    },
    prompts: [],
    messages: [],
    validations: [],
    deliverable: null,
    validationDecisions: [],
    awaitsValidationDecision: false
  }
}

type FakeSite = ReturnType<typeof createFakeSite>

export type AgentHarness = {
  owner: OrchestrationDb
  clock: ReturnType<typeof fixtureClock>
  timers: ReturnType<typeof manualTimers>
  site: FakeSite
  fetch: Mock<FakeSite['fetch']>
  local: ReturnType<typeof fakeLocalEndpoint>
  snapshots: { current: DotRemoteRequestSnapshot | null }
  source: { snapshot: Mock<DotRemoteEventSource['snapshot']> }
  credentials: ReturnType<typeof memoryCredentials>
  log: Mock<DotRemoteLog>
  deps: Parameters<typeof createDotRemoteAgent>[0]
  agent: DotRemoteAgent
  configure(): Promise<void>
  pair(): Promise<void>
  restart(): DotRemoteAgent
  close(): void
}

export function createAgentHarness(options: { sealing?: boolean } = {}): AgentHarness {
  const owner = new OrchestrationDb(':memory:')
  ensureDotRemoteSchema(owner.db)
  const clock = fixtureClock(0)
  const timers = manualTimers(clock)
  const site = createFakeSite(clock.now)
  const fetch = vi.fn(site.fetch)
  const local = fakeLocalEndpoint({
    'dotIngress.requests.submit': () => ({
      ok: true,
      result: { contractVersion: 3, request: submittedView(), duplicate: false }
    })
  })
  const snapshots: { current: DotRemoteRequestSnapshot | null } = { current: activeSnapshot() }
  const source = { snapshot: vi.fn<DotRemoteEventSource['snapshot']>(() => snapshots.current) }
  const credentials = memoryCredentials(options)
  const log = vi.fn<DotRemoteLog>()
  let ids = 0
  const deps = {
    owner,
    credentials,
    fetch,
    endpoint: local.endpoint,
    source,
    listWorkspaces: () => [WORKSPACE],
    appVersion: '1.4.0',
    now: clock.now,
    timers: timers.timers,
    newId: () => `60000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    log
  }
  const agent = createDotRemoteAgent(deps)

  async function configure(): Promise<void> {
    agent.enable()
    agent.setConnection({ origin: FIXTURE_ORIGIN, serviceToken: FIXTURE_SERVICE_VALUE })
  }

  async function pair(): Promise<void> {
    await configure()
    await agent.startPairing()
    site.approve()
    await timers.advance(5_000)
  }

  return {
    owner,
    clock,
    timers,
    site,
    fetch,
    local,
    snapshots,
    source,
    credentials,
    log,
    deps,
    agent,
    configure,
    pair,
    restart: () => createDotRemoteAgent(deps),
    close: () => owner.close()
  }
}
