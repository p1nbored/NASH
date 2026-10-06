import { useCallback, useEffect, useRef, useState } from 'react'
import { useMountedRef } from '@/hooks/useMountedRef'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { DotRequestAccess } from '../../../../shared/dot-ingress/dot-ingress-limits'
import type { DotRateLimits } from '../../../../shared/dot-ingress/dot-ingress-settings'
import {
  WorkbenchDotIngressSettingsResultSchema,
  type WorkbenchDotIngressSettingsResult
} from '../../../../shared/rpc-contract/workbench-dot-ingress-params'
import { dotIngressCallErrorMessage } from './dot-ingress-messages'

const LOCAL = { kind: 'local' } as const

/** Which card a pending change or a refusal belongs to. */
export type DotIngressScope = 'interface' | 'workspaces' | 'limits'

export type DotIngressRefusal = { scope: DotIngressScope; message: string }

export type DotWorkspaceTarget = { workspaceId: string; label: string }

export type DotIngressModel = {
  /** Null until the first successful read; a later failed read keeps the last one and sets `loadError`. */
  settings: WorkbenchDotIngressSettingsResult | null
  loadError: string | null
  loading: boolean
  busy: DotIngressScope | null
  refusal: DotIngressRefusal | null
  /** Bumps on every refused change, so edited fields can show the stored values again. */
  refusedChanges: number
  refresh: () => Promise<void>
  setEnabled: (enabled: boolean) => Promise<boolean>
  setRateLimits: (limits: DotRateLimits) => Promise<boolean>
  /** Enables or re-enables at read only; the store keeps no higher ceiling across this call. */
  enableWorkspace: (workspace: DotWorkspaceTarget) => Promise<boolean>
  /** Raises the ceiling to workspace write; call it only after the user's explicit confirmation. */
  allowWorkspaceWrite: (workspace: DotWorkspaceTarget) => Promise<boolean>
  disableWorkspace: (workspaceRef: string) => Promise<boolean>
}

function enableParams(workspace: DotWorkspaceTarget, maxAccess: DotRequestAccess): unknown {
  return { workspaceId: workspace.workspaceId, label: workspace.label, maxAccess }
}

/** Desktop-only dot settings (D-018): every change answers with the settings the app now holds. */
export function useDotIngressSettings(): DotIngressModel {
  const mountedRef = useMountedRef()
  const requestRef = useRef(0)
  const busyRef = useRef(false)
  const [settings, setSettings] = useState<WorkbenchDotIngressSettingsResult | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<DotIngressScope | null>(null)
  const [refusal, setRefusal] = useState<DotIngressRefusal | null>(null)
  const [refusedChanges, setRefusedChanges] = useState(0)

  const refresh = useCallback(async (): Promise<void> => {
    const request = ++requestRef.current
    let next: WorkbenchDotIngressSettingsResult | null = null
    let error: string | null = null
    try {
      const raw = await callRuntimeRpc<unknown>(
        LOCAL,
        'workbench.dotIngress.settings.get',
        undefined
      )
      next = WorkbenchDotIngressSettingsResultSchema.parse(raw)
    } catch (caught) {
      error = dotIngressCallErrorMessage(caught)
    }
    // Why the counter: a slow read must not overwrite the answer of a newer change.
    if (mountedRef.current && request === requestRef.current) {
      if (next !== null) {
        setSettings(next)
      }
      setLoadError(error)
      setLoading(false)
    }
  }, [mountedRef])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const change = useCallback(
    async (scope: DotIngressScope, method: string, params: unknown): Promise<boolean> => {
      // Why: disabled controls can still fire twice (Enter, then blur) before React re-renders.
      if (busyRef.current) {
        return false
      }
      busyRef.current = true
      setBusy(scope)
      setRefusal(null)
      const request = ++requestRef.current
      let next: WorkbenchDotIngressSettingsResult | null = null
      let failure: string | null = null
      try {
        next = WorkbenchDotIngressSettingsResultSchema.parse(
          await callRuntimeRpc<unknown>(LOCAL, method, params)
        )
      } catch (caught) {
        failure = dotIngressCallErrorMessage(caught)
      }
      if (next !== null && mountedRef.current && request === requestRef.current) {
        setSettings(next)
        setLoadError(null)
      }
      if (next === null && mountedRef.current) {
        setRefusal({ scope, message: failure ?? '' })
        setRefusedChanges((count) => count + 1)
        // Why: a refused change may still have written part of it (the switch before the endpoint).
        await refresh()
      }
      busyRef.current = false
      if (mountedRef.current) {
        setBusy(null)
      }
      return next !== null
    },
    [mountedRef, refresh]
  )

  const setEnabled = useCallback(
    (enabled: boolean) =>
      change('interface', 'workbench.dotIngress.settings.setEnabled', { enabled }),
    [change]
  )
  const setRateLimits = useCallback(
    (limits: DotRateLimits) =>
      change('limits', 'workbench.dotIngress.settings.setRateLimits', {
        ratePerMinute: limits.ratePerMinute,
        ratePerUtcDay: limits.ratePerUtcDay
      }),
    [change]
  )
  const enableWorkspace = useCallback(
    (workspace: DotWorkspaceTarget) =>
      change(
        'workspaces',
        'workbench.dotIngress.workspaces.enable',
        enableParams(workspace, 'read_only')
      ),
    [change]
  )
  const allowWorkspaceWrite = useCallback(
    (workspace: DotWorkspaceTarget) =>
      change(
        'workspaces',
        'workbench.dotIngress.workspaces.enable',
        enableParams(workspace, 'workspace_write')
      ),
    [change]
  )
  const disableWorkspace = useCallback(
    (workspaceRef: string) =>
      change('workspaces', 'workbench.dotIngress.workspaces.disable', { workspaceRef }),
    [change]
  )

  return {
    settings,
    loadError,
    loading,
    busy,
    refusal,
    refusedChanges,
    refresh,
    setEnabled,
    setRateLimits,
    enableWorkspace,
    allowWorkspaceWrite,
    disableWorkspace
  }
}
