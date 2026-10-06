import { useCallback, useEffect, useRef, useState } from 'react'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type {
  ProposalChanges,
  ProposalSubmission
} from '../../../../shared/routing-table/routing-table-proposal-schema'
import type { RoutingTableAvailabilityView } from '../../../../shared/workbench-route-availability-view'
import {
  WorkbenchRoutingTableCheckResultSchema,
  WorkbenchRoutingTableDecisionResultSchema,
  WorkbenchRoutingTableListResultSchema,
  type WorkbenchRoutingTableCheckResult,
  type WorkbenchRoutingTableDecisionResult,
  type WorkbenchRoutingTableListResult
} from '../../../../shared/workbench-routing-table-view'
import { routeCheckErrorMessage, routeCheckSummary } from './routing-table-availability-messages'
import { routingTableCallErrorMessage, routingTableRefusalMessage } from './routing-table-messages'

const LOCAL = { kind: 'local' } as const

export type RoutingTableNotice = { kind: 'success' | 'error'; message: string }

export type RoutingTableModel = {
  /** Null while loading or when the table could not be read; `loadError` then says why. */
  list: WorkbenchRoutingTableListResult | null
  /** The active table's route availability: the last check for this version, else the list's. */
  availability: RoutingTableAvailabilityView | null
  loadError: string | null
  loading: boolean
  busy: boolean
  checking: boolean
  notice: RoutingTableNotice | null
  refresh: () => Promise<void>
  clearNotice: () => void
  accept: (proposalId: string, modification?: ProposalChanges) => Promise<boolean>
  reject: (proposalId: string) => Promise<boolean>
  importChangeSet: (proposal: ProposalSubmission) => Promise<boolean>
  revert: (version: number) => Promise<boolean>
  /** The user's "Check now"; may run each CLI's model listing in main. */
  checkRoutes: () => Promise<void>
}

type Decided = Extract<WorkbenchRoutingTableDecisionResult, { ok: true }>
type Checked = Extract<WorkbenchRoutingTableCheckResult, { ok: true }>

/** A check names the version it read; it only applies while that exact version is still active. */
function availabilityFor(
  list: WorkbenchRoutingTableListResult | null,
  checked: Checked | null
): RoutingTableAvailabilityView | null {
  if (list === null) {
    return null
  }
  const { active } = list
  const sameVersion =
    checked !== null &&
    active.ok &&
    active.version === checked.version &&
    active.sha256 === checked.sha256
  return sameVersion ? checked.availability : list.availability
}

type Decision = { call: () => Promise<unknown>; success: (result: Decided) => string }

function activated(result: Decided): string {
  return translate(
    'auto.components.settings.routingTable.notices.activated',
    'Version {{version}} is now active.',
    {
      version: result.version ?? '?'
    }
  )
}

/** Desktop-only Routing Table reads and decisions (D-016: the user activates every change). */
export function useRoutingTable(): RoutingTableModel {
  const mountedRef = useMountedRef()
  const requestRef = useRef(0)
  const [list, setList] = useState<WorkbenchRoutingTableListResult | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState<Checked | null>(null)
  const [notice, setNotice] = useState<RoutingTableNotice | null>(null)
  // Why refs: a check compares with the list shown when it lands, not the one shown when it began.
  const listRef = useRef<WorkbenchRoutingTableListResult | null>(null)
  const checkLandedAtRequestRef = useRef(0)
  // Why: a disabled button can still fire twice before React re-renders, so a check or a decision
  // runs alone; a decision during a check would leave the check describing an inactive version.
  const decidingRef = useRef(false)
  const checkingRef = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    const request = ++requestRef.current
    let next: WorkbenchRoutingTableListResult | null = null
    let error: string | null = null
    try {
      const raw = await callRuntimeRpc<unknown>(LOCAL, 'workbench.routingTable.list', {})
      next = WorkbenchRoutingTableListResultSchema.parse(raw)
    } catch (caught) {
      error = routingTableCallErrorMessage(caught)
    }
    // Why the counter: a slow read must not overwrite the result of a newer decision.
    if (mountedRef.current && request === requestRef.current) {
      listRef.current = next
      setList(next)
      // Why: only a read begun after the check carries its readings, so only that one replaces it.
      if (request > checkLandedAtRequestRef.current) {
        setChecked(null)
      }
      setLoadError(error)
      setLoading(false)
    }
  }, [mountedRef])

  const checkRoutes = useCallback(async (): Promise<void> => {
    if (checkingRef.current || decidingRef.current) {
      return
    }
    checkingRef.current = true
    setChecking(true)
    setNotice(null)
    let result: WorkbenchRoutingTableCheckResult | null = null
    let failure: string | null = null
    try {
      const raw = await callRuntimeRpc<unknown>(LOCAL, 'workbench.routingTable.checkRoutes', {})
      result = WorkbenchRoutingTableCheckResultSchema.parse(raw)
    } catch (caught) {
      failure = routeCheckErrorMessage(caught)
    }
    checkingRef.current = false
    if (!mountedRef.current) {
      return
    }
    setChecking(false)
    if (result?.ok === true) {
      checkLandedAtRequestRef.current = requestRef.current
      setChecked(result)
      setNotice({ kind: 'success', message: routeCheckSummary(result.availability) })
      const shown = listRef.current?.active.ok ? listRef.current.active : null
      if (shown?.version !== result.version || shown.sha256 !== result.sha256) {
        // Why: the check read a version this card is not showing, so the table changed meanwhile.
        await refresh()
      }
      return
    }
    const message = result === null ? failure : routingTableRefusalMessage(result)
    setNotice({ kind: 'error', message: message ?? '' })
    if (result !== null) {
      // Why: a refusal means the table could not be read as shown, so show what main reads now.
      await refresh()
    }
  }, [mountedRef, refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const decide = useCallback(
    async ({ call, success }: Decision): Promise<boolean> => {
      if (decidingRef.current || checkingRef.current) {
        return false
      }
      decidingRef.current = true
      setBusy(true)
      setNotice(null)
      let result: WorkbenchRoutingTableDecisionResult | null = null
      let failure: string | null = null
      try {
        result = WorkbenchRoutingTableDecisionResultSchema.parse(await call())
      } catch (caught) {
        failure = routingTableCallErrorMessage(caught)
      }
      decidingRef.current = false
      if (!mountedRef.current) {
        return false
      }
      setBusy(false)
      if (result?.ok === true) {
        setNotice({ kind: 'success', message: success(result) })
      } else {
        const message = result === null ? failure : routingTableRefusalMessage(result)
        setNotice({ kind: 'error', message: message ?? '' })
      }
      await refresh()
      return result?.ok === true
    },
    [mountedRef, refresh]
  )

  const accept = useCallback(
    (proposalId: string, modification?: ProposalChanges) =>
      decide({
        call: () =>
          callRuntimeRpc<unknown>(LOCAL, 'workbench.routingTable.accept', {
            proposalId,
            ...(modification === undefined ? {} : { modification })
          }),
        success: activated
      }),
    [decide]
  )
  const reject = useCallback(
    (proposalId: string) =>
      decide({
        call: () => callRuntimeRpc<unknown>(LOCAL, 'workbench.routingTable.reject', { proposalId }),
        success: () =>
          translate('auto.components.settings.routingTable.notices.rejected', 'Proposal rejected.')
      }),
    [decide]
  )
  const importChangeSet = useCallback(
    (proposal: ProposalSubmission) =>
      decide({
        call: () => callRuntimeRpc<unknown>(LOCAL, 'workbench.routingTable.import', { proposal }),
        success: () =>
          translate(
            'auto.components.settings.routingTable.notices.imported',
            'Saved as a pending proposal. Review it below and accept it to activate it.'
          )
      }),
    [decide]
  )
  const revert = useCallback(
    (version: number) =>
      decide({
        call: () => callRuntimeRpc<unknown>(LOCAL, 'workbench.routingTable.revert', { version }),
        success: (result) =>
          translate(
            'auto.components.settings.routingTable.notices.reverted',
            'Version {{version}} is now active, with the content of version {{from}}.',
            { version: result.version ?? '?', from: version }
          )
      }),
    [decide]
  )

  const clearNotice = useCallback(() => setNotice(null), [])

  return {
    list,
    availability: availabilityFor(list, checked),
    loadError,
    loading,
    // Why: a decision during a check would make its result describe a version no longer active.
    busy: busy || checking,
    checking,
    notice,
    refresh,
    clearNotice,
    accept,
    reject,
    importChangeSet,
    revert,
    checkRoutes
  }
}
