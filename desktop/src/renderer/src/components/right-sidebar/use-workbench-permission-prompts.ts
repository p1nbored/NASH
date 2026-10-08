import { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  WorkbenchPermissionAnswerResultSchema,
  WorkbenchPermissionListResultSchema,
  type WorkbenchPermissionAnswerResult,
  type WorkbenchPermissionDecisionView
} from '../../../../shared/rpc-contract/permission-relay-params'
import { useWorkbenchPoll } from './use-workbench-poll'
import {
  toWorkbenchError,
  WorkbenchResponseError,
  type WorkbenchError
} from './workbench-rpc-error'

export const WORKBENCH_PERMISSION_POLL_MS = 3_000
const LIST_LIMIT = 50
// Why bounded: an answered prompt stays visible so its outcome can be read; older ones drop off.
const ANSWERED_KEEP = 5
const LOCAL = { kind: 'local' } as const

export type PermissionAnswer = {
  decisionId: string
  result: WorkbenchPermissionAnswerResult
  view: WorkbenchPermissionDecisionView
}
export type PermissionPromptRow = {
  view: WorkbenchPermissionDecisionView
  answer: PermissionAnswer | null
  answering: boolean
  error: WorkbenchError | null
}
type PromptsState = {
  pending: readonly WorkbenchPermissionDecisionView[] | null
  error: WorkbenchError | null
  answering: ReadonlySet<string>
  answers: readonly PermissionAnswer[]
  answerErrors: ReadonlyMap<string, WorkbenchError>
}

const INITIAL: PromptsState = {
  pending: null,
  error: null,
  answering: new Set(),
  answers: [],
  answerErrors: new Map()
}

function promptsError(error: unknown): WorkbenchError {
  return toWorkbenchError(error)
}

function mismatch(): WorkbenchResponseError {
  return new WorkbenchResponseError(
    translate('workbench.permissions.mismatch', 'The permission relay returned a different prompt.')
  )
}

/** Pending prompts first (oldest first), then this session's answered prompts that left the list. */
export function permissionPromptRows(state: PromptsState): PermissionPromptRow[] {
  const answers = new Map(state.answers.map((answer) => [answer.decisionId, answer]))
  const row = (view: WorkbenchPermissionDecisionView): PermissionPromptRow => {
    const answer = answers.get(view.decisionId) ?? null
    // Why prefer a settled answer: the pending list may still be the read from before it.
    const settled = answer && answer.view.status !== 'pending' ? answer.view : view
    return {
      view: settled,
      answer,
      answering: state.answering.has(view.decisionId),
      error: state.answerErrors.get(view.decisionId) ?? null
    }
  }
  const pending = state.pending ?? []
  const listed = new Set(pending.map((view) => view.decisionId))
  return [
    ...pending.map(row),
    ...state.answers
      .filter((answer) => !listed.has(answer.decisionId))
      .map((answer) => row(answer.view))
  ]
}

export function useWorkbenchPermissionPrompts() {
  const [state, setState] = useState<PromptsState>(INITIAL)
  const activeRef = useRef(false)
  const loadingRef = useRef(false)
  // Why a ref too: two clicks can land before the disabled state renders; one answer per prompt.
  const answeringRef = useRef<ReadonlySet<string>>(new Set())
  const apply = useCallback((change: (previous: PromptsState) => PromptsState): void => {
    if (activeRef.current) {
      setState(change)
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (loadingRef.current) {
      return
    }
    loadingRef.current = true
    try {
      const list = WorkbenchPermissionListResultSchema.parse(
        await callRuntimeRpc<unknown>(LOCAL, 'workbench.permission.list', {
          statuses: ['pending'],
          limit: LIST_LIMIT
        })
      )
      if (list.decisions.some((view) => view.status !== 'pending')) {
        throw mismatch()
      }
      apply((previous) => ({ ...previous, pending: list.decisions, error: null }))
    } catch (error) {
      apply((previous) => ({ ...previous, error: promptsError(error) }))
    } finally {
      loadingRef.current = false
    }
  }, [apply])

  useEffect(() => {
    activeRef.current = true
    void refresh()
    return () => {
      activeRef.current = false
    }
  }, [refresh])
  useWorkbenchPoll(() => void refresh(), WORKBENCH_PERMISSION_POLL_MS, true)

  const answer = useCallback(
    async (view: WorkbenchPermissionDecisionView, decision: 'allow' | 'deny'): Promise<void> => {
      const decisionId = view.decisionId
      if (answeringRef.current.has(decisionId)) {
        return
      }
      answeringRef.current = new Set([...answeringRef.current, decisionId])
      apply((previous) => ({
        ...previous,
        answering: new Set([...previous.answering, decisionId])
      }))
      try {
        const result = WorkbenchPermissionAnswerResultSchema.parse(
          await callRuntimeRpc<unknown>(LOCAL, 'workbench.permission.answer', {
            decisionId,
            decision
          })
        )
        if (result.decision && result.decision.decisionId !== decisionId) {
          throw mismatch()
        }
        const answered: PermissionAnswer = { decisionId, result, view: result.decision ?? view }
        apply((previous) => ({
          ...previous,
          answers: [
            answered,
            ...previous.answers.filter((entry) => entry.decisionId !== decisionId)
          ].slice(0, ANSWERED_KEEP),
          answerErrors: new Map([...previous.answerErrors].filter(([id]) => id !== decisionId))
        }))
      } catch (error) {
        apply((previous) => ({
          ...previous,
          answerErrors: new Map([...previous.answerErrors, [decisionId, promptsError(error)]])
        }))
      } finally {
        answeringRef.current = new Set([...answeringRef.current].filter((id) => id !== decisionId))
        apply((previous) => ({
          ...previous,
          answering: new Set([...previous.answering].filter((id) => id !== decisionId))
        }))
      }
      await refresh()
    },
    [apply, refresh]
  )

  return {
    loaded: state.pending !== null,
    error: state.error,
    rows: permissionPromptRows(state),
    refresh,
    answer
  }
}
