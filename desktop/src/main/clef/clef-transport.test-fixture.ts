// FIXTURE_ONLY: test harness for the Clef transport. Production code must never import this file.
import type { ClefCredentialHandleLike } from './clef-endpoint'
import type { ClefTimers } from './clef-transport-signals'
import type { ClefAttemptPermit, ClefHttpClient, ClefTransportDeps } from './clef-transport'

// FIXTURE_ONLY: fake credentials shaped like real ones so redaction sees the real formats.
export const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
export const FIXTURE_ONLY_TOKEN = 'FAKE_CLEF_TOKEN_FIXTURE_ONLY_0000000000'
export const FIXTURE_ONLY_RUN_URL = `https://api.cloudflare.com/client/v4/accounts/${FIXTURE_ONLY_ACCOUNT_ID}/ai/run/@cf/cloudflare/clef`

export function fixtureCredentials(
  overrides: Partial<ClefCredentialHandleLike> = {}
): ClefCredentialHandleLike {
  return {
    authorizationHeader: () => `Bearer ${FIXTURE_ONLY_TOKEN}`,
    accountPath: () => FIXTURE_ONLY_ACCOUNT_ID,
    ...overrides
  }
}

/** The budget hook of a caller whose ledger always agrees; tests that exercise budgets pass their own. */
export const allowEveryAttempt = (): ClefAttemptPermit => ({ proceed: true })

export function fixtureBody(extra: Record<string, unknown> = {}): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ model: 'clef', state: {}, questions: {}, ...extra })
  )
}

/** A body that is produced chunk by chunk on demand, so a test can see how far the reader pulled. */
export type StreamedBody = {
  chunkBytes: number
  chunkCount: number
  onPull?: () => void
  onCancel?: () => void
}

export type FakeStep =
  | { status: number; body?: string; headers?: Record<string, string> }
  | { status: number; brokenBody: true }
  | { status: number; streamed: StreamedBody; headers?: Record<string, string> }
  | { throws: unknown }
  | { hangUntilAbort: true }

export type FakeCall = { url: string; init: RequestInit }

function pullStream(streamed: StreamedBody): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream<Uint8Array>(
    {
      pull: (controller) => {
        if (sent >= streamed.chunkCount) {
          controller.close()
          return
        }
        sent += 1
        streamed.onPull?.()
        controller.enqueue(new Uint8Array(streamed.chunkBytes))
      },
      cancel: () => streamed.onCancel?.()
    },
    // Why zero: the stream only produces a chunk when the reader asks for one.
    { highWaterMark: 0 }
  )
}

function streamFor(step: FakeStep): ReadableStream<Uint8Array> {
  if ('streamed' in step) {
    return pullStream(step.streamed)
  }
  if ('brokenBody' in step) {
    return new ReadableStream({
      start: (controller) => controller.error(new Error('FIXTURE_ONLY stream broke'))
    })
  }
  const text = 'body' in step && step.body !== undefined ? step.body : '{"fixture":true}'
  return new ReadableStream({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    }
  })
}

function hangUntilAbort(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const abort = (): void => reject(signal?.reason ?? new Error('aborted'))
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Scripted HTTP client; a step past the end of the script answers 200. */
export function createFakeClient(steps: readonly FakeStep[]): ClefHttpClient & {
  calls: FakeCall[]
  responses: Response[]
} {
  const calls: FakeCall[] = []
  const responses: Response[] = []
  return {
    calls,
    responses,
    proxySession: () => null,
    fetch: async (url, init = {}) => {
      const step = steps[calls.length] ?? { status: 200 }
      calls.push({ url, init })
      if ('throws' in step) {
        throw step.throws
      }
      if ('hangUntilAbort' in step) {
        return hangUntilAbort(init.signal)
      }
      const headers = 'headers' in step ? step.headers : undefined
      const response = new Response(streamFor(step), { status: step.status, headers })
      responses.push(response)
      return response
    }
  }
}

export type ManualTimers = ClefTimers & {
  pending(): { ms: number; fire(): void }[]
}

export function createManualTimers(): ManualTimers {
  const scheduled = new Map<number, { ms: number; callback: () => void }>()
  let nextId = 0
  return {
    set(callback, ms) {
      const id = nextId++
      scheduled.set(id, { ms, callback })
      return () => {
        scheduled.delete(id)
      }
    },
    pending: () =>
      [...scheduled.entries()].map(([id, entry]) => ({
        ms: entry.ms,
        fire: () => {
          scheduled.delete(id)
          entry.callback()
        }
      }))
  }
}

export type FixtureDeps = Required<Omit<ClefTransportDeps, 'client'>> & {
  client: ReturnType<typeof createFakeClient>
  timers: ManualTimers
  sleeps: number[]
  proxyPreparations: number
}

export function fixtureDeps(steps: readonly FakeStep[], random = 0.5): FixtureDeps {
  const sleeps: number[] = []
  const deps: FixtureDeps = {
    client: createFakeClient(steps),
    timers: createManualTimers(),
    random: () => random,
    sleeps,
    proxyPreparations: 0,
    prepareProxy: async () => {
      deps.proxyPreparations += 1
    },
    sleep: async (ms) => {
      sleeps.push(ms)
    }
  }
  return deps
}
