import { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  WORKBENCH_VALIDATION_DECISIONS_DEFAULT_LIMIT,
  WorkbenchValidationDecideResultSchema,
  WorkbenchValidationListDecisionsResultSchema,
  type ValidationDecisionChoice,
  type WorkbenchValidationDecideResult,
  type WorkbenchValidationDecisionView
} from '../../../../shared/rpc-contract/workbench-validation-decision-params'
import { useWorkbenchPoll } from './use-workbench-poll'
import { WORKBENCH_RUN_POLL_MS } from './use-workbench-runs'
import {
  toWorkbenchError,
  WorkbenchResponseError,
  type WorkbenchError
} from './workbench-rpc-error'

// Why the run cadence: a decision blocks a run's completion, not a waiting session like a prompt.
export const WORKBENCH_DECISION_POLL_MS = WORKBENCH_RUN_POLL_MS
// Why bounded: a decided result stays visible so its outcome can be read; older ones drop off.
const DECIDED_KEEP = 5
const LOCAL = { kind: 'local' } as const

type DecisionOutcome = {
  view: WorkbenchValidationDecisionView
  result: WorkbenchValidationDecideResult
}
export type ValidationDecisionRow = {
  view: WorkbenchValidationDecisionView
  outcome: WorkbenchValidationDecideResult | null
  deciding: boolean
  error: WorkbenchError | null
}
type DecisionsState = {
  pending: readonly WorkbenchValidationDecisionView[] | null
  hasMore: boolean
  error: WorkbenchError | null
  deciding: ReadonlySet<string>
  outcomes: readonly DecisionOutcome[]
  decideErrors: ReadonlyMap<string, WorkbenchError>
}

const INITIAL: DecisionsState = {
  pending: null,
  hasMore: false,
  error: null,
  deciding: new Set(),
  outcomes: [],
  decideErrors: new Map()
}

function decisionsError(error: unknown): WorkbenchError {
  const shown = toWorkbenchError(error, {
    invalidResponse: translate(
      'workbench.decisions.invalidResponse',
      'The decision list returned an invalid response.'
    ),
    failed: translate('workbench.decisions.failed', 'The decision call failed.')
  })
  switch (shown.code) {
    case 'autopilot_validation_conflict':
      return {
        ...shown,
        message: translate('workbench.decisions.conflict', 'This result was already decided.')
      }
    case 'autopilot_validation_not_found':
      return {
        ...shown,
        message: translate(
          'workbench.decisions.notFound',
          'This result is no longer waiting for a decision.'
        )
      }
    default:
      return shown
  }
}

/** Waiting results first (oldest first), then this session's decided ones that left the list. */
function decisionRows(state: DecisionsState): ValidationDecisionRow[] {
  const outcomes = new Map(state.outcomes.map((entry) => [entry.view.validationId, entry]))
  const row = (view: WorkbenchValidationDecisionView): ValidationDecisionRow => ({
    view,
    outcome: outcomes.get(view.validationId)?.result ?? null,
    deciding: state.deciding.has(view.validationId),
    error: state.decideErrors.get(view.validationId) ?? null
  })
  const pending = state.pending ?? []
  const listed = new Set(pending.map((view) => view.validationId))
  return [
    ...pending.map(row),
    ...state.outcomes
      .filter((entry) => !listed.has(entry.view.validationId))
      .map((entry) => row(entry.view))
  ]
}

export function useWorkbenchValidationDecisions() {
  const [state, setState] = useState<DecisionsState>(INITIAL)
  const activeRef = useRef(false)
  const loadingRef = useRef(false)
  // Why a ref too: two clicks can land before the disabled state renders; one decision per result.
  const decidingRef = useRef<ReadonlySet<string>>(new Set())
  const apply = useCallback((change: (previous: DecisionsState) => DecisionsState): void => {
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
      const list = WorkbenchValidationListDecisionsResultSchema.parse(
        await callRuntimeRpc<unknown>(LOCAL, 'workbench.validation.listDecisions', {
          limit: WORKBENCH_VALIDATION_DECISIONS_DEFAULT_LIMIT
        })
      )
      apply((previous) => ({
        ...previous,
        pending: list.decisions,
        hasMore: list.hasMore,
        error: null
      }))
    } catch (error) {
      apply((previous) => ({ ...previous, error: decisionsError(error) }))
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
  useWorkbenchPoll(() => void refresh(), WORKBENCH_DECISION_POLL_MS, true)

  const decide = useCallback(
    async (view: WorkbenchValidationDecisionView, decision: ValidationDecisionChoice) => {
      const id = view.validationId
      if (decidingRef.current.has(id)) {
        return
      }
      decidingRef.current = new Set([...decidingRef.current, id])
      apply((previous) => ({ ...previous, deciding: new Set([...previous.deciding, id]) }))
      try {
        const result = WorkbenchValidationDecideResultSchema.parse(
          await callRuntimeRpc<unknown>(LOCAL, 'workbench.validation.decide', {
            validationId: id,
            decision
          })
        )
        if (result.validationId !== id) {
          throw new WorkbenchResponseError(
            translate('workbench.decisions.mismatch', 'The app returned a different result.')
          )
        }
        apply((previous) => ({
          ...previous,
          outcomes: [
            { view, result },
            ...previous.outcomes.filter((entry) => entry.view.validationId !== id)
          ].slice(0, DECIDED_KEEP),
          decideErrors: new Map([...previous.decideErrors].filter(([key]) => key !== id))
        }))
      } catch (error) {
        apply((previous) => ({
          ...previous,
          decideErrors: new Map([...previous.decideErrors, [id, decisionsError(error)]])
        }))
      } finally {
        decidingRef.current = new Set([...decidingRef.current].filter((key) => key !== id))
        apply((previous) => ({
          ...previous,
          deciding: new Set([...previous.deciding].filter((key) => key !== id))
        }))
      }
      await refresh()
    },
    [apply, refresh]
  )

  return {
    loaded: state.pending !== null,
    error: state.error,
    hasMore: state.hasMore,
    rows: decisionRows(state),
    decide
  }
}

export type WorkbenchValidationDecisions = ReturnType<typeof useWorkbenchValidationDecisions>
