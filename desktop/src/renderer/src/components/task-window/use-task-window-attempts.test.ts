// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attempt, windowState } from './task-window.test-fixture'
import { TASK_WINDOW_ATTEMPTS_POLL_MS, useTaskWindowAttempts } from './use-task-window-attempts'

// TypeScript review L8: a task read slower than the 5 s cadence must not overlap the next one, or an
// older answer could land after a newer one and put back an attempt list that is out of date.

const { rpc, store } = vi.hoisted(() => ({
  rpc: vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>(),
  store: { patchTaskWindowAttempts: vi.fn() }
}))

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const result = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: result.RuntimeRpcCallError }
})
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof store) => unknown) => selector(store)
}))

function held() {
  let settle: (value: unknown) => void = () => undefined
  const promise = new Promise<unknown>((resolve) => (settle = resolve))
  return { promise, settle }
}

const tasksWith = (dispatchIds: string[]) => ({
  tasks: [
    {
      taskId: 'task_fixture01',
      title: 'Review the parser',
      executorKind: 'codex',
      attempts: dispatchIds.map((id) => attempt(id))
    }
  ]
})

describe('useTaskWindowAttempts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    rpc.mockReset()
    store.patchTaskWindowAttempts.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('never starts a task read while the previous one is still out', async () => {
    const slow = held()
    rpc.mockImplementationOnce(() => slow.promise)
    rpc.mockResolvedValue(tasksWith(['ctx_fixture01', 'ctx_fixture02']))
    renderHook(() => useTaskWindowAttempts('file_1', windowState()))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TASK_WINDOW_ATTEMPTS_POLL_MS * 2)
    })
    expect(rpc).toHaveBeenCalledTimes(1)

    await act(async () => {
      slow.settle(tasksWith(['ctx_fixture01']))
      await vi.advanceTimersByTimeAsync(TASK_WINDOW_ATTEMPTS_POLL_MS)
    })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(store.patchTaskWindowAttempts.mock.calls.map((call) => call[1].length)).toEqual([1, 2])
  })
})
