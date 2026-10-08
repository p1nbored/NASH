import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import {
  hasWorkbenchRun,
  isClaudeCodeDetected,
  isClefConnected,
  isDotConnected,
  type NashSetupSignalValues
} from './nash-setup-signals'

export type NashSetupSignalState = NashSetupSignalValues & { checked: boolean }

const LOCAL = { kind: 'local' } as const
// Why: the sidebar entry, Help menu, Settings and the modal all read the checklist; one probe serves them.
const MIN_REFRESH_INTERVAL_MS = 2_000

const INITIAL_STATE: NashSetupSignalState = {
  checked: false,
  claudeCodeDetected: false,
  clefConnected: false,
  dotConnected: false,
  hasWorkbenchRun: false
}

let state: NashSetupSignalState = INITIAL_STATE
let inFlight: Promise<void> | null = null
let forcedRefresh: Promise<void> | null = null
let lastStartedAt = Number.NEGATIVE_INFINITY
const listeners = new Set<() => void>()

/** Local detection and read-only desktop RPCs only; nothing here reaches the network. */
export async function readNashSetupSignalsFromRuntime(): Promise<NashSetupSignalValues> {
  const [agents, routing, dotLocal, dotRemote, runs] = await Promise.allSettled([
    useAppStore.getState().ensureDetectedAgents(),
    callRuntimeRpc<unknown>(LOCAL, 'workbench.routing.status', undefined),
    callRuntimeRpc<unknown>(LOCAL, 'workbench.dotIngress.settings.get', undefined),
    callRuntimeRpc<unknown>(LOCAL, 'workbench.dotRemote.status', undefined),
    callRuntimeRpc<unknown>(LOCAL, 'workbench.runs.list', { limit: 1 })
  ])
  const value = (result: PromiseSettledResult<unknown>): unknown =>
    result.status === 'fulfilled' ? result.value : null
  return {
    claudeCodeDetected:
      agents.status === 'fulfilled' ? isClaudeCodeDetected(agents.value) : state.claudeCodeDetected,
    clefConnected:
      routing.status === 'fulfilled' ? isClefConnected(routing.value) : state.clefConnected,
    dotConnected:
      isDotConnected(value(dotLocal), value(dotRemote)) ||
      ((dotLocal.status === 'rejected' || dotRemote.status === 'rejected') && state.dotConnected),
    hasWorkbenchRun:
      runs.status === 'fulfilled' ? hasWorkbenchRun(runs.value) : state.hasWorkbenchRun
  }
}

function setState(next: NashSetupSignalState): void {
  state = next
  for (const listener of listeners) {
    listener()
  }
}

export function readNashSetupSignalState(): NashSetupSignalState {
  return state
}

export function subscribeNashSetupSignalState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export type RefreshNashSetupSignalsOptions = {
  /** Skips the short reuse window, for an explicit "Check again". */
  force?: boolean
  read?: () => Promise<NashSetupSignalValues>
  now?: number
}

/** Reuses recent reads; explicit checks run after any in-flight probe and failures retain progress. */
export function refreshNashSetupSignals({
  force = false,
  read = readNashSetupSignalsFromRuntime,
  now = Date.now()
}: RefreshNashSetupSignalsOptions = {}): Promise<void> {
  if (inFlight) {
    if (!force) {
      return inFlight
    }
    forcedRefresh ??= inFlight
      .then(() => refreshNashSetupSignals({ force: true, read, now }))
      .finally(() => {
        forcedRefresh = null
      })
    return forcedRefresh
  }
  if (!force && state.checked && now - lastStartedAt < MIN_REFRESH_INTERVAL_MS) {
    return Promise.resolve()
  }
  lastStartedAt = now
  const pending = read()
    .then((values) => setState({ ...values, checked: true }))
    .catch(() => setState({ ...state, checked: true }))
    .finally(() => {
      inFlight = null
    })
  inFlight = pending
  return pending
}

export function resetNashSetupSignalStateForTests(): void {
  state = INITIAL_STATE
  forcedRefresh = null
  inFlight = null
  lastStartedAt = Number.NEGATIVE_INFINITY
  listeners.clear()
}
