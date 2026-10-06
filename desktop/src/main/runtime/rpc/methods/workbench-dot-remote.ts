import { WorkbenchDotRemoteSetConnectionParams } from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import { requireDotRemoteControl, type DotRemoteControl } from '../../dot-remote/dot-remote-port'
import { requireWorkbenchCaller } from '../../workbench-caller'
import { defineMethod, type RpcContext } from '../core'

// The desktop controls of remote access (R1). They live under workbench.*, so only the trusted
// desktop renderer reaches them (never mobile, the CLI token or the dot endpoint). The service token
// is write-only: setConnection takes it and no method answers with it.

/** The caller check runs before the control is touched. */
function control(context: RpcContext): DotRemoteControl {
  requireWorkbenchCaller(context.workbenchCaller)
  return requireDotRemoteControl(context.runtime)
}

export const WORKBENCH_DOT_REMOTE_METHODS = [
  defineMethod({
    name: 'workbench.dotRemote.status',
    params: null,
    handler: (_params, context) => control(context).status()
  }),
  defineMethod({
    name: 'workbench.dotRemote.enable',
    params: null,
    handler: (_params, context) => control(context).enable()
  }),
  defineMethod({
    name: 'workbench.dotRemote.disable',
    params: null,
    handler: (_params, context) => control(context).disable()
  }),
  defineMethod({
    name: 'workbench.dotRemote.setConnection',
    params: WorkbenchDotRemoteSetConnectionParams,
    handler: (params, context) => control(context).setConnection(params)
  }),
  defineMethod({
    name: 'workbench.dotRemote.pairing.start',
    params: null,
    handler: (_params, context) => control(context).startPairing()
  }),
  defineMethod({
    name: 'workbench.dotRemote.pairing.status',
    params: null,
    handler: (_params, context) => control(context).pairingStatus()
  }),
  defineMethod({
    name: 'workbench.dotRemote.revoke',
    params: null,
    handler: (_params, context) => control(context).revoke()
  })
]
