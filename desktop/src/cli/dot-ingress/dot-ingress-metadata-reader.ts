import { readFileSync } from 'node:fs'
import {
  DotIngressMetadataSchema,
  getDotIngressMetadataPath
} from '../../shared/dot-ingress/dot-ingress-metadata'
import type { RuntimeMetadata } from '../../shared/runtime-bootstrap'
import { RuntimeClientError } from '../runtime/types'

// The dot client finds the ingress endpoint through the owner-only discovery file the app writes while
// the interface is on. Errors never repeat a path or the token.

function readUtf8(path: string): string {
  return readFileSync(path, 'utf8')
}

function unavailable(): RuntimeClientError {
  return new RuntimeClientError(
    'runtime_unavailable',
    'The dot interface discovery file is not valid. Turn the interface off and on in the app.'
  )
}

/** A runtime description for the existing transport: the ingress endpoint with the ingress token. */
export function readDotIngressMetadata(
  userDataPath: string,
  readText: (path: string) => string = readUtf8
): RuntimeMetadata {
  let text: string
  try {
    text = readText(getDotIngressMetadataPath(userDataPath))
  } catch {
    throw new RuntimeClientError(
      'dot_ingress_disabled',
      'The dot interface is turned off in the app, or the app is not running.'
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw unavailable()
  }
  const metadata = DotIngressMetadataSchema.safeParse(parsed)
  if (!metadata.success) {
    throw unavailable()
  }
  const { runtimeId, pid, startedAt, transport, ingressToken } = metadata.data
  return {
    runtimeId,
    pid,
    startedAt,
    authToken: ingressToken,
    transports: [{ kind: transport.kind, endpoint: transport.endpoint }]
  }
}
