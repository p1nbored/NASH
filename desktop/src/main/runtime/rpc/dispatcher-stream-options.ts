import type { RuntimeCapability } from '../../../shared/protocol-version'
import type { TerminalStreamFrame } from '../../../shared/terminal-stream-protocol'
import type { PairingRpcContext } from './core'
import type { WorkbenchCaller } from '../workbench-caller'
import type { DotIngressCaller } from '../dot-ingress/dot-ingress-caller'
import type { RpcCallerIdentity } from './rpc-caller-identity'

export type RpcDispatchStreamingOptions = {
  workbenchCaller?: WorkbenchCaller
  dotIngressCaller?: DotIngressCaller
  authenticatedCallerFingerprint?: string
  connectionId?: string
  signal?: AbortSignal
  clientId?: string
  pairedDeviceId?: string
  /** Set by a transport that knows its caller but carries no paired device (the desktop's IPC). */
  caller?: RpcCallerIdentity
  clientKind?: 'mobile' | 'runtime'
  clientCapabilities?: readonly RuntimeCapability[]
  updateClientCapabilities?: (capabilities: readonly RuntimeCapability[]) => void
  pairing?: PairingRpcContext
  sendBinary?: (bytes: Uint8Array<ArrayBufferLike>) => boolean | void
  registerBinaryStreamHandler?: (
    streamId: number,
    handler: (frame: TerminalStreamFrame) => void
  ) => () => void
  registerBinaryMessageHandler?: (
    handler: (bytes: Uint8Array<ArrayBufferLike>) => void
  ) => () => void
}
