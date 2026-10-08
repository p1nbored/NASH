import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  RunMessageSendResultSchema,
  WORKFLOW_RUN_LIST_DEFAULT_LIMIT,
  WorkflowRunListResultSchema,
  WorkflowRunShowResultSchema,
  WorkflowRunStopResultSchema,
  type RunMessageSendResult,
  type WorkflowRunView
} from '../../../../shared/workflow-run/workflow-run-view'
import { useWorkbenchPoll } from './use-workbench-poll'
import { getWorkbenchRequestScope, getWorkbenchRequestScopeKey } from './workbench-request-scope'
import { withStopRefusalMessage } from './workbench-run-stop-refusal'
import {
  toWorkbenchError,
  WorkbenchResponseError,
  type WorkbenchError
} from './workbench-rpc-error'

export const WORKBENCH_RUN_POLL_MS = 5_000
// Why a cap: each live read asks the terminal; a workspace rarely has more open runs than this.
const LIVE_READ_LIMIT = 3
const LOCAL = { kind: 'local' } as const
const ENDED_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'canceled'])
const ENDED_SESSIONS: ReadonlySet<string> = new Set(['stopped', 'exited'])

export type RunMessageAttempt =
  | { ok: true; result: RunMessageSendResult }
  | { ok: false; error: WorkbenchError }

type RunsState = {
  scopeKey: string
  runs: readonly WorkflowRunView[] | null
  hasMore: boolean
  error: WorkbenchError | null
  liveUnread: ReadonlySet<string>
  pending: ReadonlySet<string>
  actionErrors: ReadonlyMap<string, WorkbenchError>
  stopCount: number
}
type Session = { scopeKey: string; active: boolean }

export function isRunEnded(run: WorkflowRunView): boolean {
  return ENDED_STATUSES.has(run.status)
}

/** D-019: a follow-up message goes only to an active run whose primary session is running. */
export function canMessageRun(run: WorkflowRunView): boolean {
  return run.status === 'active' && run.primary?.state === 'running'
}

function isLiveTarget(run: WorkflowRunView): boolean {
  return !isRunEnded(run) && run.primary !== null && !ENDED_SESSIONS.has(run.primary.state)
}

function emptyRuns(scopeKey: string): RunsState {
  return {
    scopeKey,
    runs: null,
    hasMore: false,
    error: null,
    liveUnread: new Set(),
    pending: new Set(),
    actionErrors: new Map(),
    stopCount: 0
  }
}

function runsError(error: unknown): WorkbenchError {
  return toWorkbenchError(error)
}

function runMismatch(): WorkbenchResponseError {
  return new WorkbenchResponseError(
    translate('workbench.runs.mismatch', 'The run store returned a different run.')
  )
}

async function readLive(run: WorkflowRunView): Promise<WorkflowRunView> {
  const shown = WorkflowRunShowResultSchema.parse(
    await callRuntimeRpc<unknown>(LOCAL, 'workbench.runs.show', { runId: run.runId })
  )
  if (shown.run.runId !== run.runId || shown.run.workspaceId !== run.workspaceId) {
    throw runMismatch()
  }
  return shown.run
}

// Why show per open run: the list reads stored records only; `show` adds what the pane does now.
async function readRuns(workspaceId: string) {
  const list = WorkflowRunListResultSchema.parse(
    await callRuntimeRpc<unknown>(LOCAL, 'workbench.runs.list', {
      workspaceId,
      limit: WORKFLOW_RUN_LIST_DEFAULT_LIMIT
    })
  )
  if (list.runs.some((run) => run.workspaceId !== workspaceId)) {
    throw new WorkbenchResponseError(
      translate(
        'workbench.runs.scopeMismatch',
        'The run store returned a different workspace scope.'
      )
    )
  }
  const reads = new Map<string, WorkflowRunView>()
  const liveUnread = new Set<string>()
  for (const run of list.runs.filter(isLiveTarget).slice(0, LIVE_READ_LIMIT)) {
    try {
      reads.set(run.runId, await readLive(run))
    } catch {
      // Why kept: the stored record still shows; the row says its activity could not be read.
      liveUnread.add(run.runId)
    }
  }
  return {
    runs: list.runs.map((run) => reads.get(run.runId) ?? run),
    hasMore: list.hasMore,
    liveUnread
  }
}

function withoutKey<T>(map: ReadonlyMap<string, T>, key: string): ReadonlyMap<string, T> {
  return new Map([...map].filter(([entry]) => entry !== key))
}

function withMember(set: ReadonlySet<string>, key: string, present: boolean): ReadonlySet<string> {
  return new Set(present ? [...set, key] : [...set].filter((entry) => entry !== key))
}

export function useWorkbenchRuns() {
  const scopeKey = useAppStore(getWorkbenchRequestScopeKey)
  const scope = getWorkbenchRequestScope(useAppStore.getState())
  const [state, setState] = useState(() => emptyRuns(scopeKey))
  const sessionRef = useRef<Session | null>(null)
  const loadingRef = useRef<Session | null>(null)
  if (state.scopeKey !== scopeKey) {
    setState(emptyRuns(scopeKey))
  }
  const current = state.scopeKey === scopeKey ? state : emptyRuns(scopeKey)

  const isCurrent = useCallback(
    (session: Session): boolean =>
      session.active &&
      sessionRef.current === session &&
      getWorkbenchRequestScopeKey(useAppStore.getState()) === session.scopeKey,
    []
  )
  const update = useCallback(
    (session: Session, change: (previous: RunsState) => RunsState): void => {
      if (isCurrent(session)) {
        setState((previous) =>
          previous.scopeKey === session.scopeKey ? change(previous) : previous
        )
      }
    },
    [isCurrent]
  )

  const refresh = useCallback(async (): Promise<void> => {
    const session = sessionRef.current
    const workspaceId = scope.workspaceId
    if (!session || !isCurrent(session) || !scope.available || !workspaceId) {
      return
    }
    if (loadingRef.current === session) {
      return
    }
    loadingRef.current = session
    try {
      const read = await readRuns(workspaceId)
      update(session, (previous) => ({ ...previous, ...read, error: null }))
    } catch (error) {
      update(session, (previous) => ({ ...previous, error: runsError(error) }))
    } finally {
      if (loadingRef.current === session) {
        loadingRef.current = null
      }
    }
  }, [isCurrent, scope.available, scope.workspaceId, update])

  useEffect(() => {
    const session: Session = { scopeKey, active: true }
    sessionRef.current = session
    void refresh()
    return () => {
      session.active = false
    }
  }, [scopeKey, refresh])
  useWorkbenchPoll(() => void refresh(), WORKBENCH_RUN_POLL_MS, scope.available)

  const stop = useCallback(
    async (runId: string): Promise<void> => {
      const session = sessionRef.current
      if (!session || !isCurrent(session) || !scope.available) {
        return
      }
      update(session, (previous) => ({
        ...previous,
        pending: withMember(previous.pending, runId, true)
      }))
      try {
        const stopped = WorkflowRunStopResultSchema.parse(
          await callRuntimeRpc<unknown>(LOCAL, 'workbench.runs.stop', { runId })
        )
        if (stopped.run.runId !== runId) {
          throw runMismatch()
        }
        update(session, (previous) => ({
          ...previous,
          runs: previous.runs?.map((run) => (run.runId === runId ? stopped.run : run)) ?? null,
          actionErrors: withoutKey(previous.actionErrors, runId),
          stopCount: previous.stopCount + 1
        }))
      } catch (error) {
        const shown = withStopRefusalMessage(error, runsError(error))
        update(session, (previous) => ({
          ...previous,
          actionErrors: new Map([...previous.actionErrors, [runId, shown]])
        }))
      } finally {
        update(session, (previous) => ({
          ...previous,
          pending: withMember(previous.pending, runId, false)
        }))
      }
    },
    [isCurrent, scope.available, update]
  )

  const sendMessage = useCallback(
    async (
      runId: string,
      input: { text: string; idempotencyKey: string }
    ): Promise<RunMessageAttempt> => {
      try {
        const result = RunMessageSendResultSchema.parse(
          await callRuntimeRpc<unknown>(LOCAL, 'workbench.runs.message', { runId, ...input })
        )
        return { ok: true, result }
      } catch (error) {
        return { ok: false, error: runsError(error) }
      }
    },
    []
  )

  const runs = current.runs
  const findRun = useCallback(
    (runId: string | null): WorkflowRunView | null =>
      runId === null ? null : (runs?.find((run) => run.runId === runId) ?? null),
    [runs]
  )

  return { ...current, scope, refresh, stop, sendMessage, findRun }
}

export type WorkbenchRuns = ReturnType<typeof useWorkbenchRuns>
