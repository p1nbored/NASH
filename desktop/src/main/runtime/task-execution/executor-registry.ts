import type { TreeProof } from '../../agent-exec-shared/tree-termination'
import type {
  ExecutorStopOutcome,
  ExecutorStopPort,
  ExecutorStopRequest
} from '../workflow-run/executor-stop-port'
import type { ExecutorStopReason } from './executor-run-report'

type ExecutorKind = ExecutorStopRequest['kind']

/** What a stop proves for a run this process does not hold: nothing about its tree. */
const NOT_HELD: ExecutorStopOutcome = { verdict: 'unverifiable', method: 'root_exit_only' }

/**
 * The Codex and agy children this app process runs, one abort controller each. It is the executor
 * stop port worker-stop uses (B4) and the quit hook: it aborts and waits for the run to settle, but
 * never writes Orca rows itself; the attempt's own settlement does that before the wait ends.
 */
export type ExecutorRegistry = ExecutorStopPort & {
  /** Holds a child about to run; null once the app is quitting, so nothing new may start. */
  track(dispatchId: string, kind: ExecutorKind): AbortSignal | null
  /** The run settled with this tree; whoever waits on its stop is answered and the entry is dropped. */
  finish(dispatchId: string, tree: TreeProof): void
  stopReason(dispatchId: string): ExecutorStopReason | null
  holds(dispatchId: string): boolean
  /** Aborts every child (app quit) and resolves once each has settled. */
  abortAll(): Promise<void>
  isClosed(): boolean
}

type Entry = {
  readonly kind: ExecutorKind
  readonly controller: AbortController
  readonly finished: Promise<TreeProof>
  readonly resolve: (tree: TreeProof) => void
  readonly stopReason: ExecutorStopReason | null
}

function newEntry(kind: ExecutorKind): Entry {
  let resolve: (tree: TreeProof) => void = () => undefined
  const finished = new Promise<TreeProof>((settle) => {
    resolve = settle
  })
  return { kind, controller: new AbortController(), finished, resolve, stopReason: null }
}

export function createExecutorRegistry(deps: {
  /** The tree an earlier settlement recorded for a dispatch, if any. */
  readonly recordedTree: (dispatchId: string) => TreeProof | null
}): ExecutorRegistry {
  const entries = new Map<string, Entry>()
  let closed = false

  function abort(dispatchId: string, reason: ExecutorStopReason): Entry | null {
    const entry = entries.get(dispatchId)
    if (!entry) {
      return null
    }
    // Why: the first reason wins, so a stop request is not reported as a quit, or the reverse.
    entries.set(dispatchId, { ...entry, stopReason: entry.stopReason ?? reason })
    entry.controller.abort()
    return entry
  }

  return {
    track(dispatchId, kind) {
      if (entries.has(dispatchId)) {
        throw new Error('That attempt already has a tracked executor.')
      }
      if (closed) {
        return null
      }
      const entry = newEntry(kind)
      entries.set(dispatchId, entry)
      return entry.controller.signal
    },
    finish(dispatchId, tree) {
      const entry = entries.get(dispatchId)
      entries.delete(dispatchId)
      entry?.resolve(tree)
    },
    stopReason: (dispatchId) => entries.get(dispatchId)?.stopReason ?? null,
    holds: (dispatchId) => entries.has(dispatchId),
    isClosed: () => closed,
    async stopExecutor(request) {
      const entry = abort(request.dispatchId, 'stop_requested')
      return entry ? entry.finished : (deps.recordedTree(request.dispatchId) ?? NOT_HELD)
    },
    async abortAll() {
      closed = true
      const running = [...entries.keys()].flatMap(
        (dispatchId) => abort(dispatchId, 'app_quit') ?? []
      )
      await Promise.all(running.map((entry) => entry.finished))
    }
  }
}
