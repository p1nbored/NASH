import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import {
  DotIngressMetadataSchema,
  getDotIngressMetadataPath
} from '../../../shared/dot-ingress/dot-ingress-metadata'
import {
  isKeepaliveFrame,
  RuntimeRpcEnvelopeSchema,
  type RuntimeRpcResponse
} from '../../../shared/runtime-rpc-envelope'

// Hop C on the wire the dot client uses: the owner-only discovery file names the endpoint and its
// per-start token, and one JSON line carries one request. Built on the shared envelope and metadata
// contracts because the main build cannot include the CLI's transport. Errors never carry the token.

export type DotIngressTarget = {
  readonly endpoint: string
  readonly ingressToken: string
  readonly runtimeId: string
}

/** One response frame is far below this; a larger buffer means a broken peer. */
const MAX_BUFFERED_CHARS = 2 * 1024 * 1024

/** The endpoint while the dot interface is on; null when the file is absent or not a valid one. */
export function readDotIngressTarget(
  userDataPath: string,
  readText: (path: string) => string = (path) => readFileSync(path, 'utf8')
): DotIngressTarget | null {
  try {
    const parsed = DotIngressMetadataSchema.safeParse(
      JSON.parse(readText(getDotIngressMetadataPath(userDataPath)))
    )
    if (!parsed.success) {
      return null
    }
    const { transport, ingressToken, runtimeId } = parsed.data
    return { endpoint: transport.endpoint, ingressToken, runtimeId }
  } catch {
    return null
  }
}

type Decoded =
  | { kind: 'keepalive' }
  | { kind: 'response'; response: RuntimeRpcResponse<unknown> }
  | { kind: 'invalid'; reason: string }

function decodeLine(line: string, requestId: string, runtimeId: string): Decoded {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return { kind: 'invalid', reason: 'dot_ingress_invalid_frame' }
  }
  if (isKeepaliveFrame(raw)) {
    return { kind: 'keepalive' }
  }
  const parsed = RuntimeRpcEnvelopeSchema.safeParse(raw)
  if (!parsed.success || '_keepalive' in parsed.data) {
    return { kind: 'invalid', reason: 'dot_ingress_invalid_frame' }
  }
  const frame = parsed.data
  if (frame.id !== requestId) {
    return { kind: 'invalid', reason: 'dot_ingress_mismatched_id' }
  }
  const answeredBy = frame._meta?.runtimeId
  if (answeredBy && answeredBy !== runtimeId) {
    return { kind: 'invalid', reason: 'dot_ingress_runtime_changed' }
  }
  return { kind: 'response', response: frame }
}

/** One request on its own connection; resolves with the endpoint's answer or rejects with a code. */
export function sendDotIngressFrame(
  target: DotIngressTarget,
  method: string,
  params: unknown,
  timeoutMs: number
): Promise<RuntimeRpcResponse<unknown>> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    const socket = createConnection(target.endpoint)
    let buffer = ''
    let settled = false
    const finish = (outcome: RuntimeRpcResponse<unknown> | Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (outcome instanceof Error) {
        reject(outcome)
      } else {
        resolve(outcome)
      }
    }
    const timer = setTimeout(() => finish(new Error('dot_ingress_timeout')), timeoutMs)
    socket.setEncoding('utf8')
    socket.once('error', () => finish(new Error('dot_ingress_unreachable')))
    socket.once('close', () => finish(new Error('dot_ingress_closed')))
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > MAX_BUFFERED_CHARS) {
        finish(new Error('dot_ingress_frame_too_large'))
        return
      }
      let newline = buffer.indexOf('\n')
      while (newline !== -1 && !settled) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (line.length === 0) {
          continue
        }
        const decoded = decodeLine(line, requestId, target.runtimeId)
        if (decoded.kind === 'keepalive') {
          timer.refresh()
        } else {
          finish(decoded.kind === 'response' ? decoded.response : new Error(decoded.reason))
        }
      }
    })
    socket.once('connect', () => {
      socket.write(
        `${JSON.stringify({ id: requestId, authToken: target.ingressToken, method, params })}\n`
      )
    })
  })
}
