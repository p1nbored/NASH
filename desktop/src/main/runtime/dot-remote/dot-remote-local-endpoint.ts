// Hop C: the agent hands each leased item to NASH's own dot endpoint, as the dot client would, with
// the dot ingress token. Every admission check of that endpoint (switch, workspace, caps, English
// check, secret scan, access ceiling, ownership) therefore applies to remote items unchanged.

export type DotRemoteLocalResult =
  | { ok: true; result: unknown }
  /** The endpoint answered with an error code (a dot_* contract code or a transport code). */
  | { ok: false; kind: 'refused'; code: string }
  /** No endpoint, no discovery file, a connect failure or a timeout: nothing was decided. */
  | { ok: false; kind: 'unavailable' }

export type DotRemoteLocalEndpoint = {
  /** True while the dot endpoint listens; no item is leased while it does not. */
  ready(): boolean
  call(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<DotRemoteLocalResult>
}
