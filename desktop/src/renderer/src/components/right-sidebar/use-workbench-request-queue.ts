import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  WORKBENCH_LIST_DEFAULT_LIMIT,
  WorkbenchListResultSchema,
  WorkbenchObjectiveSchema,
  WorkbenchSubmitResultSchema,
  type WorkbenchListResult,
  type WorkbenchRequest
} from '../../../../shared/workbench-request'
import {
  assertRequestsInWorkspace,
  cancelCurrentRequest,
  isCancellableRequest
} from './workbench-request-cancel'
import { getWorkbenchRequestScope, getWorkbenchRequestScopeKey } from './workbench-request-scope'
import {
  toWorkbenchError,
  WorkbenchResponseError,
  type WorkbenchError
} from './workbench-rpc-error'

type QueueError = WorkbenchError
type QueueState = {
  scopeKey: string
  list: WorkbenchListResult | null
  objective: string
  error: QueueError | null
  busy: boolean
  olderPage: boolean
  receipt: WorkbenchRequest | null
}
type QueueSession = { scopeKey: string; active: boolean }
type RetryIdentity = { workspaceId: string; objective: string; idempotencyKey: string }

function emptyState(scopeKey: string): QueueState {
  return {
    scopeKey,
    list: null,
    objective: '',
    error: null,
    busy: false,
    olderPage: false,
    receipt: null
  }
}

function queueError(error: unknown): QueueError {
  return toWorkbenchError(error, {
    invalidResponse: translate(
      'workbench.requests.invalidResponse',
      'The request store returned an invalid response.'
    ),
    failed: translate('workbench.requests.failed', 'The request-store operation failed.')
  })
}

function validPage(result: WorkbenchListResult, beforeSequence?: number): boolean {
  if (result.requests.length > WORKBENCH_LIST_DEFAULT_LIMIT) {
    return false
  }
  const requestIds = new Set<string>()
  let previousSequence = beforeSequence ?? Number.POSITIVE_INFINITY
  for (const request of result.requests) {
    if (request.sequence >= previousSequence || requestIds.has(request.requestId)) {
      return false
    }
    previousSequence = request.sequence
    requestIds.add(request.requestId)
  }
  return (
    result.nextBeforeSequence === null ||
    result.nextBeforeSequence === result.requests.at(-1)?.sequence
  )
}

export function useWorkbenchRequestQueue() {
  const scopeKey = useAppStore(getWorkbenchRequestScopeKey)
  const scope = getWorkbenchRequestScope(useAppStore.getState())
  const [state, setState] = useState(() => emptyState(scopeKey))
  const sessionRef = useRef<QueueSession | null>(null)
  const busySessionRef = useRef<QueueSession | null>(null)
  const retryRef = useRef<RetryIdentity | null>(null)
  const reloadQueuedRef = useRef(false)
  if (state.scopeKey !== scopeKey) {
    setState(emptyState(scopeKey))
  }
  const current = state.scopeKey === scopeKey ? state : emptyState(scopeKey)

  const isCurrent = useCallback(
    (session: QueueSession): boolean =>
      session.active &&
      sessionRef.current === session &&
      session.scopeKey === scopeKey &&
      getWorkbenchRequestScopeKey(useAppStore.getState()) === scopeKey,
    [scopeKey]
  )
  const begin = useCallback((): QueueSession | null => {
    const session = sessionRef.current
    if (!scope.available || !session || !isCurrent(session) || busySessionRef.current === session) {
      return null
    }
    busySessionRef.current = session
    setState((previous) => ({ ...previous, busy: true, error: null }))
    return session
  }, [isCurrent, scope.available])
  const finish = useCallback(
    (session: QueueSession, error?: unknown): void => {
      if (!isCurrent(session)) {
        return
      }
      busySessionRef.current = null
      setState((previous) => ({
        ...previous,
        busy: false,
        error: error === undefined ? previous.error : queueError(error)
      }))
    },
    [isCurrent]
  )

  const load = useCallback(
    async (beforeSequence?: number): Promise<void> => {
      const session = begin()
      if (!session || !scope.workspaceId) {
        return
      }
      try {
        const result = WorkbenchListResultSchema.parse(
          await callRuntimeRpc<unknown>({ kind: 'local' }, 'workbench.requests.list', {
            workspaceId: scope.workspaceId,
            limit: WORKBENCH_LIST_DEFAULT_LIMIT,
            ...(beforeSequence === undefined ? {} : { beforeSequence })
          })
        )
        assertRequestsInWorkspace(result.requests, scope.workspaceId)
        if (!validPage(result, beforeSequence)) {
          throw new WorkbenchResponseError(
            translate(
              'workbench.requests.pageMismatch',
              'The request store returned an invalid page boundary.'
            )
          )
        }
        if (isCurrent(session)) {
          setState((previous) => ({
            ...previous,
            list: result,
            olderPage: beforeSequence !== undefined
          }))
        }
        finish(session)
      } catch (error) {
        finish(session, error)
      }
    },
    [begin, finish, isCurrent, scope.workspaceId]
  )

  useEffect(() => {
    const session: QueueSession = { scopeKey, active: true }
    sessionRef.current = session
    retryRef.current = null
    reloadQueuedRef.current = false
    void load()
    return () => {
      session.active = false
    }
  }, [scopeKey, load])
  // Why stable: the queue re-reads after run stops through an effect keyed on this function.
  const refresh = useCallback((): Promise<void> => {
    const session = sessionRef.current
    // Why queued: a re-read asked for while another operation runs (a run stop) must not be lost.
    if (session && busySessionRef.current === session) {
      reloadQueuedRef.current = true
      return Promise.resolve()
    }
    return load()
  }, [load])
  useEffect(() => {
    if (current.busy || !reloadQueuedRef.current) {
      return
    }
    reloadQueuedRef.current = false
    void load()
  }, [current.busy, load])

  const editObjective = (objective: string): void => {
    const session = sessionRef.current
    if (!session || !isCurrent(session) || busySessionRef.current === session) {
      return
    }
    retryRef.current = null
    setState((previous) => ({ ...previous, objective }))
  }
  const submit = async (): Promise<void> => {
    if (
      !current.list ||
      !scope.workspaceId ||
      !WorkbenchObjectiveSchema.safeParse(current.objective).success
    ) {
      return
    }
    const session = begin()
    if (!session) {
      return
    }
    try {
      const identity = retryRef.current
      const params =
        identity?.workspaceId === scope.workspaceId && identity.objective === current.objective
          ? identity
          : {
              workspaceId: scope.workspaceId,
              objective: current.objective,
              idempotencyKey: createBrowserUuid()
            }
      retryRef.current = params
      const result = WorkbenchSubmitResultSchema.parse(
        await callRuntimeRpc<unknown>({ kind: 'local' }, 'workbench.requests.submit', params)
      )
      assertRequestsInWorkspace([result.request], params.workspaceId)
      if (result.request.objective !== params.objective) {
        throw new WorkbenchResponseError(
          translate(
            'workbench.requests.objectiveMismatch',
            'The request store returned a different objective.'
          )
        )
      }
      if (isCurrent(session)) {
        retryRef.current = null
        setState((previous) => ({ ...previous, objective: '', receipt: result.request }))
      }
      finish(session)
    } catch (error) {
      finish(session, error)
    }
  }
  const cancel = async (request: WorkbenchRequest): Promise<void> => {
    if (
      !current.list ||
      !isCancellableRequest(request) ||
      request.workspaceId !== scope.workspaceId
    ) {
      return
    }
    const session = begin()
    if (!session) {
      return
    }
    try {
      const newest = await cancelCurrentRequest(request)
      if (isCurrent(session)) {
        setState((previous) => ({
          ...previous,
          list: previous.list
            ? {
                ...previous.list,
                requests: previous.list.requests.map((row) =>
                  row.requestId === request.requestId ? newest : row
                )
              }
            : null,
          receipt: previous.receipt?.requestId === request.requestId ? newest : previous.receipt
        }))
      }
      finish(session)
    } catch (error) {
      finish(session, error)
    }
  }
  return {
    ...current,
    scope,
    editObjective,
    submit,
    cancel,
    refresh,
    loadOlder: () => load(current.list?.nextBeforeSequence ?? undefined)
  }
}
