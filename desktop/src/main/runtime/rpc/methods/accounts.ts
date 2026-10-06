import { defineMethod, defineStreamingMethod } from '../core'
import {
  ClaudeAccountsRemovedError,
  createEmptyClaudeAccountsState
} from '../../../../shared/claude-accounts-removed'
import {
  AddDataAccountParams,
  SelectDataAccountParams,
  RemoveDataAccountParams,
  AccountsUnsubscribeParams,
  AddClaudeFromConfigDirParams,
  AddCodexFromHomeParams,
  ConsumeCodexResetCreditParams,
  ListAccountsParams,
  RemoveAccountParams,
  SelectAccountParams,
  SelectCodexAccountForTargetParams
} from '../../../../shared/rpc-contract/accounts-params'

// Why: monotonically increasing per-process counter avoids the Date.now()
// collision that fired when two near-simultaneous accounts.subscribe calls
// collided on the same millisecond and one evicted the other through
// registerSubscriptionCleanup's existing-key eviction path.
let accountsSubscriptionSeq = 0

// Why: bridges the desktop CodexAccountService / RateLimitService into the
// WebSocket / local-socket RPC. Read + switch + remove for all clients;
// interactive add/re-auth flows spawn `codex login` PTYs that need a desktop
// browser, so they intentionally remain desktop-only. Claude account switching
// was removed (Claude runs on the user's own login): the Claude methods stay as
// stubs so mixed-version clients get a clear claude_accounts_removed code.
export const ACCOUNT_METHODS = [
  defineMethod({
    name: 'accounts.listData',
    params: null,
    handler: async (_, { runtime }) => runtime.getDataAccountsSnapshot()
  }),
  defineMethod({
    name: 'accounts.addDataFromHome',
    params: AddDataAccountParams,
    handler: async (params, { runtime, clientKind }) => {
      if (clientKind !== undefined) {
        throw new Error('Adding accounts is only available on the Orca host runtime.')
      }
      return runtime.addDataAccountFromHome(params.provider, params.sourceDataHome, params.label)
    }
  }),
  defineMethod({
    name: 'accounts.selectData',
    params: SelectDataAccountParams,
    handler: async (params, { runtime }) =>
      runtime.selectDataAccount(params.provider, params.accountId)
  }),
  defineMethod({
    name: 'accounts.removeData',
    params: RemoveDataAccountParams,
    handler: async (params, { runtime }) =>
      runtime.removeDataAccount(params.provider, params.accountId)
  }),
  defineMethod({
    name: 'accounts.list',
    params: ListAccountsParams,
    handler: async (params, { runtime }) => {
      // Why: ensure the snapshot reflects the latest provider state before
      // returning. Desktop polling pauses when the window is unfocused and
      // inactive-account caches only fill on AccountsPane open, so without
      // this the mobile UI would render stale nulls / zeroes.
      if (params.refreshUsage) {
        await runtime.refreshAccountsForMobile()
      }
      return runtime.getAccountsSnapshot()
    }
  }),
  defineMethod({
    name: 'accounts.selectClaude',
    params: SelectAccountParams,
    handler: async (params) => {
      // Why: selecting the system default is what an old client sends to leave a managed account.
      if (params.accountId === null) {
        return createEmptyClaudeAccountsState()
      }
      throw new ClaudeAccountsRemovedError()
    }
  }),
  defineMethod({
    name: 'accounts.selectCodex',
    params: SelectAccountParams,
    handler: async (params, { runtime }) => runtime.selectCodexAccount(params.accountId)
  }),
  defineMethod({
    // Why: old hosts silently strip unknown target fields from selectCodex.
    // A distinct RPC makes version skew fail before it can clear the host slot.
    name: 'accounts.selectCodexForTarget',
    params: SelectCodexAccountForTargetParams,
    handler: async (params, { runtime }) =>
      runtime.selectCodexAccountForTarget(params.accountId, params.target)
  }),
  defineMethod({
    name: 'accounts.consumeCodexResetCredit',
    params: ConsumeCodexResetCreditParams,
    handler: async (params, { runtime }) =>
      runtime.consumeCodexRateLimitResetCredit(params.idempotencyKey, params.expectedScope)
  }),
  defineMethod({
    name: 'accounts.removeClaude',
    params: RemoveAccountParams,
    handler: async () => {
      throw new ClaudeAccountsRemovedError()
    }
  }),
  defineMethod({
    name: 'accounts.removeCodex',
    params: RemoveAccountParams,
    handler: async (params, { runtime }) => runtime.removeCodexAccount(params.accountId)
  }),
  defineMethod({
    name: 'accounts.addClaudeFromConfigDir',
    params: AddClaudeFromConfigDirParams,
    handler: async (_params, { clientKind }) => {
      // Why: keep the paired-device refusal first so a remote token learns nothing new.
      if (clientKind !== undefined) {
        throw new Error('Adding Claude accounts is only available on the Orca host runtime.')
      }
      throw new ClaudeAccountsRemovedError()
    }
  }),
  defineMethod({
    name: 'accounts.addCodexFromHome',
    params: AddCodexFromHomeParams,
    handler: async (params, { runtime, clientKind }) => {
      if (clientKind !== undefined) {
        throw new Error('Adding Codex accounts is only available on the Orca host runtime.')
      }
      return runtime.addCodexAccountFromHome(params.sourceHome, {
        runtime: params.runtime,
        wslDistro: params.wslDistro ?? null
      })
    }
  }),
  // Why: streaming counterpart so mobile usage bars refresh in place when the
  // desktop's 5-minute rate-limit poll completes or when the user switches
  // accounts on either side. Mirrors the notifications.subscribe pattern.
  defineStreamingMethod({
    name: 'accounts.subscribe',
    params: null,
    handler: async (_params, { runtime, connectionId }, emit) => {
      await new Promise<void>((resolve) => {
        const unsubscribe = runtime.onAccountsChanged((snapshot) => {
          emit({ type: 'snapshot', snapshot })
        })

        // Why: scope the id by connectionId so two sockets from the same
        // device (host + accounts screen) cannot evict each other through
        // registerSubscriptionCleanup's "existing key" branch, and append a
        // per-process counter so two concurrent subscribes on the same
        // socket also can't collide.
        const seq = ++accountsSubscriptionSeq
        const subscriptionId = `accounts-${connectionId ?? 'inproc'}-${seq}`
        runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            unsubscribe()
            emit({ type: 'end' })
            resolve()
          },
          connectionId
        )

        // Why: emit the current snapshot synchronously so the phone has
        // something to render immediately, then refresh only stale data.
        // Connection cutovers replay this subscription and must not turn the
        // manual-force lane into an unbounded provider-fetch loop.
        emit({ type: 'ready', subscriptionId, snapshot: runtime.getAccountsSnapshot() })
        void runtime.refreshAccountsForMobileSubscriber()
      })
    }
  }),
  defineMethod({
    name: 'accounts.unsubscribe',
    params: AccountsUnsubscribeParams,
    handler: async (params, { runtime }) => {
      runtime.cleanupSubscription(params.subscriptionId)
      return { unsubscribed: true }
    }
  })
]
