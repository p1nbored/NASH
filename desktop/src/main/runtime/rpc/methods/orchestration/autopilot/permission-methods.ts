import {
  PermissionRequestParams,
  PermissionWaitParams
} from '../../../../../../shared/rpc-contract/permission-relay-params'
import { requirePermissionRelay } from '../../../../permission-relay/permission-relay-registry'
import { defineMethod } from '../../../core'

/**
 * The hidden methods behind `<cli> orchestration permission-request`, the primary session's
 * PermissionRequest hook. The caller is the attested pane from the request evidence; no param can
 * name another caller. Not registered here: package E1 adds them to the shared registry.
 */
export const PERMISSION_REQUEST_METHOD = defineMethod({
  name: 'orchestration.permissionRequest',
  params: PermissionRequestParams,
  handler: (params, context) =>
    requirePermissionRelay(context.runtime).request(
      context.orchestrationCompatibilityEvidence,
      params
    )
})

export const PERMISSION_WAIT_METHOD = defineMethod({
  name: 'orchestration.permissionWait',
  params: PermissionWaitParams,
  handler: (params, context) =>
    requirePermissionRelay(context.runtime).wait(
      context.orchestrationCompatibilityEvidence,
      params,
      context.signal
    )
})

export const ORCHESTRATION_PERMISSION_METHODS = [PERMISSION_REQUEST_METHOD, PERMISSION_WAIT_METHOD]
