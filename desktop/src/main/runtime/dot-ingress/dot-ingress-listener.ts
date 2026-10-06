import { randomBytes } from 'node:crypto'
import { DOT_INGRESS_CONTRACT_VERSION } from '../../../shared/dot-ingress/dot-ingress-limits'
import type { DotIngressMetadata } from '../../../shared/dot-ingress/dot-ingress-metadata'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { RpcAnyMethodDeclaration, RpcResponse } from '../rpc/core'
import { RpcDispatcher } from '../rpc/dispatcher'
import { errorResponse } from '../rpc/errors'
import { DOT_INGRESS_RPC_METHODS } from '../rpc/methods/dot-ingress'
import type { RpcMessageContext } from '../rpc/transport'
import { UnixSocketTransport, type UnixSocketTransportOptions } from '../rpc/unix-socket-transport'
import { createDotIngressTransportMetadata } from '../runtime-rpc/runtime-rpc-socket-metadata'
import {
  DOT_INGRESS_GENERIC_FAILURE_MESSAGE,
  admitDotIngressFrame,
  sanitizeDotIngressResponse
} from './dot-ingress-admission'
import type { DotIngressControl, DotIngressFailure, DotIngressStatus } from './dot-ingress-control'
import {
  DotIngressMetadataError,
  clearDotIngressMetadataIfOwned,
  clearStaleDotIngressMetadata,
  writeDotIngressMetadata,
  type DotIngressFileOwner
} from './dot-ingress-metadata-file'

const DOT_INGRESS_METHOD_PREFIX = 'dotIngress.'
const INGRESS_TOKEN_BYTES = 32

const METADATA_FAILURES = {
  invalid: 'metadata_invalid',
  not_secured: 'metadata_not_secured',
  write_failed: 'metadata_write_failed'
} as const satisfies Record<DotIngressMetadataError['reason'], DotIngressFailure>

export type DotIngressTransport = Pick<UnixSocketTransport, 'onMessage' | 'start' | 'stop'>

export type DotIngressListenerOptions = {
  runtime: OrcaRuntimeService
  userDataPath: string
  pid: number
  platform: NodeJS.Platform
  /** Must not throw; the port's reader already keeps the interface off on failure. */
  readEnabled: () => boolean
  keepaliveIntervalMs?: number
  /** Test seam. Defaults to the dot registry; every name must be a unary dotIngress method. */
  methods?: readonly RpcAnyMethodDeclaration[]
  /** Test seam for failure injection. */
  createTransport?: (options: UnixSocketTransportOptions) => DotIngressTransport
}

type ActiveEndpoint = { transport: DotIngressTransport; token: string; owner: DotIngressFileOwner }

// Why: a registry that is not dot-only would hand the dot a full-trust surface.
function assertDotIngressRegistry(methods: readonly RpcAnyMethodDeclaration[]): void {
  if (
    methods.some(
      (method) => !method.name.startsWith(DOT_INGRESS_METHOD_PREFIX) || 'stream' in method
    )
  ) {
    throw new OrchestrationError(
      'dot_ingress_registry_invalid',
      'The dot interface registry may only hold unary dotIngress methods.'
    )
  }
}

/**
 * The opt-in second endpoint: its own transport, token and method registry. It exists only while the
 * persisted switch is on, and every sync() re-reads that switch.
 */
export class DotIngressListener implements DotIngressControl {
  private readonly dispatcher: RpcDispatcher
  private active: ActiveEndpoint | null = null
  private enabled = false
  private failure: DotIngressFailure | null = null
  private closed = false
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: DotIngressListenerOptions) {
    const methods = options.methods ?? DOT_INGRESS_RPC_METHODS
    assertDotIngressRegistry(methods)
    // Why: an explicit registry, never the dispatcher default, which is the full-trust one.
    this.dispatcher = new RpcDispatcher({ runtime: options.runtime, methods })
  }

  status(): DotIngressStatus {
    return { enabled: this.enabled, listening: this.active !== null, failure: this.failure }
  }

  sync(): Promise<DotIngressStatus> {
    return this.enqueue(async () => {
      if (!this.closed) {
        await this.reconcile()
      }
      return this.status()
    })
  }

  /** Permanent: removes the endpoint and the file this listener wrote, and ignores later syncs. */
  shutdown(): Promise<void> {
    return this.enqueue(async () => {
      this.closed = true
      this.enabled = false
      this.failure = null
      await this.close()
    })
  }

  // Why: start and stop must never interleave, or a toggled-off interface could leave an endpoint behind.
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async reconcile(): Promise<void> {
    this.enabled = this.options.readEnabled()
    if (this.enabled && !this.active) {
      await this.open()
    } else if (!this.enabled) {
      this.failure = null
      await this.close()
      this.removeStaleFile()
    }
  }

  private async open(): Promise<void> {
    const { userDataPath, pid, keepaliveIntervalMs } = this.options
    const token = randomBytes(INGRESS_TOKEN_BYTES).toString('hex')
    let metadata: DotIngressMetadata
    try {
      metadata = this.buildMetadata(token)
    } catch {
      this.fail('metadata_invalid')
      return
    }
    const runtimeId = metadata.runtimeId
    const endpoint = (this.options.createTransport ?? createUnixTransport)({
      endpoint: metadata.transport.endpoint,
      kind: metadata.transport.kind,
      keepaliveIntervalMs
    })
    endpoint.onMessage((message, reply, context) => {
      void this.handleFrame(runtimeId, message, reply, context).catch(() => {
        // Why: last resort, so a client is never left waiting and no rejection goes unhandled.
        console.error('[dot-ingress] A request failed unexpectedly.')
        try {
          reply(JSON.stringify(genericFailure('unknown', runtimeId)))
        } catch {
          console.error('[dot-ingress] A reply could not be sent.')
        }
      })
    })
    try {
      await endpoint.start()
    } catch {
      // Why stop: a start that failed part way may still hold what it opened.
      await endpoint.stop().catch(() => undefined)
      this.fail('listen_failed')
      return
    }
    try {
      writeDotIngressMetadata(userDataPath, metadata)
    } catch (error) {
      // Why: an endpoint nobody can discover, or whose token others can read, must not stay open.
      await endpoint.stop().catch(() => undefined)
      this.fail(
        error instanceof DotIngressMetadataError
          ? METADATA_FAILURES[error.reason]
          : 'metadata_write_failed'
      )
      return
    }
    this.failure = null
    this.active = { transport: endpoint, token, owner: { pid, runtimeId, ingressToken: token } }
  }

  // Why: the file goes first, so no client can discover an endpoint that is already closing.
  private async close(): Promise<void> {
    const active = this.active
    if (!active) {
      return
    }
    this.active = null
    try {
      clearDotIngressMetadataIfOwned(this.options.userDataPath, active.owner)
    } finally {
      await active.transport.stop()
    }
  }

  // Why: a runtime that was killed leaves its file behind; a disabled interface must leave no file at all.
  private removeStaleFile(): void {
    try {
      clearStaleDotIngressMetadata(this.options.userDataPath, this.options.pid)
    } catch {
      console.warn('[dot-ingress] A stale discovery file could not be removed.')
    }
  }

  private fail(failure: DotIngressFailure): void {
    this.failure = failure
    console.error(`[dot-ingress] The local interface could not start: ${failure}.`)
  }

  private buildMetadata(ingressToken: string): DotIngressMetadata {
    const { runtime, userDataPath, pid, platform } = this.options
    const runtimeId = runtime.getRuntimeId()
    return {
      schemaVersion: 1,
      runtimeId,
      pid,
      startedAt: runtime.getStartedAt(),
      contractVersions: [DOT_INGRESS_CONTRACT_VERSION],
      transport: createDotIngressTransportMetadata(userDataPath, pid, platform, runtimeId),
      ingressToken
    }
  }

  private async handleFrame(
    runtimeId: string,
    rawMessage: string,
    reply: (response: string) => void,
    context?: RpcMessageContext
  ): Promise<void> {
    const admission = admitDotIngressFrame({
      rawMessage,
      token: this.active?.token ?? null,
      runtimeId
    })
    if (!admission.ok) {
      reply(JSON.stringify(admission.response))
      return
    }
    try {
      const response = await this.dispatcher.dispatch(admission.request, {
        signal: context?.signal,
        dotIngressCaller: admission.caller
      })
      const safe = sanitizeDotIngressResponse(response)
      if (!response.ok && !safe.ok && safe.error.code !== response.error.code) {
        // Why: the text was replaced because it may carry internals, so the code is the only server-side trace.
        console.error(`[dot-ingress] A request failed with code ${response.error.code}.`)
      }
      reply(JSON.stringify(safe))
    } catch {
      console.error('[dot-ingress] A request failed unexpectedly.')
      reply(JSON.stringify(genericFailure(admission.request.id, runtimeId)))
    }
  }
}

function genericFailure(id: string, runtimeId: string): RpcResponse {
  return errorResponse(id, { runtimeId }, 'internal_error', DOT_INGRESS_GENERIC_FAILURE_MESSAGE)
}

function createUnixTransport(options: UnixSocketTransportOptions): DotIngressTransport {
  return new UnixSocketTransport(options)
}
