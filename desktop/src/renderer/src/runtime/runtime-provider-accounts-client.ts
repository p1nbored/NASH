import type { GlobalSettings } from '../../../shared/global-settings-types'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../shared/managed-account-types'
import type { RateLimitState } from '../../../shared/rate-limit-types'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { createEmptyClaudeAccountsState } from '../../../shared/claude-accounts-removed'
import { callRuntimeRpc, getActiveRuntimeTarget, RuntimeRpcCallError } from './runtime-rpc-client'

// Mirrors OrcaRuntime.getAccountsSnapshot() / the accounts.subscribe payload. `claude` stays for
// wire compatibility; Claude account switching is removed, so nothing here reads or acts on it.
export type ProviderAccountsSnapshot = {
  claude: ClaudeRateLimitAccountsState
  codex: CodexRateLimitAccountsState
  rateLimits: RateLimitState | null
  // Why: a failed local load substitutes an empty state for the provider;
  // consumers must not treat that half as an authoritative roster.
  failedProviders?: 'codex'[]
}

type ProviderAccountSelection = {
  accountId: string | null
  runtime: 'host' | 'wsl'
  wslDistro?: string | null
}

type ProviderAccountsSubscriptionMessage = {
  type: 'ready' | 'snapshot' | 'end'
  snapshot?: ProviderAccountsSnapshot
}

const REMOTE_ACCOUNTS_FIRST_SNAPSHOT_TIMEOUT_MS = 15_000
// Why: the server applies a selection before it awaits provider usage
// refreshes, and those refreshes can crawl behind broken auth. Give the call
// room to finish instead of reporting failure for an applied switch.
const REMOTE_ACCOUNT_MUTATION_TIMEOUT_MS = 30_000
const pendingProviderAccountsSnapshots = new Map<string, Promise<ProviderAccountsSnapshot>>()

function getProviderAccountsOwnerKey(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): string {
  const target = getActiveRuntimeTarget(settings)
  // Why: environment ids are user-controlled strings; prefix the target kind
  // so a remote id such as “local” cannot share the desktop's pending read.
  return target.kind === 'local' ? 'local' : `environment:${target.environmentId}`
}

export function hasRemoteProviderAccountOwner(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): boolean {
  return getActiveRuntimeTarget(settings).kind === 'environment'
}

export type ProviderAccountsWatcher = {
  close: () => void
}

export function emptyCodexAccountsState(): CodexRateLimitAccountsState {
  return { accounts: [], activeAccountId: null, activeAccountIdsByRuntime: { host: null, wsl: {} } }
}

function codexAccountsLoadError(cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new Error(`Could not load Codex accounts: ${message}`)
}

// Watches the provider-account snapshot for whichever runtime owns accounts.
// Local: one-shot reads of the desktop services (they have no push channel
// here; the pane refetches after each mutation). Remote: a live
// accounts.subscribe stream — the ready message carries the current snapshot
// synchronously and later broadcasts deliver refreshed usage. accounts.list is
// deliberately avoided: it blocks behind provider usage refreshes on the
// server and can hang for minutes behind broken auth.
export function watchProviderAccounts(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
  handlers: {
    onSnapshot: (snapshot: ProviderAccountsSnapshot) => void
    onError: (error: unknown) => void
  }
): ProviderAccountsWatcher {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'local') {
    let closed = false
    // Why: Claude runs on the user's own login, so only Codex has a local roster to read.
    void window.api.codexAccounts.list().then(
      (codex) => {
        if (!closed) {
          handlers.onSnapshot({ claude: createEmptyClaudeAccountsState(), codex, rateLimits: null })
        }
      },
      (reason: unknown) => {
        if (closed) {
          return
        }
        handlers.onSnapshot({
          claude: createEmptyClaudeAccountsState(),
          codex: emptyCodexAccountsState(),
          rateLimits: null,
          failedProviders: ['codex']
        })
        // Why: re-check closed since an onSnapshot handler may close the watcher.
        if (!closed) {
          handlers.onError(codexAccountsLoadError(reason))
        }
      }
    )
    return {
      close: () => {
        closed = true
      }
    }
  }

  let closed = false
  let unsubscribe: (() => void) | null = null
  let receivedSnapshot = false
  // Why: a subscription that never produces a first snapshot looks identical
  // to a loading state; surface it as an error so the pane can say so.
  const firstSnapshotTimer = window.setTimeout(() => {
    if (!closed && !receivedSnapshot) {
      handlers.onError(new Error('Timed out waiting for remote provider accounts.'))
    }
  }, REMOTE_ACCOUNTS_FIRST_SNAPSHOT_TIMEOUT_MS)

  void window.api.runtimeEnvironments
    .subscribe(
      {
        selector: target.environmentId,
        method: 'accounts.subscribe',
        timeoutMs: REMOTE_ACCOUNTS_FIRST_SNAPSHOT_TIMEOUT_MS
      },
      {
        onResponse: (response) => {
          if (closed) {
            return
          }
          const typed = response as RuntimeRpcResponse<ProviderAccountsSubscriptionMessage>
          if (typed.ok === false) {
            handlers.onError(new RuntimeRpcCallError(typed))
            return
          }
          const message = typed.result
          if ((message.type === 'ready' || message.type === 'snapshot') && message.snapshot) {
            receivedSnapshot = true
            handlers.onSnapshot(message.snapshot)
          }
        },
        onError: (error) => {
          if (!closed) {
            handlers.onError(new Error(error.message))
          }
        },
        onClose: () => {
          if (!closed && !receivedSnapshot) {
            handlers.onError(new Error('Remote provider account subscription closed.'))
          }
        }
      }
    )
    .then((handle) => {
      unsubscribe = handle.unsubscribe
      if (closed) {
        unsubscribe()
      }
    })
    .catch((error: unknown) => {
      if (!closed) {
        handlers.onError(error)
      }
    })

  return {
    close: () => {
      closed = true
      window.clearTimeout(firstSnapshotTimer)
      unsubscribe?.()
    }
  }
}

// One-shot convenience over watchProviderAccounts for surfaces that only need
// the current snapshot (status-bar switcher menus).
export function fetchProviderAccountsSnapshot(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): Promise<ProviderAccountsSnapshot> {
  const ownerKey = getProviderAccountsOwnerKey(settings)
  const pending = pendingProviderAccountsSnapshots.get(ownerKey)
  if (pending) {
    return pending
  }

  const request = new Promise<ProviderAccountsSnapshot>((resolve, reject) => {
    const watcher = watchProviderAccounts(settings, {
      onSnapshot: (snapshot) => {
        watcher.close()
        resolve(snapshot)
      },
      onError: (error) => {
        watcher.close()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
  pendingProviderAccountsSnapshots.set(ownerKey, request)
  const clearPending = (): void => {
    if (pendingProviderAccountsSnapshots.get(ownerKey) === request) {
      pendingProviderAccountsSnapshots.delete(ownerKey)
    }
  }
  // Why: both status-bar switchers mount together; share their in-flight read
  // without caching the result past completion or across account owners.
  void request.then(clearPending, clearPending)
  return request
}

export async function selectCodexProviderAccount(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
  selection: ProviderAccountSelection
): Promise<CodexRateLimitAccountsState> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'environment') {
    return callRuntimeRpc<CodexRateLimitAccountsState>(
      target,
      'accounts.selectCodex',
      { accountId: selection.accountId },
      { timeoutMs: REMOTE_ACCOUNT_MUTATION_TIMEOUT_MS }
    )
  }
  return window.api.codexAccounts.select(selection)
}

export async function removeCodexProviderAccount(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
  accountId: string
): Promise<CodexRateLimitAccountsState> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'environment') {
    return callRuntimeRpc<CodexRateLimitAccountsState>(
      target,
      'accounts.removeCodex',
      { accountId },
      { timeoutMs: REMOTE_ACCOUNT_MUTATION_TIMEOUT_MS }
    )
  }
  return window.api.codexAccounts.remove({ accountId })
}
