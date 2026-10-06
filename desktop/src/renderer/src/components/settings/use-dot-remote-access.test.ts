// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import {
  fixtureConfiguredRemoteStatus,
  fixtureConnectedRemoteStatus
} from './dot-remote-access.test-fixture'
import { useDotRemoteAccess } from './use-dot-remote-access'

const rpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
)

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: actual.RuntimeRpcCallError }
})

/** A promise the test settles by hand. */
function held<T>() {
  let settle: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => (settle = resolve))
  return { promise, settle }
}

/** Each method answers its value (or promise); any other method fails the test. */
function answer(byMethod: Record<string, () => unknown>): void {
  rpc.mockImplementation(async (_target, method) => {
    const value = byMethod[method]
    if (!value) {
      throw new Error(`unexpected method ${method}`)
    }
    return value()
  })
}

describe('useDotRemoteAccess: answers of user actions and background reads', () => {
  // Why a block: a function returned from beforeEach runs as a cleanup hook.
  beforeEach(() => {
    rpc.mockReset()
  })
  afterEach(cleanup)

  async function mounted() {
    const hook = renderHook(() => useDotRemoteAccess())
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    return hook
  }

  it('keeps the "Site not told" signal of a revoke when a status read lands meanwhile', async () => {
    const revoke = held<unknown>()
    answer({
      'workbench.dotRemote.status': () => fixtureConnectedRemoteStatus(),
      'workbench.dotRemote.revoke': () => revoke.promise
    })
    const { result } = await mounted()

    let revoking: Promise<boolean> = Promise.resolve(false)
    act(() => {
      revoking = result.current.revoke()
    })
    await act(async () => {
      await result.current.refresh()
    })
    await act(async () => {
      revoke.settle({ siteConfirmed: false, status: fixtureConfiguredRemoteStatus() })
      await revoking
    })

    expect(result.current.siteNotTold).toBe(true)
    expect(result.current.status?.state).toBe('unpaired')
  })

  it('drops a status read that started before a change and lands after its answer', async () => {
    answer({ 'workbench.dotRemote.status': () => fixtureConfiguredRemoteStatus() })
    const { result } = await mounted()
    const read = held<unknown>()
    answer({
      'workbench.dotRemote.status': () => read.promise,
      'workbench.dotRemote.disable': () =>
        fixtureConfiguredRemoteStatus({ state: 'off', enabled: false })
    })

    let reading: Promise<void> = Promise.resolve()
    act(() => {
      reading = result.current.refresh()
    })
    await act(async () => {
      await result.current.setEnabled(false)
    })
    await act(async () => {
      read.settle(fixtureConfiguredRemoteStatus())
      await reading
    })

    expect(result.current.status?.state).toBe('off')
  })
})
