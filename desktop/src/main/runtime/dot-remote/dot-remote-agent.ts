import type {
  DotRemoteReconnectReason,
  WorkbenchDotRemotePairingStartResult,
  WorkbenchDotRemotePairingView,
  WorkbenchDotRemoteRevokeResult,
  WorkbenchDotRemoteStatusView
} from '../../../shared/rpc-contract/workbench-dot-remote-params'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { createDotRemoteCycle } from './dot-remote-agent-cycle'
import {
  createDotRemoteSessionHolder,
  type DotRemoteSessionHolder
} from './dot-remote-agent-session'
import { buildDotRemoteStatus } from './dot-remote-agent-status'
import type { DotRemoteCredentialSource } from './dot-remote-credentials'
import { dotRemoteErrorCode } from './dot-remote-error-code'
import { dotRemoteRpcError, sealDotRemoteConnection } from './dot-remote-errors'
import type { DotRemoteEventSource } from './dot-remote-event-source'
import { failureAction } from './dot-remote-failure'
import type { DotRemoteLocalEndpoint } from './dot-remote-local-endpoint'
import { createDotRemotePairing } from './dot-remote-pairing'
import { dotRemoteAppVersion, type DotRemoteWorkspaceEntry } from './dot-remote-presence'
import { createDotRemoteResumeBackoff } from './dot-remote-resume-backoff'
import { getDotRemoteSettingsStore } from './dot-remote-settings-store'
import { createDotRemoteSyncHealth } from './dot-remote-sync-health'
import {
  createDotRemoteSiteClient,
  type DotRemoteFetch,
  type DotRemoteSiteClient,
  type DotRemoteSiteFailure
} from './dot-remote-site-client'
import type { DotRemoteLog, DotRemoteTimerHandle, DotRemoteTimers } from './dot-remote-timers'

// R1: the remote sync agent. Off by default. Once paired it polls the Site over HTTPS (5 s while a
// run is active or a prompt is open, 30 s when idle), hands items to NASH's own dot endpoint and
// reports back. After a restart or a lost session it refreshes with the sealed device credential. A
// refused token, or an ended pairing (revoked, reused credential, lifetime), stops it until the user acts.

export type DotRemoteAgentDeps = {
  readonly owner: OrchestrationDb
  readonly credentials: DotRemoteCredentialSource
  /** Orca's proxy-aware fetch (main HttpClient) in production. */
  readonly fetch: DotRemoteFetch
  readonly endpoint: DotRemoteLocalEndpoint
  readonly source: DotRemoteEventSource
  readonly listWorkspaces: () => readonly DotRemoteWorkspaceEntry[]
  readonly appVersion: string
  readonly now: () => number
  readonly timers: DotRemoteTimers
  readonly newId: () => string
  readonly log: DotRemoteLog
}

export function createDotRemoteAgent(deps: DotRemoteAgentDeps) {
  const settings = getDotRemoteSettingsStore(deps.owner)
  const iso = (): string => new Date(deps.now()).toISOString()
  const clients = new Map<string, DotRemoteSiteClient>()
  const site: DotRemoteSiteClient = {
    call: (name, body, options) => {
      const origin = settings.getSettings().origin
      if (origin === null) {
        return Promise.resolve({ ok: false, kind: 'invalid_request' })
      }
      const client = clients.get(origin) ?? createDotRemoteSiteClient({ origin, fetch: deps.fetch })
      clients.set(origin, client)
      return client.call(name, body, options)
    }
  }
  const pairing = createDotRemotePairing({
    now: deps.now,
    appVersion: dotRemoteAppVersion(deps.appVersion)
  })
  const sessions: DotRemoteSessionHolder = createDotRemoteSessionHolder({
    owner: deps.owner,
    credentials: deps.credentials,
    site,
    now: deps.now
  })
  const backoff = createDotRemoteResumeBackoff()
  const tickBackoff = createDotRemoteResumeBackoff()
  const health = createDotRemoteSyncHealth(deps.now)
  let stopped = false
  let timer: DotRemoteTimerHandle | null = null
  let running: Promise<void> | null = null
  let controller = new AbortController()
  const enabled = (): boolean => settings.getSettings().enabled
  const cycle = createDotRemoteCycle({
    ...deps,
    site,
    sessions,
    isCurrent: (generation) => !stopped && enabled() && sessions.generation() === generation
  })

  function cancelTimer(): void {
    timer?.cancel()
    timer = null
  }

  function schedule(delayMs: number | null): void {
    cancelTimer()
    if (delayMs !== null && !stopped && enabled() && sessions.reconnectReason() === null) {
      timer = deps.timers.schedule(() => void tick(), delayMs)
    }
  }

  /** Aborts what is in flight; a run already started on the PC is never touched. */
  function halt(): void {
    cancelTimer()
    controller.abort()
    controller = new AbortController()
    health.clear()
  }

  async function pollPairing(signal: AbortSignal): Promise<void> {
    const service = sessions.serviceToken()
    if (!service) {
      pairing.cancel()
      return
    }
    const result = await pairing.poll(site, { service, session: null }, signal)
    if (result.kind === 'issued') {
      if (
        sessions.install(result.session, result.deviceCredential, settings.getSettings().origin)
      ) {
        backoff.reset()
        cycle.reset()
      } else {
        const code = sessions.reconnectReason() ?? 'origin_missing'
        deps.log({ event: 'dot_remote_pairing_not_installed', code })
      }
    } else if (result.kind === 'failure') {
      const action = failureAction(result.failure)
      if (action.action === 'reconnect') {
        pairing.cancel()
        sessions.requireReconnect(action.reason)
      }
    }
  }

  async function runTick(): Promise<void> {
    timer = null
    if (stopped || !enabled()) {
      return
    }
    const signal = controller.signal
    if (pairing.isWaiting()) {
      await pollPairing(signal)
    }
    if (sessions.binding() === null && sessions.resumable()) {
      const failure = await sessions.resume()
      if (failure) {
        schedule(settleResume(failure))
        return
      }
      backoff.reset()
    }
    if (sessions.binding() === null) {
      schedule(pairing.isWaiting() ? pairing.nextPollDelay() : null)
      return
    }
    const outcome = await cycle.run(signal)
    schedule(outcome.nextDelayMs)
  }

  /** A refresh that failed: an ended pairing stops; an unreachable Site is retried with backoff. */
  function settleResume(failure: DotRemoteSiteFailure): number | null {
    const action = failureAction(failure)
    deps.log({ event: 'dot_remote_refresh_failed', code: action.action })
    switch (action.action) {
      case 'pair_again':
        sessions.fence(action.reason)
        return null
      case 'reconnect':
        sessions.requireReconnect(action.reason)
        return null
      case 'ignore':
        return null
      case 'session_lost':
      case 'retry':
        sessions.setOffline(true)
        return backoff.next()
    }
  }

  /** A poll that threw (a store call failed): logged by code, then polled again with backoff. */
  function retryAfterThrow(error: unknown): void {
    const code = dotRemoteErrorCode(error)
    health.failed(code)
    deps.log({ event: 'dot_remote_tick_failed', code })
    try {
      schedule(tickBackoff.next())
    } catch (scheduleError) {
      // Why only logged: a store that cannot even be read stops polling until a start or a user action.
      deps.log({ event: 'dot_remote_tick_unscheduled', code: dotRemoteErrorCode(scheduleError) })
    }
  }

  function tick(): Promise<void> {
    // Why clear on any poll that did not throw: only polls that throw in a row are reported.
    running ??= runTick()
      .then(() => {
        tickBackoff.reset()
        health.clear()
      }, retryAfterThrow)
      .finally(() => {
        running = null
      })
    return running
  }

  function status(): WorkbenchDotRemoteStatusView {
    return buildDotRemoteStatus({
      owner: deps.owner,
      credentials: deps.credentials,
      endpoint: deps.endpoint,
      sessions,
      pairingWaiting: pairing.isWaiting(),
      syncFailure: health.view()
    })
  }

  async function startPairing(): Promise<WorkbenchDotRemotePairingStartResult> {
    if (!enabled()) {
      throw dotRemoteRpcError('disabled')
    }
    const service = sessions.serviceToken()
    if (settings.getSettings().origin === null || !service) {
      throw dotRemoteRpcError('notConfigured')
    }
    const started = await pairing.start(site, { service, session: null })
    if (!started.ok) {
      const action = failureAction(started.failure)
      if (action.action === 'reconnect') {
        sessions.requireReconnect(action.reason)
        throw dotRemoteRpcError('reconnectNeeded')
      }
      throw started.failure.kind === 'site_error'
        ? dotRemoteRpcError('pairingRefused')
        : dotRemoteRpcError('siteUnreachable')
    }
    sessions.clearReconnect()
    schedule(pairing.nextPollDelay())
    return { pairing: pairing.view(), status: status() }
  }

  async function revoke(): Promise<WorkbenchDotRemoteRevokeResult> {
    halt()
    pairing.cancel()
    const siteConfirmed = await sessions.revokeOnSite()
    sessions.fence(null)
    return { siteConfirmed, status: status() }
  }

  return {
    start(): void {
      stopped = false
      schedule(sessions.binding() || sessions.resumable() ? 0 : null)
    },
    status,
    enable(): WorkbenchDotRemoteStatusView {
      settings.setEnabled(true, iso())
      // Why: a poll the switch-off aborted may still have thrown after halt() cleared the count.
      health.clear()
      schedule(sessions.binding() || sessions.resumable() || pairing.isWaiting() ? 0 : null)
      return status()
    },
    disable(): WorkbenchDotRemoteStatusView {
      settings.setEnabled(false, iso())
      halt()
      pairing.cancel()
      return status()
    },
    setConnection(input: { origin: string; serviceToken: string }): WorkbenchDotRemoteStatusView {
      const origin = sealDotRemoteConnection(input, deps.credentials)
      const previous = settings.getSettings().origin
      settings.setOrigin(origin, iso())
      if (previous !== null && previous !== origin) {
        halt()
        pairing.cancel()
        sessions.fence(null)
      }
      sessions.clearTokenReconnect()
      schedule(sessions.binding() || sessions.resumable() ? 0 : null)
      return status()
    },
    startPairing,
    pairingStatus: (): WorkbenchDotRemotePairingView => pairing.view(),
    revoke,
    tick,
    /** Will-quit: stops polling at once, then sends what the outbox holds, once. */
    async stop(): Promise<void> {
      stopped = true
      halt()
      await running?.catch(() => undefined)
      if (enabled()) {
        await cycle.finalFlush()
      }
    }
  }
}

export type DotRemoteAgent = ReturnType<typeof createDotRemoteAgent>
export type { DotRemoteReconnectReason }
