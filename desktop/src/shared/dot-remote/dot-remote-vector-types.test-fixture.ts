// FIXTURE_ONLY: the shape of the dot remote conformance vectors file.

/** The server-derived binding a vector runs under. */
export type DotRemoteVectorBinding = {
  readonly ownerId: string
  readonly deviceId: string
  readonly dotIdentity: { readonly source: 'sites_mcp_identity'; readonly subject: string }
  readonly generation: number
}

export type DotRemoteVectorExpect =
  | { readonly result: unknown }
  | {
      readonly error: {
        readonly code: string
        readonly message: string
        readonly retryable: string
      }
    }

export type DotRemoteToolStep = {
  readonly actor: 'dot'
  readonly at: string
  readonly caller: { readonly ownerId: string }
  readonly tool: string
  readonly arguments: Record<string, unknown>
  readonly expect: DotRemoteVectorExpect
}

export type DotRemoteEndpointStep = {
  readonly actor: 'nash' | 'owner'
  readonly at: string
  readonly caller:
    | { readonly deviceId: string; readonly generation: number }
    | { readonly ownerId: string }
    /** A pairing call that sends only OAI-Sites-Authorization. */
    | { readonly serviceOnly: true }
    /** A refresh call: the value it sends in the Nash-Device-Credential header. */
    | { readonly deviceCredential: string }
  readonly endpoint: string
  readonly itemId?: string
  readonly body: Record<string, unknown>
  readonly expect: DotRemoteVectorExpect
}

export type DotRemoteVectorStep = DotRemoteToolStep | DotRemoteEndpointStep

/** Pairing values the Site generates, in order; FIXTURE_ONLY and obviously fake. */
export type DotRemotePairingGenerated = {
  readonly challengeIds: string[]
  readonly userCodes: string[]
  readonly deviceCodes: string[]
  readonly deviceIds: string[]
  readonly sessionTokens: string[]
  readonly deviceCredentials: string[]
}

export type DotRemoteVector = {
  readonly id: string
  readonly category: 'accepted' | 'race' | 'error' | 'pairing'
  /** The tool an accepted vector covers, or the case a race or error vector covers. */
  readonly covers: string
  readonly description: string
  readonly binding: DotRemoteVectorBinding
  /** Values the Site generates, in the order it generates them; a test harness injects them. */
  readonly generated: {
    readonly itemIds: string[]
    readonly leaseNonces: string[]
    readonly pairing?: DotRemotePairingGenerated
  }
  readonly steps: DotRemoteVectorStep[]
}
