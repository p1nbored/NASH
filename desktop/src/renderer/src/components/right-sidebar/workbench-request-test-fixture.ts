import { screen, waitFor } from '@testing-library/react'
import { expect, vi, type Mock } from 'vitest'
import type * as ReactModule from 'react'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import {
  WorkbenchRequestSchema,
  type WorkbenchListResult,
  type WorkbenchRequestStatus
} from '../../../../shared/workbench-request'

type TestWorkspace = {
  id: string
  displayName: string
  path: string
  hostId: string | undefined
  repoId?: string
  projectId?: string
  projectHostSetupId?: string
}

const { rpc, uuid, lookup, storeState, listeners } = vi.hoisted(() => {
  const lookup: Mock<(id: string, hostId?: string) => TestWorkspace | undefined> = vi.fn()
  const storeState: {
    activeWorkspaceKey: string | null
    activeWorktreeId: string | null
    activeWorkspaceExecutionHostId: string | null
    folderWorkspaces: { id: string; executionHostId: string }[]
    tabsByWorktree: Record<string, { id: string }[]>
    getKnownWorktreeById: typeof lookup
  } = {
    activeWorkspaceKey: 'worktree:local-workspace',
    activeWorktreeId: 'local-workspace',
    activeWorkspaceExecutionHostId: 'local',
    folderWorkspaces: [],
    tabsByWorktree: {},
    getKnownWorktreeById: lookup
  }
  return {
    lookup,
    storeState,
    listeners: new Set<() => void>(),
    rpc: vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>(),
    uuid: vi.fn<() => string>()
  }
})

export { rpc, uuid, lookup, storeState, listeners }

vi.mock('@/store', async () => {
  const { useSyncExternalStore } = await vi.importActual<typeof ReactModule>('react')
  return {
    useAppStore: Object.assign(
      (selector: (state: typeof storeState) => unknown) =>
        useSyncExternalStore(
          (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
          () => selector(storeState)
        ),
      { getState: () => storeState }
    )
  }
})
vi.mock('@/runtime/runtime-rpc-client', async () => {
  const result = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: result.RuntimeRpcCallError }
})
vi.mock('@/lib/browser-uuid', () => ({ createBrowserUuid: uuid }))
vi.mock('@/i18n/i18n', () => ({
  i18n: { language: 'en' },
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, key: string) => String(values?.[key] ?? '')),
  getIntlLocale: () => 'en-US'
}))

export function resetQueueFixture(): void {
  rpc.mockReset().mockResolvedValue(listResult())
  uuid.mockReset().mockReturnValue('3a642de6-28cc-41b7-bc05-8fa216d92977')
  lookup
    .mockReset()
    .mockImplementation((id: string, hostId?: string) =>
      hostId === 'local' || hostId?.startsWith('runtime:') || hostId?.startsWith('ssh:')
        ? { id, displayName: id, path: '/workspace', hostId }
        : undefined
    )
  storeState.activeWorkspaceKey = 'worktree:local-workspace'
  storeState.activeWorktreeId = 'local-workspace'
  storeState.activeWorkspaceExecutionHostId = 'local'
  storeState.folderWorkspaces = []
  storeState.tabsByWorktree = {}
}

export function publishScope(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** The default objective of fixture request `sequence`; rows are found by it, never by their ID. */
export function requestObjective(sequence: number): string {
  return `Inspect request ${sequence}`
}

export function request(
  sequence = 1,
  workspaceId = 'local-workspace',
  status: WorkbenchRequestStatus = 'ROUTING_BLOCKED',
  objective = requestObjective(sequence),
  workflowRunId: string | null = null
) {
  const routed = status === 'ROUTED'
  return WorkbenchRequestSchema.parse({
    schemaVersion: 1,
    requestId: `request-${sequence}`,
    sequence,
    workspaceId,
    objective,
    status,
    revision: status === 'CANCELED' ? 4 : 3,
    createdAt: '2026-10-03T12:00:00.000Z',
    updatedAt: '2026-10-03T12:00:00.000Z',
    accepted: true,
    deliveryState: 'not_delivered',
    permissionState: 'not_requested',
    routingBlocker:
      status === 'ROUTING_BLOCKED' ? { reason: 'launch_blocked', detail: 'launch_refused' } : null,
    workflowRunId,
    taskId: null,
    modelProfileId: routed ? 'codex_assistant' : null,
    executionSurface: routed ? 'codex_exec' : null,
    pluginOperationId: null,
    clefDecisionId: routed ? 'rd_fixture' : null
  })
}

export function listResult(
  requests: WorkbenchListResult['requests'] = [],
  nextBeforeSequence: number | null = null
): WorkbenchListResult {
  return {
    requests,
    nextBeforeSequence,
    capabilities: { submit: true, cancelPending: true, dispatch: false },
    blocker: 'not_configured'
  }
}

/** The request row showing `objective`. */
export function requestRow(objective: string): HTMLElement {
  const row = screen.getByText(objective).closest('li')
  if (!row) {
    throw new Error(`no request row for ${objective}`)
  }
  return row
}

/** Waits until the first listing has enabled the intake form. */
export async function waitForIntake(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByLabelText('Objective').hasAttribute('disabled')).toBe(false)
  )
}

export function deferred() {
  let resolve: (value: unknown) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
