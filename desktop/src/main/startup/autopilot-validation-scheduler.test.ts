import { describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import { WORKBENCH_VALIDATION_ERROR_CODES } from '../../shared/rpc-contract/workbench-validation-params'
import type {
  ValidationRunner,
  ValidationRunReport
} from '../runtime/task-validation/validation-runner'
import { createValidationScheduler } from './autopilot-validation-scheduler'

const CODES = WORKBENCH_VALIDATION_ERROR_CODES

async function refusalOf(pass: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await pass
  } catch (error) {
    if (error instanceof OrchestrationError) {
      return { code: error.code, message: error.message }
    }
    throw error
  }
  throw new Error('The pass was not refused.')
}

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function runner(order: string[], hold?: Promise<void>) {
  const fake = {
    validateAttempt: vi.fn(async (dispatchId: string, signal?: AbortSignal) => {
      order.push(`start:${dispatchId}`)
      await Promise.race([
        hold ?? Promise.resolve(),
        new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()))
      ])
      order.push(`end:${dispatchId}`)
      return { dispatchId, outcome: 'skipped', reason: 'fixture' }
    }),
    validatePending: vi.fn(
      async (_options?: { signal?: AbortSignal }): Promise<ValidationRunReport[]> => {
        order.push('pending')
        return []
      }
    )
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the scheduler calls only these two members.
  return { fake, typed: fake as unknown as ValidationRunner }
}

describe('createValidationScheduler', () => {
  it('validates one attempt at a time, in claim order', async () => {
    const order: string[] = []
    const { typed } = runner(order)
    const scheduler = createValidationScheduler({ runner: typed, log: vi.fn() })
    scheduler.validateAttempt('ctx_a')
    scheduler.validateAttempt('ctx_b')
    await scheduler.drain()
    expect(order).toEqual(['start:ctx_a', 'end:ctx_a', 'pending', 'start:ctx_b', 'end:ctx_b'])
  })

  it('sweeps the backlog once, after the first claim, never at creation', async () => {
    const order: string[] = []
    const { fake, typed } = runner(order)
    const scheduler = createValidationScheduler({ runner: typed, log: vi.fn() })
    await scheduler.drain()
    expect(fake.validatePending).not.toHaveBeenCalled()
    scheduler.validateAttempt('ctx_a')
    scheduler.validateAttempt('ctx_b')
    await scheduler.drain()
    expect(fake.validatePending).toHaveBeenCalledTimes(1)
  })

  it('aborts the running validation and drops the queued ones', async () => {
    const order: string[] = []
    const hold = deferred()
    const { fake, typed } = runner(order, hold.promise)
    const scheduler = createValidationScheduler({ runner: typed, log: vi.fn() })
    scheduler.validateAttempt('ctx_a')
    scheduler.validateAttempt('ctx_b')
    await vi.waitFor(() => expect(order).toEqual(['start:ctx_a']))
    scheduler.abort()
    await scheduler.drain()
    expect(order).toEqual(['start:ctx_a', 'end:ctx_a'])
    expect(fake.validateAttempt.mock.calls[0]?.[1]?.aborted).toBe(true)
    scheduler.validateAttempt('ctx_c')
    await scheduler.drain()
    expect(fake.validateAttempt).toHaveBeenCalledTimes(1)
    hold.resolve()
  })

  it('runs the backlog pass of a check now behind attempts already queued, one at a time', async () => {
    const order: string[] = []
    const hold = deferred()
    const { fake, typed } = runner(order, hold.promise)
    const scheduler = createValidationScheduler({ runner: typed, log: vi.fn() })
    await scheduler.checkBacklog()
    scheduler.validateAttempt('ctx_b')
    const pass = scheduler.checkBacklog()
    await vi.waitFor(() => expect(order).toEqual(['pending', 'start:ctx_b']))
    hold.resolve()
    await pass
    expect(order).toEqual(['pending', 'start:ctx_b', 'end:ctx_b', 'pending'])
    expect(fake.validatePending.mock.calls[0]?.[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('logs a failed validation by code and keeps going', async () => {
    const order: string[] = []
    const { fake, typed } = runner(order)
    fake.validateAttempt.mockRejectedValueOnce(
      new OrchestrationError('autopilot_validation_fixture', 'C:/private/path text')
    )
    const log = vi.fn()
    const scheduler = createValidationScheduler({ runner: typed, log })
    scheduler.validateAttempt('ctx_a')
    scheduler.validateAttempt('ctx_b')
    await scheduler.drain()
    expect(log).toHaveBeenCalledWith({
      event: 'validation_failed',
      code: 'autopilot_validation_fixture',
      dispatchId: 'ctx_a'
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('private')
    expect(order).toContain('end:ctx_b')
  })
})

describe('checkBacklog (the desktop check now)', () => {
  it('runs one backlog pass and answers its counts by outcome', async () => {
    const order: string[] = []
    const { fake, typed } = runner(order)
    fake.validatePending.mockResolvedValueOnce([
      { dispatchId: 'ctx_a', outcome: 'settled', verdict: 'pass', validationId: 'val_a' },
      { dispatchId: 'ctx_b', outcome: 'settled', verdict: 'fail', validationId: 'val_b' },
      { dispatchId: 'ctx_c', outcome: 'settled', verdict: 'inconclusive', validationId: 'val_c' },
      { dispatchId: 'ctx_d', outcome: 'skipped', reason: 'in_flight' }
    ])
    const scheduler = createValidationScheduler({ runner: typed, log: vi.fn() })
    await expect(scheduler.checkBacklog()).resolves.toEqual({
      checked: 4,
      passed: 1,
      failed: 1,
      inconclusive: 1,
      skipped: 1
    })
    expect(fake.validatePending).toHaveBeenCalledTimes(1)
  })

  it('counts as the session sweep, so the first claim afterwards does not sweep again', async () => {
    const order: string[] = []
    const { fake, typed } = runner(order)
    const scheduler = createValidationScheduler({ runner: typed, log: vi.fn() })
    await scheduler.checkBacklog()
    scheduler.validateAttempt('ctx_a')
    await scheduler.drain()
    expect(fake.validatePending).toHaveBeenCalledTimes(1)
  })

  it('refuses a second pass while one is queued or running, then allows the next', async () => {
    const order: string[] = []
    const { fake, typed } = runner(order)
    const hold = deferred()
    fake.validatePending.mockImplementationOnce(async () => {
      await hold.promise
      return []
    })
    const scheduler = createValidationScheduler({ runner: typed, log: vi.fn() })
    const first = scheduler.checkBacklog()
    expect((await refusalOf(scheduler.checkBacklog())).code).toBe(CODES.passRunning)
    hold.resolve()
    await first
    await expect(scheduler.checkBacklog()).resolves.toMatchObject({ checked: 0 })
    expect(fake.validatePending).toHaveBeenCalledTimes(2)
  })

  it('refuses while the first-claim sweep is still queued', async () => {
    const order: string[] = []
    const { fake, typed } = runner(order)
    const scheduler = createValidationScheduler({ runner: typed, log: vi.fn() })
    scheduler.validateAttempt('ctx_a')
    expect((await refusalOf(scheduler.checkBacklog())).code).toBe(CODES.passRunning)
    await scheduler.drain()
    await expect(scheduler.checkBacklog()).resolves.toMatchObject({ checked: 0 })
    expect(fake.validatePending).toHaveBeenCalledTimes(2)
  })

  it('refuses once validation is aborted, and refuses a pass the quit dropped before it ran', async () => {
    const order: string[] = []
    const hold = deferred()
    const { fake, typed } = runner(order, hold.promise)
    const scheduler = createValidationScheduler({ runner: typed, log: vi.fn() })
    await scheduler.checkBacklog()
    scheduler.validateAttempt('ctx_a')
    const queued = scheduler.checkBacklog()
    await vi.waitFor(() => expect(order).toContain('start:ctx_a'))
    scheduler.abort()
    expect((await refusalOf(queued)).code).toBe(CODES.unavailable)
    expect((await refusalOf(scheduler.checkBacklog())).code).toBe(CODES.unavailable)
    expect(fake.validatePending).toHaveBeenCalledTimes(1)
    hold.resolve()
  })

  it('answers a failed pass with a fixed code and message, logs its code, and allows a retry', async () => {
    const order: string[] = []
    const { fake, typed } = runner(order)
    fake.validatePending.mockRejectedValueOnce(
      new OrchestrationError('autopilot_store_fixture', 'C:/private/journal.db is locked')
    )
    const log = vi.fn()
    const scheduler = createValidationScheduler({ runner: typed, log })
    const refusal = await refusalOf(scheduler.checkBacklog())
    expect(refusal.code).toBe(CODES.passFailed)
    expect(refusal.message).not.toContain('private')
    expect(log).toHaveBeenCalledWith({
      event: 'validation_failed',
      code: 'autopilot_store_fixture'
    })
    await expect(scheduler.checkBacklog()).resolves.toMatchObject({ checked: 0 })
  })
})
