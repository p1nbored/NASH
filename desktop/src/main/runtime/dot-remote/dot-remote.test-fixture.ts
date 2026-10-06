// FIXTURE_ONLY: fakes for the remote sync agent. Tokens, origins and ids are obviously synthetic; no
// fake here opens a socket, a pipe or a process, and the Site is an in-memory script.
import { vi } from 'vitest'
import { DotRemoteDeviceCredentialSchema } from '../../../shared/dot-remote/dot-remote-device-credential'
import {
  DotRemoteDeviceCredential,
  DotRemoteServiceToken,
  DotRemoteSessionToken,
  validateDotRemoteServiceTokenShape,
  type DotRemoteCredentialSource
} from './dot-remote-credentials'
import type { DotRemoteLocalEndpoint, DotRemoteLocalResult } from './dot-remote-local-endpoint'
import type {
  DotRemoteSiteCallOptions,
  DotRemoteSiteClient,
  DotRemoteSiteEndpoint,
  DotRemoteSiteResult
} from './dot-remote-site-client'
import type { DotRemoteTimers } from './dot-remote-timers'

export const FIXTURE_ORIGIN = 'https://fixture-nash.example.test'
export const FIXTURE_SERVICE_VALUE = 'FIXTURE_ONLY_sites_service_token_0000000000'
export const FIXTURE_SESSION_VALUE = 'FIXTURE0session0token0value0000000000000000000'
export const FIXTURE_DEVICE = 'dev_0123456789abcdef01234567'
export const FIXTURE_T0_MS = Date.parse('2026-10-05T12:00:00.000Z')

/**
 * The sealed store's contract in memory, kept across agent restarts like the sealed files are.
 * `sealing: false` behaves like a host without a keyring; a failed device write keeps nothing.
 */
export function memoryCredentials(options: { sealing?: boolean } = {}) {
  let stored: string | null = null
  let device: string | null = null
  let failDeviceWrites = false
  const source: DotRemoteCredentialSource = {
    status: () => ({
      present: stored !== null,
      protection: options.sealing === false ? 'sealing_unavailable' : stored ? 'sealed' : 'absent'
    }),
    read: () => (stored === null ? null : new DotRemoteServiceToken(stored)),
    save: (token) => {
      const code = validateDotRemoteServiceTokenShape(token)
      if (code !== null) {
        return { ok: false, code }
      }
      if (options.sealing === false) {
        return { ok: false, code: 'sealing_unavailable' }
      }
      stored = token
      return { ok: true }
    },
    clear: () => {
      stored = null
      return { ok: true }
    },
    readDevice: () => (device === null ? null : new DotRemoteDeviceCredential(device)),
    saveDevice: (credential) => {
      if (!DotRemoteDeviceCredentialSchema.safeParse(credential).success) {
        return { ok: false, code: 'credential_invalid' }
      }
      if (options.sealing === false || failDeviceWrites) {
        device = null
        return {
          ok: false,
          code: options.sealing === false ? 'sealing_unavailable' : 'write_failed'
        }
      }
      device = credential
      return { ok: true }
    },
    clearDevice: () => {
      device = null
      return { ok: true }
    }
  }
  return {
    ...source,
    /** Test view of the sealed device credential. */
    deviceValue: () => device,
    failDeviceWrites: (fail: boolean) => {
      failDeviceWrites = fail
    }
  }
}

export const fixtureCredentials = () => ({
  service: new DotRemoteServiceToken(FIXTURE_SERVICE_VALUE),
  session: new DotRemoteSessionToken(FIXTURE_SESSION_VALUE)
})

/** A clock the test moves by hand, in seconds after T0. */
export function fixtureClock(startSeconds = 0) {
  let current = FIXTURE_T0_MS + startSeconds * 1000
  return {
    now: () => current,
    set: (seconds: number) => {
      current = FIXTURE_T0_MS + seconds * 1000
    },
    advance: (ms: number) => {
      current += ms
    }
  }
}

type Scheduled = { at: number; run: () => void; id: number }

/** Timers bound to a fixture clock; `advance` fires every due callback in order. */
export function manualTimers(clock: ReturnType<typeof fixtureClock>) {
  let queue: Scheduled[] = []
  let nextId = 1
  const timers: DotRemoteTimers = {
    schedule: (run, ms) => {
      const id = nextId++
      queue = [...queue, { at: clock.now() + ms, run, id }]
      return {
        cancel: () => {
          queue = queue.filter((entry) => entry.id !== id)
        }
      }
    }
  }
  async function advance(ms: number): Promise<void> {
    const until = clock.now() + ms
    for (;;) {
      const due = [...queue].sort((a, b) => a.at - b.at)[0]
      if (!due || due.at > until) {
        break
      }
      queue = queue.filter((entry) => entry.id !== due.id)
      // Why max: a timer overdue after the test moved the clock runs now, never in the past.
      clock.advance(Math.max(0, due.at - clock.now()))
      due.run()
      await flushMicrotasks()
    }
    clock.advance(until - clock.now())
  }
  return { timers, advance, pending: () => queue.length }
}

/** Lets every promise chain a fired callback started (fake fetch, body reads) run to its end. */
export async function flushMicrotasks(): Promise<void> {
  for (let round = 0; round < 25; round += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

type Handler = (
  body: unknown,
  options: DotRemoteSiteCallOptions
) => DotRemoteSiteResult<unknown> | Promise<DotRemoteSiteResult<unknown>>

/** A Site that answers each endpoint from a handler and records every call it got. */
export function scriptedSite(handlers: Partial<Record<DotRemoteSiteEndpoint, Handler>>) {
  const calls: { name: DotRemoteSiteEndpoint; body: unknown; itemId?: string }[] = []
  const client: DotRemoteSiteClient = {
    call: vi.fn(async (name, body, options) => {
      calls.push({ name, body, ...(options.itemId ? { itemId: options.itemId } : {}) })
      const handler = handlers[name]
      if (!handler) {
        throw new Error(`Fixture: no Site handler for ${name}.`)
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each fixture handler returns the endpoint's response shape.
      return (await handler(body, options)) as never
    })
  }
  return { client, calls }
}

export const siteOk = (value: unknown): DotRemoteSiteResult<unknown> => ({ ok: true, value })

type LocalHandler = (
  params: Record<string, unknown>
) => DotRemoteLocalResult | Promise<DotRemoteLocalResult>

/** The local dot endpoint as the agent sees it: a method table and a readiness flag. */
export function fakeLocalEndpoint(handlers: Record<string, LocalHandler>) {
  const calls: { method: string; params: Record<string, unknown>; timeoutMs: number }[] = []
  let ready = true
  const endpoint: DotRemoteLocalEndpoint = {
    ready: () => ready,
    call: vi.fn(
      async (
        method: string,
        params: Record<string, unknown>,
        timeoutMs: number
      ): Promise<DotRemoteLocalResult> => {
        calls.push({ method, params, timeoutMs })
        const handler = handlers[method]
        return handler ? handler(params) : { ok: false, kind: 'unavailable' }
      }
    )
  }
  return {
    endpoint,
    calls,
    setReady: (value: boolean) => {
      ready = value
    }
  }
}
