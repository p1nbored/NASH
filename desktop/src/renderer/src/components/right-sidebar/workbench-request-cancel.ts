import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  WORKBENCH_LIST_DEFAULT_LIMIT,
  WorkbenchCancelResultSchema,
  WorkbenchListResultSchema,
  type WorkbenchRequest
} from '../../../../shared/workbench-request'
import { WorkbenchResponseError } from './workbench-rpc-error'

/** Before and after the launch: cancelling a launched request also stops its run (D3). */
export function isCancellableRequest(request: WorkbenchRequest): boolean {
  return request.status !== 'CANCELED'
}

export function assertRequestsInWorkspace(requests: WorkbenchRequest[], workspaceId: string): void {
  if (requests.some((request) => request.workspaceId !== workspaceId)) {
    throw new WorkbenchResponseError(
      translate(
        'workbench.requests.scopeMismatch',
        'The request store returned a different workspace scope.'
      )
    )
  }
}

function assertSameRequest(
  original: WorkbenchRequest,
  other: WorkbenchRequest,
  message: string
): void {
  if (
    other.requestId !== original.requestId ||
    other.sequence !== original.sequence ||
    other.objective !== original.objective ||
    other.revision < original.revision
  ) {
    throw new WorkbenchResponseError(message)
  }
}

// Why read first: a launch moves the revision from 1 to 3 within moments of submit (D3).
async function readCurrentRequest(request: WorkbenchRequest): Promise<WorkbenchRequest> {
  const page = WorkbenchListResultSchema.parse(
    await callRuntimeRpc<unknown>({ kind: 'local' }, 'workbench.requests.list', {
      workspaceId: request.workspaceId,
      limit: WORKBENCH_LIST_DEFAULT_LIMIT
    })
  )
  assertRequestsInWorkspace(page.requests, request.workspaceId)
  const current = page.requests.find((row) => row.requestId === request.requestId)
  if (!current) {
    return request
  }
  assertSameRequest(
    request,
    current,
    translate(
      'workbench.requests.refreshMismatch',
      'The request store returned a different request.'
    )
  )
  return current
}

/**
 * Cancels against the request's current revision. Returns the newest record: the cancellation
 * receipt, or the current record when it can no longer be cancelled.
 */
export async function cancelCurrentRequest(request: WorkbenchRequest): Promise<WorkbenchRequest> {
  const current = await readCurrentRequest(request)
  if (!isCancellableRequest(current)) {
    return current
  }
  const result = WorkbenchCancelResultSchema.parse(
    await callRuntimeRpc<unknown>({ kind: 'local' }, 'workbench.requests.cancel', {
      workspaceId: current.workspaceId,
      requestId: current.requestId,
      expectedRevision: current.revision
    })
  )
  assertRequestsInWorkspace([result.request], current.workspaceId)
  const cancelMismatch = translate(
    'workbench.requests.cancelMismatch',
    'The request store returned a different cancellation receipt.'
  )
  assertSameRequest(current, result.request, cancelMismatch)
  if (result.request.status !== 'CANCELED') {
    throw new WorkbenchResponseError(cancelMismatch)
  }
  return result.request
}
