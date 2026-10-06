import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import {
  readDotIngressTarget,
  sendDotIngressFrame,
  type DotIngressTarget
} from './dot-remote-ingress-pipe'
import type { DotRemoteLocalEndpoint, DotRemoteLocalResult } from './dot-remote-local-endpoint'

// The production hop C, on the dot client's own wire: the owner-only discovery file gives the
// endpoint and the per-start ingress token, and one frame carries one call. No envelope is sent, so
// nothing a remote item holds can select an identity on the endpoint.

type Send = (
  target: DotIngressTarget,
  method: string,
  params: unknown,
  timeoutMs: number
) => Promise<RuntimeRpcResponse<unknown>>

export function createDotIngressEndpointClient(deps: {
  readonly userDataPath: string
  /** The dot endpoint's control port: true while it listens. */
  readonly ready: () => boolean
  readonly send?: Send
  readonly readTarget?: (userDataPath: string) => DotIngressTarget | null
}): DotRemoteLocalEndpoint {
  const send: Send = deps.send ?? sendDotIngressFrame
  const readTarget = deps.readTarget ?? ((userDataPath) => readDotIngressTarget(userDataPath))

  async function call(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<DotRemoteLocalResult> {
    const target = readTarget(deps.userDataPath)
    if (target === null) {
      return { ok: false, kind: 'unavailable' }
    }
    try {
      const response = await send(target, method, params, timeoutMs)
      return response.ok
        ? { ok: true, result: response.result }
        : { ok: false, kind: 'refused', code: response.error.code }
    } catch {
      return { ok: false, kind: 'unavailable' }
    }
  }

  return {
    ready: () => {
      try {
        return deps.ready()
      } catch {
        return false
      }
    },
    call
  }
}
