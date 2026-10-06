import {
  WorkbenchDotIngressDisableWorkspaceParams,
  WorkbenchDotIngressEnableWorkspaceParams,
  WorkbenchDotIngressRequestsListParams,
  WorkbenchDotIngressRequestsListResultSchema,
  WorkbenchDotIngressSetEnabledParams,
  WorkbenchDotIngressSetRateLimitsParams,
  WorkbenchDotIngressSettingsResultSchema,
  type WorkbenchDotIngressRequestsListResult,
  type WorkbenchDotIngressSettingsResult
} from '../../../../shared/rpc-contract/workbench-dot-ingress-params'
import { projectDotRun } from '../../dot-ingress/dot-ingress-run-projection'
import type { DotIngressStatus } from '../../dot-ingress/dot-ingress-control'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { listDotRequestsForDesktop } from '../../orchestration/db/dot-ingress-desktop-reads'
import { getDotIngressSettingsStore } from '../../orchestration/db/dot-ingress-settings-store'
import type { OrchestrationDb } from '../../orchestration/db/orchestration-db'
import { workbenchWorkspaceBinding } from '../../orchestration/db/workbench-request-scope'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { requireWorkbenchCaller } from '../../workbench-caller'
import { defineMethod, type RpcContext } from '../core'

// The desktop controls of the dot interface. They live under workbench.*, so only the trusted desktop
// renderer reaches them (never mobile, the CLI token or the dot endpoint). Not registered here.

type EndpointStatus = Pick<DotIngressStatus, 'listening' | 'failure'>

/** The caller check runs before the database or the control port is touched. */
function desktopDb(context: RpcContext): OrchestrationDb {
  requireWorkbenchCaller(context.workbenchCaller)
  return context.runtime.getOrchestrationDb({ passive: true })
}

function endpointStatus(runtime: OrcaRuntimeService): EndpointStatus {
  try {
    const { listening, failure } = runtime.requireDotIngressControl().status()
    return { listening, failure }
  } catch (error) {
    if (error instanceof OrchestrationError && error.code === 'workbench_dot_ingress_unavailable') {
      return { listening: false, failure: null }
    }
    throw error
  }
}

function settingsResult(
  db: OrchestrationDb,
  status: EndpointStatus
): WorkbenchDotIngressSettingsResult {
  const store = getDotIngressSettingsStore(db)
  const settings = store.getSettings()
  return WorkbenchDotIngressSettingsResultSchema.parse({
    enabled: settings.enabled,
    connection: 'not_connected',
    listening: status.listening,
    failure: status.failure,
    rateLimits: { ratePerMinute: settings.ratePerMinute, ratePerUtcDay: settings.ratePerUtcDay },
    updatedAt: settings.updatedAt,
    workspaces: store.listWorkspaces().map((entry) => ({
      workspaceRef: entry.workspaceRef,
      workspaceId: entry.workspaceId,
      label: entry.label,
      enabled: entry.enabled,
      maxAccess: store.getWorkspaceMaxAccess(entry.workspaceRef)
    }))
  })
}

function requestsResult(
  db: OrchestrationDb,
  page: { limit: number; beforeSequence?: number }
): WorkbenchDotIngressRequestsListResult {
  const { requests, nextBeforeSequence } = listDotRequestsForDesktop(db, page)
  return WorkbenchDotIngressRequestsListResultSchema.parse({
    requests: requests.map(({ record, workspaceId, objective, claimedClient }) => ({
      dotRequestId: record.dotRequestId,
      sequence: record.sequence,
      state: record.state,
      workspaceRef: record.workspaceRef,
      workspaceId,
      objective,
      requestedAccess: record.requestedAccess,
      deliverableLanguage: record.deliverableLanguage,
      claimedClient,
      failureCode: record.failureCode,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      run: projectDotRun(db, record)
    })),
    nextBeforeSequence
  })
}

const now = (): string => new Date().toISOString()

export const WORKBENCH_DOT_INGRESS_METHODS = [
  defineMethod({
    name: 'workbench.dotIngress.settings.get',
    params: null,
    handler: (_params, context) =>
      settingsResult(desktopDb(context), endpointStatus(context.runtime))
  }),
  defineMethod({
    name: 'workbench.dotIngress.settings.setEnabled',
    params: WorkbenchDotIngressSetEnabledParams,
    handler: async (params, context) => {
      const db = desktopDb(context)
      // Why this order: the endpoint follows the persisted switch, so the switch is written first.
      getDotIngressSettingsStore(db).setEnabled({ enabled: params.enabled, timestamp: now() })
      const status = await context.runtime.requireDotIngressControl().sync()
      return settingsResult(db, status)
    }
  }),
  defineMethod({
    name: 'workbench.dotIngress.settings.setRateLimits',
    params: WorkbenchDotIngressSetRateLimitsParams,
    handler: (params, context) => {
      const db = desktopDb(context)
      getDotIngressSettingsStore(db).setRateLimits({ ...params, timestamp: now() })
      return settingsResult(db, endpointStatus(context.runtime))
    }
  }),
  defineMethod({
    name: 'workbench.dotIngress.workspaces.enable',
    params: WorkbenchDotIngressEnableWorkspaceParams,
    handler: (params, context) => {
      const db = desktopDb(context)
      const workspace = context.runtime.requireWorkbenchWorkspace(params.workspaceId)
      getDotIngressSettingsStore(db).enableWorkspace({
        workspaceId: params.workspaceId,
        workspaceBinding: workbenchWorkspaceBinding(params.workspaceId, workspace),
        label: params.label,
        maxAccess: params.maxAccess,
        timestamp: now()
      })
      return settingsResult(db, endpointStatus(context.runtime))
    }
  }),
  defineMethod({
    name: 'workbench.dotIngress.workspaces.disable',
    params: WorkbenchDotIngressDisableWorkspaceParams,
    handler: (params, context) => {
      const db = desktopDb(context)
      getDotIngressSettingsStore(db).disableWorkspace({
        workspaceRef: params.workspaceRef,
        timestamp: now()
      })
      return settingsResult(db, endpointStatus(context.runtime))
    }
  }),
  defineMethod({
    name: 'workbench.dotIngress.requests.list',
    params: WorkbenchDotIngressRequestsListParams,
    handler: (params, context) => requestsResult(desktopDb(context), params)
  })
]
