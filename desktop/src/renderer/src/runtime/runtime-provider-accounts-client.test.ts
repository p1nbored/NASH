import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../shared/managed-account-types'
import {
  fetchProviderAccountsSnapshot,
  removeCodexProviderAccount,
  selectCodexProviderAccount,
  watchProviderAccounts,
  type ProviderAccountsSnapshot
} from './runtime-provider-accounts-client'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from './runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'

const LOCAL = { activeRuntimeEnvironmentId: null }
const REMOTE = { activeRuntimeEnvironmentId: 'env-1' }

function emptyClaudeState(): ClaudeRateLimitAccountsState {
  return { accounts: [], activeAccountId: null, activeAccountIdsByRuntime: { host: null, wsl: {} } }
}

function emptyCodexState(): CodexRateLimitAccountsState {
  return { accounts: [], activeAccountId: null, activeAccountIdsByRuntime: { host: null, wsl: {} } }
}

function snapshotFixture(marker: string): ProviderAccountsSnapshot {
  return {
    claude: {
      ...emptyClaudeState(),
      activeAccountId: `claude-${marker}`
    },
    codex: {
      ...emptyCodexState(),
      activeAccountId: `codex-${marker}`
    },
    rateLimits: null
  }
}

type SubscriptionCallbacks = {
  onResponse: (response: unknown) => void
  onError?: (error: { code: string; message: string }) => void
  onClose?: () => void
}

const runtimeEnvironmentCall = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()
const runtimeEnvironmentSubscribe = vi.fn()
const codexListLocal = vi.fn()
const codexSelectLocal = vi.fn()
const codexRemoveLocal = vi.fn()
const unsubscribe = vi.fn()

let subscriptionCallbacks: SubscriptionCallbacks | null = null

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  vi.restoreAllMocks()
  for (const mock of [
    runtimeEnvironmentCall,
    runtimeEnvironmentTransportCall,
    runtimeEnvironmentSubscribe,
    codexListLocal,
    codexSelectLocal,
    codexRemoveLocal,
    unsubscribe
  ]) {
    mock.mockReset()
  }
  subscriptionCallbacks = null
  runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
    return createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
  })
  runtimeEnvironmentSubscribe.mockImplementation(
    async (_args: unknown, callbacks: SubscriptionCallbacks) => {
      subscriptionCallbacks = callbacks
      return { unsubscribe, sendBinary: () => false }
    }
  )
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    api: {
      runtimeEnvironments: {
        call: runtimeEnvironmentTransportCall,
        subscribe: runtimeEnvironmentSubscribe
      },
      codexAccounts: {
        list: codexListLocal,
        select: codexSelectLocal,
        remove: codexRemoveLocal
      }
    }
  })
})

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('without Claude account switching', () => {
  it('reads only the local Codex service and publishes the empty Claude roster', async () => {
    codexListLocal.mockResolvedValue(emptyCodexState())
    const snapshots: ProviderAccountsSnapshot[] = []

    watchProviderAccounts(LOCAL, {
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onError: () => {
        throw new Error('unexpected error')
      }
    })
    await flushMicrotasks()

    expect(snapshots).toEqual([
      {
        claude: { accounts: [], activeAccountId: null },
        codex: emptyCodexState(),
        rateLimits: null
      }
    ])
    expect(codexListLocal).toHaveBeenCalledTimes(1)
  })

  it('offers no Claude select or remove call', async () => {
    const client = await import('./runtime-provider-accounts-client')

    expect('selectClaudeProviderAccount' in client).toBe(false)
    expect('removeClaudeProviderAccount' in client).toBe(false)
  })
})

describe('watchProviderAccounts', () => {
  it('reads local services once when no runtime environment is active', async () => {
    codexListLocal.mockResolvedValue(emptyCodexState())
    const snapshots: ProviderAccountsSnapshot[] = []

    watchProviderAccounts(LOCAL, {
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onError: () => {
        throw new Error('unexpected error')
      }
    })
    await flushMicrotasks()

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.rateLimits).toBeNull()
    expect(codexListLocal).toHaveBeenCalledTimes(1)
    expect(runtimeEnvironmentSubscribe).not.toHaveBeenCalled()
  })

  it('does not deliver a late local snapshot after close', async () => {
    let resolveCodex: (state: CodexRateLimitAccountsState) => void = () => {}
    codexListLocal.mockImplementation(
      () => new Promise<CodexRateLimitAccountsState>((resolve) => (resolveCodex = resolve))
    )
    const snapshots: ProviderAccountsSnapshot[] = []

    const watcher = watchProviderAccounts(LOCAL, {
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onError: () => {}
    })
    watcher.close()
    resolveCodex(emptyCodexState())
    await flushMicrotasks()

    expect(snapshots).toHaveLength(0)
  })

  it('marks the substituted Codex roster as failed when the Codex list fails', async () => {
    codexListLocal.mockRejectedValue(new Error('Codex home missing'))
    const snapshots: ProviderAccountsSnapshot[] = []
    const errors: unknown[] = []

    watchProviderAccounts(LOCAL, {
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onError: (error) => errors.push(error)
    })
    await flushMicrotasks()

    expect(snapshots).toEqual([
      {
        claude: { accounts: [], activeAccountId: null },
        codex: emptyCodexState(),
        rateLimits: null,
        failedProviders: ['codex']
      }
    ])
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('Could not load Codex accounts: Codex home missing')
  })

  it('streams remote snapshots from accounts.subscribe and unsubscribes on close', async () => {
    const snapshots: ProviderAccountsSnapshot[] = []
    const watcher = watchProviderAccounts(REMOTE, {
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onError: () => {
        throw new Error('unexpected error')
      }
    })
    await flushMicrotasks()

    expect(runtimeEnvironmentSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ selector: 'env-1', method: 'accounts.subscribe' }),
      expect.any(Object)
    )
    subscriptionCallbacks?.onResponse({
      ok: true,
      result: { type: 'ready', snapshot: snapshotFixture('ready') }
    })
    subscriptionCallbacks?.onResponse({
      ok: true,
      result: { type: 'snapshot', snapshot: snapshotFixture('refresh') }
    })

    expect(snapshots.map((s) => s.codex.activeAccountId)).toEqual(['codex-ready', 'codex-refresh'])
    expect(codexListLocal).not.toHaveBeenCalled()

    watcher.close()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    subscriptionCallbacks?.onResponse({
      ok: true,
      result: { type: 'snapshot', snapshot: snapshotFixture('late') }
    })
    expect(snapshots).toHaveLength(2)
  })

  it('surfaces remote subscription failures as errors', async () => {
    const errors: unknown[] = []
    watchProviderAccounts(REMOTE, {
      onSnapshot: () => {
        throw new Error('unexpected snapshot')
      },
      onError: (error) => errors.push(error)
    })
    await flushMicrotasks()

    subscriptionCallbacks?.onResponse({
      ok: false,
      error: { code: 'forbidden', message: 'denied' }
    })

    expect(errors).toHaveLength(1)
    expect(String((errors[0] as Error).message)).toContain('denied')
  })
})

describe('fetchProviderAccountsSnapshot', () => {
  it('deduplicates concurrent local reads but does not cache completed snapshots', async () => {
    let resolveCodex!: (state: CodexRateLimitAccountsState) => void
    codexListLocal.mockImplementation(
      () => new Promise<CodexRateLimitAccountsState>((resolve) => (resolveCodex = resolve))
    )

    const first = fetchProviderAccountsSnapshot(LOCAL)
    const second = fetchProviderAccountsSnapshot(LOCAL)

    expect(second).toBe(first)
    expect(codexListLocal).toHaveBeenCalledTimes(1)

    resolveCodex(emptyCodexState())
    await Promise.all([first, second])

    codexListLocal.mockResolvedValue(emptyCodexState())
    await fetchProviderAccountsSnapshot(LOCAL)
    expect(codexListLocal).toHaveBeenCalledTimes(2)
  })

  it('isolates in-flight snapshots by remote account owner', async () => {
    const first = fetchProviderAccountsSnapshot({ activeRuntimeEnvironmentId: 'env-1' })
    const second = fetchProviderAccountsSnapshot({ activeRuntimeEnvironmentId: 'env-2' })
    await flushMicrotasks()

    expect(runtimeEnvironmentSubscribe).toHaveBeenCalledTimes(2)
    const firstCallbacks = runtimeEnvironmentSubscribe.mock.calls[0]?.[1] as SubscriptionCallbacks
    const secondCallbacks = runtimeEnvironmentSubscribe.mock.calls[1]?.[1] as SubscriptionCallbacks
    firstCallbacks.onResponse({
      ok: true,
      result: { type: 'ready', snapshot: snapshotFixture('one') }
    })
    secondCallbacks.onResponse({
      ok: true,
      result: { type: 'ready', snapshot: snapshotFixture('two') }
    })

    await expect(first).resolves.toMatchObject({ codex: { activeAccountId: 'codex-one' } })
    await expect(second).resolves.toMatchObject({ codex: { activeAccountId: 'codex-two' } })
  })

  it('does not share a local read with a remote environment named local', async () => {
    let resolveCodex!: (state: CodexRateLimitAccountsState) => void
    codexListLocal.mockImplementation(
      () => new Promise<CodexRateLimitAccountsState>((resolve) => (resolveCodex = resolve))
    )

    const local = fetchProviderAccountsSnapshot(LOCAL)
    const remote = fetchProviderAccountsSnapshot({ activeRuntimeEnvironmentId: 'local' })
    await flushMicrotasks()

    expect(remote).not.toBe(local)
    expect(runtimeEnvironmentSubscribe).toHaveBeenCalledTimes(1)
    subscriptionCallbacks?.onResponse({
      ok: true,
      result: { type: 'ready', snapshot: snapshotFixture('remote-local') }
    })
    resolveCodex(emptyCodexState())

    await expect(remote).resolves.toMatchObject({
      codex: { activeAccountId: 'codex-remote-local' }
    })
    await expect(local).resolves.toMatchObject({ codex: { activeAccountId: null } })
  })

  it('resolves with the first remote snapshot and closes the subscription', async () => {
    const pending = fetchProviderAccountsSnapshot(REMOTE)
    await flushMicrotasks()
    subscriptionCallbacks?.onResponse({
      ok: true,
      result: { type: 'ready', snapshot: snapshotFixture('ready') }
    })

    await expect(pending).resolves.toMatchObject({
      codex: { activeAccountId: 'codex-ready' }
    })
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('rejects when the remote subscription closes before any snapshot', async () => {
    const pending = fetchProviderAccountsSnapshot(REMOTE)
    await flushMicrotasks()
    subscriptionCallbacks?.onClose?.()

    await expect(pending).rejects.toThrow('subscription closed')
  })

  it('resolves a failed local Codex read as a marked snapshot so menus keep prior state', async () => {
    codexListLocal.mockRejectedValue(new Error('Codex home missing'))

    await expect(fetchProviderAccountsSnapshot(LOCAL)).resolves.toEqual({
      claude: { accounts: [], activeAccountId: null },
      codex: emptyCodexState(),
      rateLimits: null,
      failedProviders: ['codex']
    })
  })
})

describe('provider account mutations', () => {
  it('routes select through local IPC with the full runtime target when local', async () => {
    codexSelectLocal.mockResolvedValue(emptyCodexState())

    await selectCodexProviderAccount(LOCAL, {
      accountId: 'acc-1',
      runtime: 'wsl',
      wslDistro: 'Ubuntu'
    })

    expect(codexSelectLocal).toHaveBeenCalledWith({
      accountId: 'acc-1',
      runtime: 'wsl',
      wslDistro: 'Ubuntu'
    })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })

  it('routes select and remove through the active runtime accounts RPC when remote', async () => {
    runtimeEnvironmentCall.mockImplementation(() => ({
      id: 'call',
      ok: true,
      result: emptyCodexState()
    }))

    await selectCodexProviderAccount(REMOTE, {
      accountId: 'server-codex-2',
      runtime: 'host',
      wslDistro: null
    })
    await removeCodexProviderAccount(REMOTE, 'server-codex-1')

    const methods = runtimeEnvironmentCall.mock.calls.map(
      (call) => (call[0] as { method: string; params: unknown }).method
    )
    expect(methods).toEqual(['accounts.selectCodex', 'accounts.removeCodex'])
    expect(runtimeEnvironmentCall.mock.calls[0]?.[0]).toMatchObject({
      selector: 'env-1',
      // Why this matters: the server API takes only accountId; host/WSL
      // targeting is a desktop-local concept and must not leak into params.
      params: { accountId: 'server-codex-2' }
    })
    expect(codexSelectLocal).not.toHaveBeenCalled()
    expect(codexRemoveLocal).not.toHaveBeenCalled()
  })
})
