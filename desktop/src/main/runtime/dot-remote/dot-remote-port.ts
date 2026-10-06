import type {
  WorkbenchDotRemotePairingStartResult,
  WorkbenchDotRemotePairingView,
  WorkbenchDotRemoteRevokeResult,
  WorkbenchDotRemoteStatusView
} from '../../../shared/rpc-contract/workbench-dot-remote-params'
import type { OrcaRuntimeService } from '../orca-runtime'
import { dotRemoteRpcError } from './dot-remote-errors'

// The control the desktop methods reach, keyed by runtime, so the RPC layer never builds the agent
// or imports its host ports. Until the install step registers it, every method refuses.

export type DotRemoteControl = {
  status(): WorkbenchDotRemoteStatusView
  enable(): WorkbenchDotRemoteStatusView
  disable(): WorkbenchDotRemoteStatusView
  setConnection(input: { origin: string; serviceToken: string }): WorkbenchDotRemoteStatusView
  startPairing(): Promise<WorkbenchDotRemotePairingStartResult>
  pairingStatus(): WorkbenchDotRemotePairingView
  revoke(): Promise<WorkbenchDotRemoteRevokeResult>
}

const controls = new WeakMap<OrcaRuntimeService, DotRemoteControl>()

/** Returns the unregister; a second control for one runtime is a wiring bug. */
export function registerDotRemoteControl(
  runtime: OrcaRuntimeService,
  control: DotRemoteControl
): () => void {
  if (controls.has(runtime)) {
    throw new Error('A remote access control is already registered for this runtime.')
  }
  controls.set(runtime, control)
  return () => {
    if (controls.get(runtime) === control) {
      controls.delete(runtime)
    }
  }
}

export function requireDotRemoteControl(runtime: OrcaRuntimeService): DotRemoteControl {
  const control = controls.get(runtime)
  if (!control) {
    throw dotRemoteRpcError('unavailable')
  }
  return control
}
