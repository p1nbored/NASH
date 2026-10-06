import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RATE_LIMIT_REFRESH_MIN_INTERVAL_MS,
  RATE_LIMIT_REFRESH_WAIT_MS,
  createBoundedRateLimitRead
} from './route-rate-limit-refresh'
import type { RateLimitHeadroomState } from './route-provider-headroom'

const EMPTY: RateLimitHeadroomState = { claude: null, codex: null, antigravity: null }
const FRESH: RateLimitHeadroomState = { ...EMPTY, claude: { ...fixtureLimits() } }

function fixtureLimits(): NonNullable<RateLimitHeadroomState['claude']> {
  return {
    provider: 'claude',
    session: { usedPercent: 10, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: 0,
    error: null,
    status: 'ok'
  }
}

type Deferred = { promise: Promise<void>; resolve(): void; reject(error: Error): void }

function deferred(): Deferred {
  let resolve: () => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

/** A refresh port and a state cell, where a refresh may fill the cell as Orca's service would. */
function fixture(options: { refreshed?: RateLimitHeadroomState } = {}) {
  let state: RateLimitHeadroomState | null = null
  let clock = 1_000_000
  const pending: Deferred[] = []
  const refresh = vi.fn(() => {
    const next = deferred()
    pending.push(next)
    return next.promise.then(() => {
      state = options.refreshed ?? FRESH
    })
  })
  const read = vi.fn(() => state)
  const bounded = createBoundedRateLimitRead({ refresh, read, now: () => clock })
  return {
    refresh,
    read,
    bounded,
    pending,
    advanceClock: (ms: number) => {
      clock += ms
    }
  }
}

const LIVE = new AbortController().signal

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createBoundedRateLimitRead: the refresh before a read', () => {
  it('reads the state that the refresh produced', async () => {
    const f = fixture()
    const result = f.bounded(LIVE)
    f.pending[0]?.resolve()
    expect(await result).toBe(FRESH)
    expect(f.refresh).toHaveBeenCalledTimes(1)
  })

  it('reads again after every refresh rather than returning the refresh result', async () => {
    const f = fixture()
    const result = f.bounded(LIVE)
    expect(f.read).not.toHaveBeenCalled()
    f.pending[0]?.resolve()
    await result
    expect(f.read).toHaveBeenCalledTimes(1)
  })

  it('stops waiting after the wait limit and reads the current state', async () => {
    const f = fixture()
    let settled = false
    const result = f.bounded(LIVE).then((value) => {
      settled = true
      return value
    })
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_REFRESH_WAIT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBeNull()
    expect(settled).toBe(true)
  })

  it('waits at most 12 seconds by default', () => {
    expect(RATE_LIMIT_REFRESH_WAIT_MS).toBe(12_000)
    expect(RATE_LIMIT_REFRESH_MIN_INTERVAL_MS).toBe(60_000)
  })

  it('reads the current state when the refresh rejects', async () => {
    const f = fixture()
    const result = f.bounded(LIVE)
    f.pending[0]?.reject(new Error('usage endpoint failed'))
    expect(await result).toBeNull()
  })

  it('reads the current state when the refresh throws before returning a promise', async () => {
    const read = vi.fn(() => FRESH)
    const bounded = createBoundedRateLimitRead({
      refresh: () => {
        throw new Error('auth preparation failed')
      },
      read,
      now: () => 0
    })
    expect(await bounded(LIVE)).toBe(FRESH)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('leaves no timer behind once the refresh settles', async () => {
    const f = fixture()
    const result = f.bounded(LIVE)
    f.pending[0]?.resolve()
    await result
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('createBoundedRateLimitRead: aborting', () => {
  it('stops waiting as soon as the signal aborts and reads the current state', async () => {
    const f = fixture()
    const controller = new AbortController()
    const result = f.bounded(controller.signal)
    await vi.advanceTimersByTimeAsync(1_000)
    controller.abort()
    expect(await result).toBeNull()
    expect(f.read).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start a refresh for a route that is already aborted', async () => {
    const f = fixture()
    const controller = new AbortController()
    controller.abort()
    expect(await f.bounded(controller.signal)).toBeNull()
    expect(f.refresh).not.toHaveBeenCalled()
  })

  it('keeps the shared refresh running for the other waiters when one route aborts', async () => {
    const f = fixture()
    const aborting = new AbortController()
    const first = f.bounded(aborting.signal)
    const second = f.bounded(LIVE)
    aborting.abort()
    expect(await first).toBeNull()
    f.pending[0]?.resolve()
    expect(await second).toBe(FRESH)
    expect(f.refresh).toHaveBeenCalledTimes(1)
  })
})

describe('createBoundedRateLimitRead: sharing and pacing', () => {
  it('shares one refresh between concurrent reads', async () => {
    const f = fixture()
    const first = f.bounded(LIVE)
    const second = f.bounded(LIVE)
    const third = f.bounded(LIVE)
    f.pending[0]?.resolve()
    expect(await Promise.all([first, second, third])).toEqual([FRESH, FRESH, FRESH])
    expect(f.refresh).toHaveBeenCalledTimes(1)
  })

  it('joins a refresh that outlived the first reader instead of starting another', async () => {
    const f = fixture()
    const first = f.bounded(LIVE)
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_REFRESH_WAIT_MS)
    expect(await first).toBeNull()
    f.advanceClock(RATE_LIMIT_REFRESH_WAIT_MS)
    const second = f.bounded(LIVE)
    f.pending[0]?.resolve()
    expect(await second).toBe(FRESH)
    expect(f.refresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh again inside the minimum interval', async () => {
    const f = fixture()
    const first = f.bounded(LIVE)
    f.pending[0]?.resolve()
    await first
    f.advanceClock(RATE_LIMIT_REFRESH_MIN_INTERVAL_MS - 1)
    expect(await f.bounded(LIVE)).toBe(FRESH)
    expect(f.refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes again once the minimum interval has passed', async () => {
    const f = fixture()
    const first = f.bounded(LIVE)
    f.pending[0]?.resolve()
    await first
    f.advanceClock(RATE_LIMIT_REFRESH_MIN_INTERVAL_MS)
    const second = f.bounded(LIVE)
    f.pending[1]?.resolve()
    await second
    expect(f.refresh).toHaveBeenCalledTimes(2)
  })

  it('counts the interval from when a refresh started, so a failure is not retried at once', async () => {
    const f = fixture()
    const first = f.bounded(LIVE)
    f.pending[0]?.reject(new Error('offline'))
    await first
    f.advanceClock(1_000)
    expect(await f.bounded(LIVE)).toBeNull()
    expect(f.refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes again when the clock moved backwards', async () => {
    const f = fixture()
    const first = f.bounded(LIVE)
    f.pending[0]?.resolve()
    await first
    f.advanceClock(-RATE_LIMIT_REFRESH_MIN_INTERVAL_MS)
    const second = f.bounded(LIVE)
    f.pending[1]?.resolve()
    await second
    expect(f.refresh).toHaveBeenCalledTimes(2)
  })
})
