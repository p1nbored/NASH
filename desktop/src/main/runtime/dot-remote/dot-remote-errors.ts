import { DOT_REMOTE_RPC_ERROR_CODES } from '../../../shared/rpc-contract/workbench-dot-remote-params'
import { OrchestrationError } from '../orchestration/orchestration-error'
import {
  normalizeDotRemoteServiceToken,
  validateDotRemoteServiceTokenShape,
  type DotRemoteCredentialSource
} from './dot-remote-credentials'
import { parseDotRemoteOrigin } from './dot-remote-origin'

// The refusals of the desktop remote-access methods: fixed English text and a shape code at most.
// No refusal repeats the origin or the token the user pasted.

type RpcErrorKey = keyof typeof DOT_REMOTE_RPC_ERROR_CODES

const MESSAGES: Readonly<Record<RpcErrorKey, string>> = {
  unavailable: 'Remote access is not running in this app.',
  disabled: 'Turn on remote access first.',
  notConfigured: 'Set the Site origin and its service access token first.',
  originInvalid:
    'The Site origin must be an https origin such as https://example.com, with no path.',
  tokenInvalid: 'The service access token is not in the expected form. Paste it again.',
  sealingUnavailable:
    'The token was not stored because this system cannot seal it. Nothing was stored.',
  credentialWriteFailed: 'The token could not be stored. Nothing was stored.',
  siteUnreachable: 'The Site could not be reached. Try again later.',
  reconnectNeeded:
    'The Site refused this connection. Paste a new service access token or pair again.',
  pairingRefused: 'The Site refused to start pairing. Try again later.'
}

export function dotRemoteRpcError(
  key: RpcErrorKey,
  data?: Record<string, string>
): OrchestrationError {
  return new OrchestrationError(DOT_REMOTE_RPC_ERROR_CODES[key], MESSAGES[key], data)
}

/** Validates both pasted values, then seals the token; returns the normalized origin. */
export function sealDotRemoteConnection(
  input: { origin: string; serviceToken: string },
  credentials: DotRemoteCredentialSource
): string {
  const origin = parseDotRemoteOrigin(input.origin)
  if (!origin.ok) {
    throw dotRemoteRpcError('originInvalid')
  }
  const token = normalizeDotRemoteServiceToken(input.serviceToken)
  const shape = validateDotRemoteServiceTokenShape(token)
  if (shape !== null) {
    throw dotRemoteRpcError('tokenInvalid', { reason: shape })
  }
  let saved: ReturnType<DotRemoteCredentialSource['save']>
  try {
    saved = credentials.save(token)
  } catch {
    throw dotRemoteRpcError('credentialWriteFailed')
  }
  if (!saved.ok) {
    throw saved.code === 'sealing_unavailable'
      ? dotRemoteRpcError('sealingUnavailable')
      : saved.code === 'write_failed'
        ? dotRemoteRpcError('credentialWriteFailed')
        : dotRemoteRpcError('tokenInvalid', { reason: saved.code })
  }
  return origin.origin
}
