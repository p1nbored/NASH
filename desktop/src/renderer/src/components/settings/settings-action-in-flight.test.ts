// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { useClefCredentials } from './use-clef-credentials'
import { useClefVerification } from './use-clef-verification'
import { useRoutingTable } from './use-routing-table'
import { fixtureEdit } from './routing-table-view.test-fixture'

// TypeScript review L9: a disabled button re-renders only after the click, so a second call in the
// same turn (Enter then click, a double click) must be refused by the hook itself.

const rpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
)

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: actual.RuntimeRpcCallError }
})

const credentialsApi = vi.hoisted(() => ({ status: vi.fn(), save: vi.fn(), clear: vi.fn() }))

/** A promise the test settles by hand. */
function held() {
  let settle: (value: unknown) => void = () => undefined
  const promise = new Promise<unknown>((resolve) => (settle = resolve))
  return { promise, settle }
}

/** The held method waits for the test; every other method is refused like an absent runtime. */
function holdMethod(method: string) {
  const call = held()
  rpc.mockImplementation(async (_target, name) => {
    if (name === method) {
      return call.promise
    }
    throw new Error(`Fixture: ${name} is not answered here.`)
  })
  return call
}

const callsTo = (method: string): number => rpc.mock.calls.filter((c) => c[1] === method).length

describe('settings actions refuse a second call while one runs', () => {
  beforeEach(() => {
    rpc.mockReset()
    vi.clearAllMocks()
    credentialsApi.status.mockResolvedValue(null)
    Object.assign(window, { api: { clefCredentials: credentialsApi } })
  })
  afterEach(cleanup)

  it('Clef Verify and Pin: one call at a time, and the next one starts after it ends', async () => {
    const verify = holdMethod('workbench.clef.verify')
    const { result } = renderHook(() => useClefVerification())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.verify()
      void result.current.verify()
      void result.current.pin('0'.repeat(64))
    })
    expect(callsTo('workbench.clef.verify')).toBe(1)
    expect(callsTo('workbench.clef.profile.pin')).toBe(0)

    await act(async () => {
      verify.settle({})
      await first
    })
    act(() => {
      void result.current.verify()
    })
    expect(callsTo('workbench.clef.verify')).toBe(2)
  })

  it('Clef credentials: save and clear run one at a time', async () => {
    const save = held()
    credentialsApi.save.mockReturnValue(save.promise)
    const { result } = renderHook(() => useClefCredentials())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let first: Promise<void> = Promise.resolve()
    const input = { token: 'FIXTURE_ONLY_token', accountId: '0123456789abcdef0123456789abcdef' }
    act(() => {
      first = result.current.save(input)
      void result.current.save(input)
      void result.current.clear()
    })
    expect(credentialsApi.save).toHaveBeenCalledTimes(1)
    expect(credentialsApi.clear).not.toHaveBeenCalled()

    await act(async () => {
      save.settle(null)
      await first
    })
    act(() => {
      void result.current.clear()
    })
    expect(credentialsApi.clear).toHaveBeenCalledTimes(1)
  })

  it('Routing Table saves: a second save is refused while one runs', async () => {
    const imported = holdMethod('workbench.routingTable.save')
    const { result } = renderHook(() => useRoutingTable())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let first: Promise<boolean> = Promise.resolve(false)
    let second: Promise<boolean> = Promise.resolve(true)
    act(() => {
      first = result.current.applyEdit(fixtureEdit())
      second = result.current.applyEdit(fixtureEdit())
    })
    expect(await second).toBe(false)
    expect(callsTo('workbench.routingTable.save')).toBe(1)

    await act(async () => {
      imported.settle(null)
      await first
    })
  })

  it('Routing Table: Check now runs once at a time, and no decision starts while it runs', async () => {
    const check = holdMethod('workbench.routingTable.checkRoutes')
    const { result } = renderHook(() => useRoutingTable())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let checking: Promise<void> = Promise.resolve()
    let decided: Promise<boolean> = Promise.resolve(true)
    act(() => {
      checking = result.current.checkRoutes()
      void result.current.checkRoutes()
      decided = result.current.applyEdit(fixtureEdit())
    })
    expect(await decided).toBe(false)
    expect(callsTo('workbench.routingTable.checkRoutes')).toBe(1)
    expect(callsTo('workbench.routingTable.save')).toBe(0)

    await act(async () => {
      check.settle(null)
      await checking
    })
  })
})
