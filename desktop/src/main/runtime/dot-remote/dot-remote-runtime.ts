import { randomUUID } from 'node:crypto'
import type { OrcaRuntimeService } from '../orca-runtime'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { createDotRemoteAgent } from './dot-remote-agent'
import type { DotRemoteCredentialSource } from './dot-remote-credentials'
import { createDotIngressEndpointClient } from './dot-remote-ingress-client'
import { createDotRemoteLocalReaders } from './dot-remote-local-readers'
import { registerDotRemoteControl } from './dot-remote-port'
import { createDotRemoteProxiedFetch } from './dot-remote-proxied-fetch'
import { createDotRemoteRelayPrompts } from './dot-remote-relay-prompts'
import type { DotRemoteFetch } from './dot-remote-site-client'
import {
  REAL_DOT_REMOTE_TIMERS,
  type DotRemoteLog,
  type DotRemoteTimers
} from './dot-remote-timers'

// The production composition of remote access: Orca's proxy-aware main HttpClient for hop B, the dot
// endpoint for hop C, the local readers for events and D4's enabled workspaces for the list. Building
// it starts nothing; start() resumes polling only when the switch is on and a session exists.

export type DotRemoteRuntimeInput = {
  readonly runtime: OrcaRuntimeService
  readonly owner: OrchestrationDb
  readonly userDataPath: string
  readonly credentials: DotRemoteCredentialSource
  readonly appVersion: string
  readonly log: DotRemoteLog
  readonly fetch?: DotRemoteFetch
  readonly now?: () => number
  readonly timers?: DotRemoteTimers
}

export type DotRemoteRuntime = {
  start(): void
  /** Will-quit: stops polling at once and flushes the outbox once. */
  stop(): Promise<void>
  uninstall(): void
}

export function createDotRemoteRuntime(input: DotRemoteRuntimeInput): DotRemoteRuntime {
  const { runtime, owner } = input
  const agent = createDotRemoteAgent({
    owner,
    credentials: input.credentials,
    fetch: input.fetch ?? createDotRemoteProxiedFetch({ log: input.log }),
    endpoint: createDotIngressEndpointClient({
      userDataPath: input.userDataPath,
      ready: () => runtime.requireDotIngressControl().status().listening
    }),
    source: createDotRemoteLocalReaders({
      db: () => owner,
      listForDot: createDotRemoteRelayPrompts(runtime, input.log)
    }),
    listWorkspaces: () => {
      const settings = getDotIngressSettingsStore(owner)
      // Why the maximum too: dot asks for the access it may have (D-034); NASH still enforces it.
      return settings.listWorkspaces({ enabledOnly: true }).map((entry) => ({
        workspaceRef: entry.workspaceRef,
        displayName: entry.label,
        maxAccess: settings.getWorkspaceMaxAccess(entry.workspaceRef)
      }))
    },
    appVersion: input.appVersion,
    now: input.now ?? Date.now,
    timers: input.timers ?? REAL_DOT_REMOTE_TIMERS,
    newId: randomUUID,
    log: input.log
  })
  const unregister = registerDotRemoteControl(runtime, agent)
  return {
    start: () => agent.start(),
    stop: () => agent.stop(),
    uninstall: unregister
  }
}
