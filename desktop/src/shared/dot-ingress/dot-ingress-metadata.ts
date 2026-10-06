import { join } from 'node:path'
import { z } from 'zod'
import { DOT_INGRESS_CONTRACT_VERSION } from './dot-ingress-limits'

/** Written by the runtime while the interface is on, read by the dot client; absent when it is off. */
export const DOT_INGRESS_METADATA_FILE = 'dot-ingress-runtime.json'

export function getDotIngressMetadataPath(userDataPath: string): string {
  return join(userDataPath, DOT_INGRESS_METADATA_FILE)
}

// The ingress endpoint carries a -dot suffix, so the existing orphan sweep (o-<pid>-<suffix>.sock) still matches it.
const NAMED_PIPE_ENDPOINT = /^\\\\\.\\pipe\\orca-\d+-[A-Za-z0-9_-]+-dot$/
const UNIX_SOCKET_ENDPOINT = /(?:^|\/)o-\d+-[A-Za-z0-9_-]+-dot\.sock$/

const TransportSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('named-pipe'), endpoint: z.string().regex(NAMED_PIPE_ENDPOINT) })
    .strict(),
  z.object({ kind: z.literal('unix'), endpoint: z.string().regex(UNIX_SOCKET_ENDPOINT) }).strict()
])

/** The token is `randomBytes(32).toString('hex')`; it is never an environment variable or an RPC result. */
export const DotIngressMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    runtimeId: z.string().min(1).max(128),
    pid: z.number().int().positive(),
    startedAt: z.number().int().nonnegative(),
    contractVersions: z.tuple([z.literal(DOT_INGRESS_CONTRACT_VERSION)]),
    transport: TransportSchema,
    ingressToken: z.string().regex(/^[0-9a-f]{64}$/)
  })
  .strict()

export type DotIngressMetadata = z.infer<typeof DotIngressMetadataSchema>
