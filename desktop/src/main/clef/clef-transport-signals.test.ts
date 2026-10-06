import { describe, expect, it, vi } from 'vitest'
import {
  CLEF_RETRY_BASE_MS,
  CLEF_RETRY_CAP_MS,
  abortableSleep,
  fullJitterDelay,
  startClefDeadline,
  untilAborted,
  type ClefTimers
} from './clef-transport-signals'

function createManualTimers(): ClefTimers & {
  pending: () => { ms: number; fire: () => void }[]
} {
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

describe('fullJitterDelay', () => {
  it('draws from [0, base * 2^(attempt-1)) capped at 4 s', () => {
    expect(CLEF_RETRY_BASE_MS).toBe(500)
    expect(CLEF_RETRY_CAP_MS).toBe(4000)
    expect(fullJitterDelay(1, () => 0)).toBe(0)
    expect(fullJitterDelay(1, () => 0.999_999)).toBe(499)
    expect(fullJitterDelay(2, () => 0.5)).toBe(500)
    expect(fullJitterDelay(3, () => 0.999_999)).toBe(1999)
    expect(fullJitterDelay(4, () => 0.999_999)).toBe(3999)
    expect(fullJitterDelay(5, () => 0.999_999)).toBe(3999)
    expect(fullJitterDelay(30, () => 0.999_999)).toBe(3999)
  })

  it.each([1, 2, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'clamps a bad random value %s into the window',
    (value) => {
      const delay = fullJitterDelay(1, () => value)
      expect(delay).toBeGreaterThanOrEqual(0)
      expect(delay).toBeLessThan(CLEF_RETRY_BASE_MS)
    }
  )
})

describe('startClefDeadline', () => {
  it('aborts once the injected timer fires', () => {
    const timers = createManualTimers()
    const deadline = startClefDeadline(30_000, timers)
    expect(timers.pending().map((timer) => timer.ms)).toEqual([30_000])
    expect(deadline.signal.aborted).toBe(false)
    timers.pending()[0].fire()
    expect(deadline.signal.aborted).toBe(true)
  })

  it('clears its timer on dispose', () => {
    const timers = createManualTimers()
    startClefDeadline(30_000, timers).dispose()
    expect(timers.pending()).toEqual([])
  })
})

describe('abortableSleep', () => {
  it('resolves when the timer fires', async () => {
    const timers = createManualTimers()
    const sleeping = abortableSleep(250, new AbortController().signal, timers)
    expect(timers.pending().map((timer) => timer.ms)).toEqual([250])
    timers.pending()[0].fire()
    await expect(sleeping).resolves.toBeUndefined()
  })

  it('resolves early on abort and clears its timer', async () => {
    const timers = createManualTimers()
    const controller = new AbortController()
    const sleeping = abortableSleep(250, controller.signal, timers)
    controller.abort()
    await expect(sleeping).resolves.toBeUndefined()
    expect(timers.pending()).toEqual([])
  })

  it('does not schedule anything when already aborted', async () => {
    const timers = createManualTimers()
    const controller = new AbortController()
    controller.abort()
    await abortableSleep(250, controller.signal, timers)
    expect(timers.pending()).toEqual([])
  })

  it('works with the real default timers', async () => {
    await expect(abortableSleep(1, new AbortController().signal)).resolves.toBeUndefined()
  })
})

describe('untilAborted', () => {
  it('resolves with the value when the work settles first', async () => {
    const result = await untilAborted(async () => 'done', new AbortController().signal)
    expect(result).toEqual({ aborted: false, value: 'done' })
  })

  it('resolves aborted when the signal fires first and never lets a late rejection escape', async () => {
    const controller = new AbortController()
    let rejectWork: (reason: unknown) => void = () => {}
    const racing = untilAborted(
      () => new Promise<string>((_resolve, reject) => (rejectWork = reject)),
      controller.signal
    )
    controller.abort()
    await expect(racing).resolves.toEqual({ aborted: true })
    rejectWork(new Error('late failure'))
    await Promise.resolve()
  })

  it('does not start the work when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const work = vi.fn(async () => 'never')
    await expect(untilAborted(work, controller.signal)).resolves.toEqual({ aborted: true })
    expect(work).not.toHaveBeenCalled()
  })

  it('rejects when the work rejects or throws before any abort', async () => {
    const signal = new AbortController().signal
    await expect(
      untilAborted(async () => {
        throw new Error('rejected')
      }, signal)
    ).rejects.toThrow('rejected')
    await expect(
      untilAborted(() => {
        throw new Error('threw')
      }, signal)
    ).rejects.toThrow('threw')
  })

  it('removes its abort listener once the work has settled', async () => {
    const signal = new AbortController().signal
    const removeListener = vi.spyOn(signal, 'removeEventListener')
    await untilAborted(async () => 1, signal)
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
